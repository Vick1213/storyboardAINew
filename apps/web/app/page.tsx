import { StreamDemo } from "./StreamDemo";

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28 }}>StoryboardAI</h1>
      <p style={{ opacity: 0.7 }}>
        Claude Code, but for writing stories. This is the v0 authoring shell. See{" "}
        <code>docs/ARCHITECTURE.md</code> for the full design and{" "}
        <code>docs/QUICKSTART.md</code> to deploy the backend.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Bedrock streaming demo</h2>
      <p style={{ opacity: 0.7 }}>
        Streams tokens directly from Claude on Bedrock via the Lambda streaming endpoint
        (set <code>NEXT_PUBLIC_STREAMING_URL</code> in <code>.env</code> after deploy).
      </p>
      <StreamDemo />

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Next to wire</h2>
      <ul style={{ opacity: 0.8, lineHeight: 1.7 }}>
        <li>Cognito sign-in (Amplify) → unlock the GraphQL API</li>
        <li>Story list + the bible/character editor (subscriptions for live sync)</li>
        <li>Tiptap editor mapping prose ↔ narrative nodes</li>
        <li>Context assembler (<code>packages/ai</code>) feeding the writing agent</li>
      </ul>
    </main>
  );
}
