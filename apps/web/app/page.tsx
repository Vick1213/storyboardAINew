import { StreamDemo } from "./StreamDemo";
import { GroundedWrite } from "./GroundedWrite";

export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 28 }}>StoryboardAI</h1>
      <p style={{ opacity: 0.7 }}>
        Claude Code, but for writing stories. This is the v0 authoring shell. See{" "}
        <code>docs/ARCHITECTURE.md</code> for the full design and{" "}
        <code>docs/QUICKSTART.md</code> to deploy the backend.
      </p>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Grounded writing loop</h2>
      <p style={{ opacity: 0.7 }}>
        The magical core (§4): the assembler pulls the right slice of the bible for a node,
        prompt-caches the stable prefix, and streams Claude on Bedrock grounded in your
        characters. Seed the demo story first (<code>functions/seed/seed.mjs</code>), then
        write from node <code>n4</code> — the prose should honour Mara&apos;s tendencies.
        The <code>⟦ grounded · … ⟧</code> header shows what context was assembled.
      </p>
      <GroundedWrite />

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Bedrock streaming demo (free-form)</h2>
      <p style={{ opacity: 0.7 }}>
        Ungrounded token streaming — the original smoke test (set{" "}
        <code>NEXT_PUBLIC_STREAMING_URL</code> in <code>.env</code> after deploy).
      </p>
      <StreamDemo />

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Next to wire</h2>
      <ul style={{ opacity: 0.8, lineHeight: 1.7 }}>
        <li>Cognito sign-in (Amplify) → unlock the GraphQL API</li>
        <li>Story list + the bible/character editor (subscriptions for live sync)</li>
        <li>Tiptap editor mapping prose ↔ narrative nodes</li>
        <li>Continuity pass (§4.3): fold generated prose back into the bible</li>
      </ul>
    </main>
  );
}
