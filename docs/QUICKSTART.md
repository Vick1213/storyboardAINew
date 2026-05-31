# Quickstart — deploy the StoryboardAI dev backend

Region is fixed to **us-west-2 (Oregon)**. Everything below assumes that.

## 0. Prerequisites
- Node ≥ 20, AWS CLI v2 (✓ you have these), and the CDK CLI (✓ `cdk --version`).
- Install pnpm: `npm i -g pnpm@9`. (Homebrew's node doesn't ship `corepack`.) Install from
  the **repo root** with `pnpm install` — the CDK stack reads the root `pnpm-lock.yaml`
  during Lambda bundling, so the workspace must be installed before `cdk synth`/`deploy`.
- **Use an IAM admin user, not the account root.** You're currently authenticated as root —
  create an IAM user/role with admin and configure a profile before going further.
- **Enable Bedrock model access:** Bedrock console → *Model access* (us-west-2) → enable the
  Claude model you want, then set `BEDROCK_MODEL_ID` to its id (or inference-profile id).

## 1. Install (from the repo root)
```bash
npm i -g pnpm@9      # once
pnpm install         # installs all workspaces + generates pnpm-lock.yaml
pnpm -r typecheck    # optional: confirms every package compiles
```

## 2. Bootstrap CDK (once per account/region)
```bash
export AWS_REGION=us-west-2
cd infra
npx cdk bootstrap aws://<ACCOUNT_ID>/us-west-2
```

## 3. Deploy
```bash
# optionally pick a model first:
export BEDROCK_MODEL_ID=us.anthropic.claude-3-5-sonnet-20241022-v2:0
npx cdk deploy
```
Note the **CfnOutputs** (GraphQLUrl, UserPoolId, UserPoolClientId, StreamingUrl,
MediaBucket). Copy them into `apps/web/.env` (template in `/.env.example`).

## 4. Try it
- **Streaming demo (no auth):** `cd apps/web && pnpm dev`, open the page, hit *Stream* — it
  streams tokens from Claude on Bedrock through the Lambda streaming URL.
- **GraphQL (auth):** create a Cognito user, sign in via Amplify, then `createStory` /
  `createCharacter` / `createNode`; subscribe to `onCharacterCreated` to see live sync.

## 5. Tear down (avoid charges)
```bash
cd infra && npx cdk destroy
```

## What's deployed vs. deferred
**Deployed:** Cognito, DynamoDB (single-table), AppSync GraphQL API + Lambda resolver, S3
media bucket, Bedrock streaming Lambda (Function URL).
**Deferred (commented in `lib/storyboard-stack.ts`):** Aurora pgvector (RAG), Step Functions
media pipelines, CloudFront, credits-ledger metering. Add these as you reach §10 steps 3–6.

> ⚠️ The streaming Function URL is `authType: NONE` for dev convenience — anyone with the
> URL can invoke it and spend Bedrock tokens. Put Cognito/IAM auth (or a small rate limit)
> in front of it before exposing anything publicly.
