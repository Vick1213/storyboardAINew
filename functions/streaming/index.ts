import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

// `awslambda` is a global provided by the Lambda Node runtime for response streaming.
declare const awslambda: {
  streamifyResponse: (
    handler: (event: any, responseStream: NodeJS.WritableStream, context: any) => Promise<void>,
  ) => any;
};

const MODEL_ID = process.env.BEDROCK_MODEL_ID!;
const bedrock = new BedrockRuntimeClient({});

// POST { prompt: string, system?: string }  ->  streamed text/plain of Claude's reply.
// This proves the streaming plane: tokens stream straight to the client; the committed
// final text is persisted separately via a GraphQL mutation (DynamoDB = source of truth).
export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  let prompt = "Write the opening line of a story.";
  let system: string | undefined;
  try {
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    if (body?.prompt) prompt = String(body.prompt);
    if (body?.system) system = String(body.system);
  } catch {
    // fall back to defaults
  }

  const command = new InvokeModelWithResponseStreamCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    }),
  });

  try {
    const res = await bedrock.send(command);
    for await (const chunk of res.body ?? []) {
      const bytes = chunk.chunk?.bytes;
      if (!bytes) continue;
      const evt = JSON.parse(Buffer.from(bytes).toString("utf-8"));
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        responseStream.write(evt.delta.text);
      }
    }
  } catch (err) {
    responseStream.write(`\n[stream error] ${(err as Error).message}`);
  } finally {
    responseStream.end();
  }
});
