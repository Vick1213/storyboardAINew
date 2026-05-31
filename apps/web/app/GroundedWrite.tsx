"use client";
import { useState } from "react";

const STREAMING_URL = process.env.NEXT_PUBLIC_STREAMING_URL ?? "";

const INTENTS = ["continue", "rewrite", "ideate", "draft"] as const;
type Intent = (typeof INTENTS)[number];

// Drives the GROUNDED writing loop: POST {storyId, nodeId, intent} to the streaming
// Lambda, which assembles the bible slice for that node, prompt-caches the stable prefix,
// and streams Claude's prose back. The first line (⟦ grounded · … ⟧) shows what context
// the assembler pulled in — so you can see the writing is grounded in the bible.
export function GroundedWrite() {
  const [storyId, setStoryId] = useState("demo-ashfall");
  const [nodeId, setNodeId] = useState("n4");
  const [intent, setIntent] = useState<Intent>("continue");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!STREAMING_URL) {
      setOutput("Set NEXT_PUBLIC_STREAMING_URL in apps/web/.env (from cdk outputs).");
      return;
    }
    setBusy(true);
    setOutput("");
    try {
      const res = await fetch(STREAMING_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storyId, nodeId, intent }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      setOutput(`Error: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const field = {
    padding: 8,
    background: "#15151c",
    color: "#e8e8ec",
    border: "1px solid #333",
    borderRadius: 8,
  } as const;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, opacity: 0.7 }}>
          storyId
          <input value={storyId} onChange={(e) => setStoryId(e.target.value)} style={{ ...field, width: 160 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, opacity: 0.7 }}>
          nodeId
          <input value={nodeId} onChange={(e) => setNodeId(e.target.value)} style={{ ...field, width: 90 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, opacity: 0.7 }}>
          intent
          <select value={intent} onChange={(e) => setIntent(e.target.value as Intent)} style={{ ...field }}>
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        onClick={run}
        disabled={busy}
        style={{ marginTop: 12, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}
      >
        {busy ? "Writing…" : "Write (grounded)"}
      </button>
      {output && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, padding: 12, background: "#15151c", borderRadius: 8, lineHeight: 1.5 }}>
          {output}
        </pre>
      )}
    </div>
  );
}
