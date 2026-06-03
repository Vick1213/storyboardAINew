"use client";
// NodeEditor: edit a single NarrativeNode and run the grounded writing loop on it.
// Parent remounts with key={node.id} on selection change, so we initialise all local
// state directly from props — no sync-back useEffect needed.
import { useState } from "react";
import type { NodeEditorProps } from "./panels";
import { streamGrounded } from "../lib/api";
import type { Intent } from "../lib/api";
import {
  colors,
  field,
  button,
  buttonPrimary,
  card,
  label,
  sectionTitle,
} from "../lib/ui";

// Strip the leading ⟦ grounded … ⟧ prelude line and trailing ⟦ cache: … ⟧ footer line
// before folding generated text into editable prose (§4.3 "fold prose back" path).
function stripPrelude(raw: string): string {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => !l.trimStart().startsWith("⟦"));
  const end = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i]!.trimStart().startsWith("⟦")) return i + 1;
    }
    return lines.length;
  })();
  return lines.slice(start === -1 ? 0 : start, end).join("\n").trim();
}

export function NodeEditor({ node, characters, storyId, onSave, onContinue }: NodeEditorProps) {
  // ── Editable local state seeded from node on mount ─────────────────────────
  const [title, setTitle] = useState(node.title ?? "");
  const [summary, setSummary] = useState(node.summary ?? "");
  const [status, setStatus] = useState<"draft" | "revised" | "locked">(
    node.status ?? "draft",
  );
  const [content, setContent] = useState(node.content ?? "");
  // charactersPresent arrives as a string[] or possibly a JSON string on the wire
  const [charactersPresent, setCharactersPresent] = useState<string[]>(() => {
    const raw = node.charactersPresent;
    if (!raw) return [];
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw as unknown as string) as string[];
      } catch {
        return [];
      }
    }
    return raw;
  });

  // ── Save state ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null); // ms timestamp
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ storyId, id: node.id, title, summary, status, content, charactersPresent });
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // ── Grounded writing state ─────────────────────────────────────────────────
  const [intent, setIntent] = useState<Intent>("continue");
  const [streaming, setStreaming] = useState(false);
  const [generated, setGenerated] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);

  async function handleStream() {
    setStreaming(true);
    setGenerated("");
    setStreamError(null);
    try {
      await streamGrounded({ storyId, nodeId: node.id, intent }, (chunk) => {
        setGenerated((prev) => prev + chunk);
      });
    } catch (e) {
      setStreamError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreaming(false);
    }
  }

  function appendGenerated() {
    const prose = stripPrelude(generated);
    setContent((prev) => (prev ? prev + "\n\n" + prose : prose));
  }

  function replaceWithGenerated() {
    setContent(stripPrelude(generated));
  }

  // ── Continue / branch (create child node + edge in one action) ──────────────
  const [branchLabel, setBranchLabel] = useState("");
  const [continuing, setContinuing] = useState(false);

  async function handleContinue(asBranch: boolean) {
    setContinuing(true);
    try {
      await onContinue(node.id, asBranch ? { branchLabel: branchLabel.trim() } : {});
      setBranchLabel("");
    } finally {
      setContinuing(false);
    }
  }

  // ── Checkbox toggle ────────────────────────────────────────────────────────
  function toggleCharacter(id: string) {
    setCharactersPresent((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  // ── Layout helpers ─────────────────────────────────────────────────────────
  const gap: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
  const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
  const subCard: React.CSSProperties = {
    background: colors.panelAlt,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  };

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Header ── */}
      <p style={sectionTitle}>Node · {node.title || "Untitled"}</p>

      {/* ── Fields ── */}
      <div style={gap}>
        {/* Title */}
        <label style={label}>
          Title
          <input
            style={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Scene title…"
          />
        </label>

        {/* Summary */}
        <label style={label}>
          Summary
          <textarea
            style={{ ...field, minHeight: 64, resize: "vertical" }}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="1–3 sentence compression used by the context assembler…"
          />
        </label>

        {/* Status */}
        <label style={label}>
          Status
          <select
            style={field}
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "revised" | "locked")}
          >
            <option value="draft">Draft</option>
            <option value="revised">Revised</option>
            <option value="locked">Locked</option>
          </select>
        </label>

        {/* Characters present */}
        {characters.length > 0 && (
          <div style={label as React.CSSProperties}>
            <span>Characters present</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
              {characters.map((c) => (
                <label
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: colors.text,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={charactersPresent.includes(c.id)}
                    onChange={() => toggleCharacter(c.id)}
                    style={{ accentColor: colors.accent }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Prose content — the large editable surface */}
        <label style={label}>
          Content (prose)
          <textarea
            style={{ ...field, minHeight: 260, resize: "vertical", lineHeight: 1.6 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Scene prose…"
          />
        </label>
      </div>

      {/* ── Save ── */}
      <div style={row}>
        <button
          style={saving ? { ...buttonPrimary, opacity: 0.6, cursor: "not-allowed" } : buttonPrimary}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedAt && !saving && (
          <span style={{ fontSize: 12, color: colors.dim }}>
            Saved — persisted to DynamoDB (source of truth)
          </span>
        )}
        {saveError && (
          <span style={{ fontSize: 12, color: colors.danger }}>{saveError}</span>
        )}
      </div>

      {/* ── Grounded writing sub-block ── */}
      <div style={subCard}>
        <p style={{ ...sectionTitle, margin: 0 }}>Grounded writing</p>

        <div style={row}>
          {/* Intent selector */}
          <label style={{ ...label, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <span style={{ whiteSpace: "nowrap" }}>Intent</span>
            <select
              style={{ ...field, width: "auto" }}
              value={intent}
              onChange={(e) => setIntent(e.target.value as Intent)}
            >
              <option value="continue">Continue</option>
              <option value="rewrite">Rewrite</option>
              <option value="ideate">Ideate</option>
              <option value="draft">Draft</option>
            </select>
          </label>

          <button
            style={
              streaming
                ? { ...buttonPrimary, opacity: 0.6, cursor: "not-allowed" }
                : buttonPrimary
            }
            onClick={handleStream}
            disabled={streaming}
          >
            {streaming ? "Writing…" : "Write (grounded)"}
          </button>
        </div>

        {streamError && (
          <span style={{ fontSize: 12, color: colors.danger }}>{streamError}</span>
        )}

        {/* Live token stream — preserve prelude/footer whitespace exactly as rendered */}
        {generated && (
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: colors.text,
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflowY: "auto",
              maxHeight: 360,
            }}
          >
            {generated}
            {/* Blinking cursor while streaming */}
            {streaming && (
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  background: colors.accent,
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "none",
                  opacity: 0.8,
                }}
              />
            )}
          </pre>
        )}

        {/* Fold-prose-back controls (§4.3): only visible once there's generated text */}
        {generated && !streaming && (
          <div style={{ display: "flex", gap: 8 }}>
            <button style={button} onClick={appendGenerated}>
              Append to content
            </button>
            <button style={button} onClick={replaceWithGenerated}>
              Replace content
            </button>
            <span style={{ fontSize: 11, color: colors.dim, alignSelf: "center" }}>
              Prelude/footer stripped — Save to persist
            </span>
          </div>
        )}
      </div>

      {/* ── Continue / branch — build the graph in one action (invariant #2) ── */}
      <div style={subCard}>
        <p style={{ ...sectionTitle, margin: 0 }}>Next scene</p>
        <div style={{ ...row, flexWrap: "wrap" }}>
          <button
            style={continuing ? { ...button, opacity: 0.6, cursor: "not-allowed" } : button}
            onClick={() => handleContinue(false)}
            disabled={continuing}
          >
            ＋ Continue from here
          </button>
          <span style={{ fontSize: 12, color: colors.dim }}>or fork:</span>
          <input
            style={{ ...field, flex: 1, minWidth: 160 }}
            value={branchLabel}
            onChange={(e) => setBranchLabel(e.target.value)}
            placeholder="Choice label (e.g. “Run to the docks”)"
          />
          <button
            style={
              continuing || !branchLabel.trim()
                ? { ...button, opacity: 0.5, cursor: "not-allowed" }
                : button
            }
            onClick={() => handleContinue(true)}
            disabled={continuing || !branchLabel.trim()}
          >
            ＋ Branch
          </button>
        </div>
        <span style={{ fontSize: 11, color: colors.dim }}>
          Creates the next node and the edge from this one, then opens it. A choice label makes
          it a decision-game fork.
        </span>
      </div>
    </div>
  );
}
