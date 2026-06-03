"use client";
// Narrative DAG panel — invariant #2: story is a graph, never a list. Every structural
// assumption here must survive branching. "Fork" tags and edge rendering make the graph
// legible without a canvas library.
import { useState } from "react";
import type { GraphPanelProps } from "./panels";
import type { CreateEdgeInput } from "../lib/api";
import { colors, card, sectionTitle, field, button, buttonPrimary, label } from "../lib/ui";
import type { NarrativeEdge } from "@storyboard/types";

// ── helpers ──────────────────────────────────────────────────────────────────────────────

// NarrativeEdge.choice arrives as a JSON string (AWSJSON) despite the TS type.
function parseChoice(raw: NarrativeEdge["choice"] | string | undefined): { label?: string } {
  if (!raw) return {};
  if (typeof raw === "object") return raw as { label?: string };
  try { return JSON.parse(raw as unknown as string) as { label?: string }; } catch { return {}; }
}

const STATUS_COLORS: Record<string, string> = {
  draft: colors.dim,
  revised: colors.accentDim,
  locked: "#4caf86",
};

function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "draft";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        border: `1px solid ${STATUS_COLORS[s] ?? colors.dim}`,
        color: STATUS_COLORS[s] ?? colors.dim,
      }}
    >
      {s}
    </span>
  );
}

