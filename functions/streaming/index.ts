import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { assembleContext, buildClaudePrompt, type Intent } from "@storyboard/ai";
import { makeDynamoPorts } from "../adapters/dynamoPorts";

// `awslambda` is a global provided by the Lambda Node runtime for response streaming.
declare const awslambda: {
  streamifyResponse: (
    handler: (event: any, responseStream: NodeJS.WritableStream, context: any) => Promise<void>,
  ) => any;
};

const MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const TABLE = process.env.TABLE_NAME;
const bedrock = new BedrockRuntimeClient({});
// Module-scoped (reused across warm invocations) — the assembler's ports are built per
// request but share this connection.
const ddb = TABLE
  ? DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    })
  : undefined;

const INTENTS = new Set<Intent>(["continue", "rewrite", "ideate", "draft"]);

// Two planes, deliberately separate (docs/ARCHITECTURE.md §2): tokens stream straight to
// the client here; the committed final prose is persisted separately via a GraphQL
// mutation (DynamoDB = source of truth). This endpoint never writes through the DB.
//
// Body:
//   { storyId, nodeId, intent? }  -> GROUNDED writing: assemble the bible slice for the
//                                    node, prompt-cache the stable prefix, stream Claude.
//   { prompt, system? }           -> legacy free-form demo (no grounding).
export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const body = parseBody(event.body);

  try {
    const requestBody =
      body?.storyId && body?.nodeId
        ? await groundedBody(body)
        : freeformBody(body);

    if (requestBody.prelude) responseStream.write(requestBody.prelude);

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify(requestBody.payload),
    });

    const res = await bedrock.send(command);
    let cacheRead = 0;
    let cacheWrite = 0;
    let output = 0;

    for await (const chunk of res.body ?? []) {
      const bytes = chunk.chunk?.bytes;
      if (!bytes) continue;
      const evt = JSON.parse(Buffer.from(bytes).toString("utf-8"));
      if (evt.type === "message_start") {
        const u = evt.message?.usage ?? {};
        cacheRead = u.cache_read_input_tokens ?? 0;
        cacheWrite = u.cache_creation_input_tokens ?? 0;
      } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        responseStream.write(evt.delta.text);
      } else if (evt.type === "message_delta") {
        output = evt.usage?.output_tokens ?? output;
      }
    }

    // Surface caching so it's verifiable (invariant #6). cacheRead==0 with a small bible
    // is expected — the stable prefix may be under the model's min cacheable size.
    console.log(JSON.stringify({ msg: "stream.usage", cacheRead, cacheWrite, output }));
    if (requestBody.showStats) {
      responseStream.write(`\n\n⟦ cache: read ${cacheRead} / write ${cacheWrite} · output ${output} tokens ⟧`);
    }
  } catch (err) {
    responseStream.write(`\n[stream error] ${(err as Error).message}`);
  } finally {
    responseStream.end();
  }
});

function parseBody(raw: unknown): any {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  } catch {
    return {};
  }
}

async function groundedBody(body: any) {
  if (!TABLE || !ddb) throw new Error("TABLE_NAME not configured for grounded writing");
  const intent: Intent = INTENTS.has(body.intent) ? body.intent : "continue";
  const ports = makeDynamoPorts(TABLE, ddb);
  const ctx = await assembleContext(String(body.storyId), String(body.nodeId), intent, ports);
  const { system, messages } = buildClaudePrompt(ctx);

  const cast = ctx.included.cast.length ? ctx.included.cast.join(", ") : "(none in scene)";
  const prelude = `⟦ grounded · intent: ${intent} · cast: ${cast} · recent ${ctx.included.recent} · threads ${ctx.included.threads} · arc ${ctx.included.arc ? "yes" : "no"} · ~${ctx.estimatedTokens} ctx tokens ⟧\n\n`;

  return {
    prelude,
    showStats: true,
    payload: {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 2048,
      system,
      messages,
    },
  };
}

function freeformBody(body: any) {
  const prompt = body?.prompt ? String(body.prompt) : "Write the opening line of a story.";
  const system = body?.system ? String(body.system) : undefined;
  return {
    prelude: undefined as string | undefined,
    showStats: false,
    payload: {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    },
  };
}
