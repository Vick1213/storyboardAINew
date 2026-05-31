import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";

const REPO_ROOT = path.join(__dirname, "..", "..");
const FUNCTIONS_DIR = path.join(REPO_ROOT, "functions");
// Lambda entries live outside infra/, so tell NodejsFunction the real project root.
// depsLockFilePath points at the monorepo's pnpm lockfile (the documented install path).
const LOCK_FILE = path.join(REPO_ROOT, "pnpm-lock.yaml");

export class StoryboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---- Auth: Cognito user pool --------------------------------------------
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
    });

    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true, userPassword: true },
      preventUserExistenceErrors: true,
    });

    // ---- Reactive state: single-table DynamoDB ------------------------------
    // PK/SK single-table design. STORY#<id> partitions hold the story + its
    // characters + nodes (SK = STORY#meta | CHAR#<id> | NODE#<id>).
    // GSI1 (OWNER#<sub>) lists a user's stories.
    const table = new dynamodb.Table(this, "Table", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
    });
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
    });

    // ---- Media bucket: S3 (CloudFront added later) --------------------------
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"], // tighten to your domains before prod
          allowedHeaders: ["*"],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY, // dev only
      autoDeleteObjects: true, // dev only
    });

    // ---- GraphQL API: AppSync (the platform-agnostic boundary) --------------
    const api = new appsync.GraphqlApi(this, "Api", {
      name: "storyboard-api",
      definition: appsync.Definition.fromFile(
        path.join(__dirname, "..", "graphql", "schema.graphql"),
      ),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ERROR },
      xrayEnabled: true,
    });

    // ---- Resolver Lambda: single-table access patterns ----------------------
    const resolverFn = new NodejsFunction(this, "ResolverFn", {
      entry: path.join(FUNCTIONS_DIR, "graphql", "index.ts"),
      projectRoot: REPO_ROOT,
      depsLockFilePath: LOCK_FILE,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      environment: { TABLE_NAME: table.tableName },
      bundling: {
        // @aws-sdk/* is provided by the Node 20 Lambda runtime — don't bundle it.
        externalModules: ["@aws-sdk/*"],
        minify: true,
        target: "node20",
      },
    });
    table.grantReadWriteData(resolverFn);

    const ds = api.addLambdaDataSource("ResolverDS", resolverFn);
    const fields: Array<[string, string]> = [
      ["Query", "listStories"],
      ["Query", "getStory"],
      ["Query", "listCharacters"],
      ["Query", "listNodes"],
      ["Query", "listEdges"],
      ["Mutation", "createStory"],
      ["Mutation", "createCharacter"],
      ["Mutation", "createNode"],
      ["Mutation", "createEdge"],
    ];
    for (const [typeName, fieldName] of fields) {
      ds.createResolver(`${typeName}_${fieldName}`, { typeName, fieldName });
    }

    // ---- LLM streaming: Lambda response streaming -> Claude on Bedrock ------
    // Demonstrates §10 step 4: token streaming that lives OUTSIDE the reactive
    // plane. The committed text is later persisted via a GraphQL mutation.
    const streamingFn = new NodejsFunction(this, "StreamingFn", {
      entry: path.join(FUNCTIONS_DIR, "streaming", "index.ts"),
      projectRoot: REPO_ROOT,
      depsLockFilePath: LOCK_FILE,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      environment: {
        BEDROCK_MODEL_ID:
          process.env.BEDROCK_MODEL_ID ??
          "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
        // Grounded writing reads the bible/graph slice for a node from the single table.
        TABLE_NAME: table.tableName,
      },
      bundling: {
        // DynamoDB clients are provided by the Node 20 runtime; bedrock-runtime is not
        // guaranteed there, so BUNDLE it (keep the proven dynamo clients external).
        externalModules: ["@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"],
        minify: true,
        target: "node20",
      },
    });
    // Grounded writing only READS the bible/graph; committed prose is persisted via the
    // GraphQL resolver (which has read/write). Keep this least-privilege.
    table.grantReadData(streamingFn);
    // Bedrock invoke permission (scope to specific model ARNs before prod).
    streamingFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModelWithResponseStream", "bedrock:InvokeModel"],
        resources: ["*"],
      }),
    );
    const streamingUrl = streamingFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // dev only — front with Cognito/IAM before prod
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: { allowedOrigins: ["*"], allowedMethods: [lambda.HttpMethod.ALL] },
    });

    // ---- Outputs (feed these into apps/web/.env) ----------------------------
    new cdk.CfnOutput(this, "GraphQLUrl", { value: api.graphqlUrl });
    // Needed by functions/seed/seed.mjs (TABLE_NAME=...) to seed the demo story.
    new cdk.CfnOutput(this, "TableName", { value: table.tableName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "StreamingUrl", { value: streamingUrl.url });
    new cdk.CfnOutput(this, "MediaBucketName", { value: mediaBucket.bucketName });
    new cdk.CfnOutput(this, "Region", { value: this.region });

    // ---- NEXT (deliberately NOT in the starter — see docs/ARCHITECTURE.md) --
    // - Aurora Serverless v2 + pgvector for embeddings/RAG (slow/costly to
    //   provision; add when wiring the context assembler's retrieval port).
    // - Step Functions media pipelines (TTS/image) writing to mediaBucket then
    //   fanning out via a GraphQL mutation.
    // - CloudFront in front of mediaBucket.
    // - Credits ledger table + per-op metering.
  }
}