function Tag({ text, color = colors.dim }: { text: string; color?: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 6px",
        borderRadius: 4,
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// ── main component ────────────────────────────────────────────────────────────────────────

export function GraphPanel({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  onCreateNode,
  onCreateEdge,
}: GraphPanelProps) {
  // "new node" form state
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [nodeTitle, setNodeTitle] = useState("");
  const [nodeSummary, setNodeSummary] = useState("");
  const [savingNode, setSavingNode] = useState(false);

  // "new edge" form state
  const [showEdgeForm, setShowEdgeForm] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [choiceLabel, setChoiceLabel] = useState("");
  const [savingEdge, setSavingEdge] = useState(false);

  // outgoing edges per node
  const outgoing = (nodeId: string): NarrativeEdge[] =>
    edges.filter((e) => e.fromNodeId === nodeId);

  async function handleCreateNode(e: React.FormEvent) {
    e.preventDefault();
    if (!nodeTitle.trim()) return;
    setSavingNode(true);
    try {
      await onCreateNode({
        title: nodeTitle.trim(),
        summary: nodeSummary.trim() || undefined,
      });
      setNodeTitle("");
      setNodeSummary("");
      setShowNodeForm(false);
    } finally {
      setSavingNode(false);
    }
  }

  async function handleCreateEdge(e: React.FormEvent) {
    e.preventDefault();
    if (!fromId || !toId) return;
    setSavingEdge(true);
    try {
      const input: Omit<CreateEdgeInput, "storyId"> = {
        fromNodeId: fromId,
        toNodeId: toId,
        // only attach choice if a label was provided — otherwise it's a plain structural edge
        ...(choiceLabel.trim()
          ? { choice: JSON.stringify({ label: choiceLabel.trim() }) }
          : {}),
      };
      await onCreateEdge(input);
      setFromId("");
      setToId("");
      setChoiceLabel("");
      setShowEdgeForm(false);
    } finally {
      setSavingEdge(false);
    }
  }

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={sectionTitle}>Narrative graph</p>

      {/* ── node list ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nodes.length === 0 && !showNodeForm && (
          <div
            style={{
              textAlign: "center",
              padding: "20px 12px",
              color: colors.dim,
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
            }}
          >
            <span>No scenes yet — the narrative graph is empty.</span>
            <button style={buttonPrimary} onClick={() => setShowNodeForm(true)}>
              ✍ Write your first scene
            </button>
          </div>
        )}
        {nodes.map((node) => {
          const selected = node.id === selectedNodeId;
          const outs = outgoing(node.id);
          const isFork = outs.length > 1;
          const presentCount = node.charactersPresent?.length ?? 0;

          return (
            <div key={node.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {/* node card */}
              <div
                onClick={() => onSelectNode(node.id)}
                style={{
                  ...card,
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderColor: selected ? colors.accent : colors.border,
                  background: selected ? `${colors.accent}18` : colors.panel,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  transition: "border-color 0.12s",
                }}
              >
                {/* row 1: title + badges */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: node.title?.trim() ? colors.text : colors.dim,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {node.title?.trim() || "Untitled"}
                  </span>
                  <StatusBadge status={node.status} />
                  {isFork && <Tag text="fork" color={colors.accent} />}
                  {presentCount > 0 && (
                    <Tag text={`${presentCount} present`} color={colors.dim} />
                  )}
                </div>

                {/* row 2: summary */}
                {node.summary && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 12,
                      color: colors.dim,
                      // clamp to ~2 lines without CSS line-clamp (inline-only environment)
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {node.summary}
                  </p>
                )}
              </div>

              {/* outgoing edges */}
              {outs.length > 0 && (
                <div
                  style={{
                    paddingLeft: 16,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {outs.map((edge) => {
                    const choice = parseChoice(edge.choice);
                    const destTitle = nodes.find((n) => n.id === edge.toNodeId)?.title?.trim() || edge.toNodeId;
                    return (
                      <div
                        key={edge.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 12,
                          color: colors.dim,
                        }}
                      >
                        <span style={{ color: colors.accentDim }}>→</span>
                        <span>{destTitle}</span>
                        {choice.label && (
                          <Tag text={choice.label} color={colors.accentDim} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── new node toggle / form ─────────────────────────────────────────────── */}
      <div>
        <button
          style={button}
          onClick={() => setShowNodeForm((v) => !v)}
        >
          {showNodeForm ? "Cancel" : "＋ New node"}
        </button>

        {showNodeForm && (
          <form
            onSubmit={handleCreateNode}
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              background: colors.panelAlt,
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
            }}
          >
            <label style={label}>
              Title
              <input
                style={field}
                value={nodeTitle}
                onChange={(e) => setNodeTitle(e.target.value)}
                placeholder="Scene title"
                required
              />
            </label>
            <label style={label}>
              Summary
              <textarea
                style={{ ...field, resize: "vertical", minHeight: 56 }}
                value={nodeSummary}
                onChange={(e) => setNodeSummary(e.target.value)}
                placeholder="1–3 sentence summary (optional)"
                rows={2}
              />
            </label>
            <button
              type="submit"
              style={buttonPrimary}
              disabled={savingNode || !nodeTitle.trim()}
            >
              {savingNode ? "Creating…" : "Create node"}
            </button>
          </form>
        )}
      </div>

      {/* ── new edge toggle / form ─────────────────────────────────────────────── */}
      <div>
        <button
          style={button}
          onClick={() => setShowEdgeForm((v) => !v)}
        >
          {showEdgeForm ? "Cancel" : "＋ New edge"}
        </button>

        {showEdgeForm && (
          <form
            onSubmit={handleCreateEdge}
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              background: colors.panelAlt,
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
            }}
          >
            <label style={label}>
              From
              <select
                style={field}
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                required
              >
                <option value="">— select source node —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title?.trim() || "Untitled"}
                  </option>
                ))}
              </select>
            </label>
            <label style={label}>
              To
              <select
                style={field}
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                required
              >
                <option value="">— select target node —</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title?.trim() || "Untitled"}
                  </option>
                ))}
              </select>
            </label>
            <label style={label}>
              Choice label{" "}
              <span style={{ fontStyle: "italic" }}>(optional — makes this a fork)</span>
              <input
                style={field}
                value={choiceLabel}
                onChange={(e) => setChoiceLabel(e.target.value)}
                placeholder='e.g. "Take the left path"'
              />
            </label>
            <button
              type="submit"
              style={buttonPrimary}
              disabled={savingEdge || !fromId || !toId}
            >
              {savingEdge ? "Creating…" : "Create edge"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
