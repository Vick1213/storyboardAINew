"use client";
import { useState } from "react";

const STREAMING_URL = process.env.NEXT_PUBLIC_STREAMING_URL ?? "";

export function StreamDemo() {
  const [prompt, setPrompt] = useState(
    "Write the opening paragraph of a noir mystery set on Mars.",
  );
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
        body: JSON.stringify({ prompt }),
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

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        style={{ width: "100%", padding: 8, background: "#15151c", color: "#e8e8ec", border: "1px solid #333", borderRadius: 8 }}
      />
      <button
        onClick={run}
        disabled={busy}
        style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}
      >
        {busy ? "Writing…" : "Stream"}
      </button>
      {output && (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, padding: 12, background: "#15151c", borderRadius: 8 }}>
          {output}
        </pre>
      )}
    </div>
  );
}
