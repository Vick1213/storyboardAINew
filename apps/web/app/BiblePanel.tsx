"use client";
// Bible panel — the editable source of truth for story meta and character files
// (CLAUDE.md invariant #1: "the bible is the source of truth"). Pure view; no GraphQL calls.
import { useState } from "react";
import type { Character } from "@storyboard/types";
import type { BiblePanelProps } from "./panels";
import type { UpdateCharacterInput, CreateCharacterInput } from "../lib/api";
import { colors, card, field, button, buttonPrimary, label, sectionTitle } from "../lib/ui";

// ── helpers ───────────────────────────────────────────────────────────────────

/** AWSJSON arrives as a JSON string on the wire; coerce defensively. */
function displayState(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

/** Convert a comma-separated string to a trimmed, non-empty string[]. */
function parseCSV(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

// ── blank form state ──────────────────────────────────────────────────────────

interface CharFormState {
  name: string;
  role: string;
  speechPatterns: string;
  appearance: string;
  traits: string;       // comma-separated
  tendencies: string;   // comma-separated
  state: string;        // raw JSON string
  stateError: string;
}

function blankForm(c?: Character): CharFormState {
  return {
    name: c?.name ?? "",
    role: c?.role ?? "",
    speechPatterns: c?.speechPatterns ?? "",
    appearance: c?.appearance ?? "",
    traits: (c?.traits ?? []).join(", "),
    tendencies: (c?.tendencies ?? []).join(", "),
    state: displayState(c?.state),
    stateError: "",
  };
}

// ── CharacterEditor ───────────────────────────────────────────────────────────

interface EditorProps {
  initial: CharFormState;
  onSave: (f: CharFormState) => Promise<void>;
  onCancel: () => void;
}

function CharacterEditor({ initial, onSave, onCancel }: EditorProps) {
  const [f, setF] = useState<CharFormState>(initial);
  const [saving, setSaving] = useState(false);

  function set(k: keyof CharFormState, v: string) {
    setF((p) => ({ ...p, [k]: v, stateError: k === "state" ? "" : p.stateError }));
  }

  async function handleSave() {
    // Validate JSON state before submitting — show inline error, don't submit if bad
    const stateStr = f.state.trim();
    if (stateStr) {
      try {
        JSON.parse(stateStr);
      } catch {
        setF((p) => ({ ...p, stateError: "Invalid JSON — fix before saving" }));
        return;
      }
    }
    setSaving(true);
    try {
      await onSave({ ...f, stateError: "" });
    } finally {
      setSaving(false);
    }
  }

  const canSave = f.name.trim().length > 0 && !saving;

  const textareaStyle = { ...field, resize: "vertical" as const, minHeight: 64 };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginTop: 10,
        padding: 12,
        background: colors.panelAlt,
        borderRadius: 8,
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* name */}
      <label style={label}>
        Name *
        <input
          style={field}
          value={f.name}
          placeholder="Character name"
          onChange={(e) => set("name", e.target.value)}
        />
      </label>

      {/* role */}
      <label style={label}>
        Role
        <input
          style={field}
          value={f.role}
          placeholder="e.g. protagonist, mentor"
          onChange={(e) => set("role", e.target.value)}
        />
      </label>

      {/* traits — comma-separated */}
      <label style={label}>
        Traits (comma-separated)
        <input
          style={field}
          value={f.traits}
          placeholder="e.g. stubborn, empathetic"
          onChange={(e) => set("traits", e.target.value)}
        />
      </label>

      {/* tendencies — comma-separated */}
      <label style={label}>
        Tendencies (comma-separated)
        <input
          style={field}
          value={f.tendencies}
          placeholder="e.g. deflects with humour, loyal to a fault"
          onChange={(e) => set("tendencies", e.target.value)}
        />
      </label>

      {/* speechPatterns */}
      <label style={label}>
        Speech patterns
        <textarea
          style={textareaStyle}
          value={f.speechPatterns}
          placeholder="How they speak — drives dialogue and TTS"
          onChange={(e) => set("speechPatterns", e.target.value)}
        />
      </label>

      {/* appearance */}
      <label style={label}>
        Appearance
        <textarea
          style={textareaStyle}
          value={f.appearance}
          placeholder="Visual anchor for image consistency"
          onChange={(e) => set("appearance", e.target.value)}
        />
      </label>

      {/* state JSON — mutable continuity data */}
      <label style={label}>
        State (JSON)
        <textarea
          style={{
            ...textareaStyle,
            borderColor: f.stateError ? colors.danger : colors.border,
          }}
          value={f.state}
          placeholder={'{ "mood": "neutral", "location": "tavern" }'}
          onChange={(e) => set("state", e.target.value)}
          spellCheck={false}
        />
        {f.stateError && (
          <span style={{ fontSize: 12, color: colors.danger }}>{f.stateError}</span>
        )}
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button style={button} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          style={{ ...buttonPrimary, opacity: canSave ? 1 : 0.5 }}
          onClick={handleSave}
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── CharacterRow (compact row + inline editor toggle) ─────────────────────────

interface RowProps {
  character: Character;
  storyId: string;
  onUpdateCharacter: (input: UpdateCharacterInput) => Promise<void>;
}

function CharacterRow({ character, storyId, onUpdateCharacter }: RowProps) {
  const [open, setOpen] = useState(false);

  const allTraits = [
    ...(character.traits ?? []),
    ...(character.tendencies ?? []),
  ].join(", ");

  async function handleSave(f: CharFormState) {
    const stateStr = f.state.trim();
    await onUpdateCharacter({
      storyId,
      id: character.id,
      name: f.name.trim() || undefined,
      role: f.role.trim() || undefined,
      speechPatterns: f.speechPatterns.trim() || undefined,
      appearance: f.appearance.trim() || undefined,
      traits: parseCSV(f.traits),
      tendencies: parseCSV(f.tendencies),
      // pass state as-is; validated before save in editor
      state: stateStr || undefined,
    });
    setOpen(false);
  }

  return (
    <div style={{ marginBottom: 4 }}>
      {/* clickable row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((p) => !p)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((p) => !p)}
        style={{
          padding: "8px 10px",
          borderRadius: 8,
          cursor: "pointer",
          background: open ? colors.panelAlt : "transparent",
          border: `1px solid ${open ? colors.border : "transparent"}`,
          // give a subtle hover feel via outline on focus
          outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{character.name}</span>
          {character.role && (
            <span style={{ fontSize: 12, color: colors.dim }}>{character.role}</span>
          )}
        </div>
        {allTraits && (
          <div style={{ fontSize: 12, color: colors.dim, marginTop: 2 }}>{allTraits}</div>
        )}
      </div>

      {open && (
        <CharacterEditor
          initial={blankForm(character)}
          onSave={handleSave}
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// ── NewCharacterForm ──────────────────────────────────────────────────────────

interface NewCharFormProps {
  onCreateCharacter: (input: Omit<CreateCharacterInput, "storyId">) => Promise<void>;
}

function NewCharacterForm({ onCreateCharacter }: NewCharFormProps) {
  const [open, setOpen] = useState(false);

  async function handleSave(f: CharFormState) {
    const stateStr = f.state.trim();
    await onCreateCharacter({
      name: f.name.trim(),
      role: f.role.trim() || undefined,
      speechPatterns: f.speechPatterns.trim() || undefined,
      appearance: f.appearance.trim() || undefined,
      traits: parseCSV(f.traits),
      tendencies: parseCSV(f.tendencies),
      state: stateStr || undefined,
    });
    setOpen(false); // close + reset after success
  }

  if (!open) {
    return (
      <button
        style={{ ...button, marginTop: 8, width: "100%", textAlign: "center" }}
        onClick={() => setOpen(true)}
      >
        ＋ New character
      </button>
    );
  }

  return (
    <CharacterEditor
      initial={blankForm()}
      onSave={handleSave}
      onCancel={() => setOpen(false)}
    />
  );
}

// ── BiblePanel ────────────────────────────────────────────────────────────────

export function BiblePanel({ story, characters, onCreateCharacter, onUpdateCharacter }: BiblePanelProps) {
  return (
    <div style={card}>
      <h2 style={{ ...sectionTitle, marginBottom: 12 }}>Bible</h2>

      {/* Story meta block */}
      <div style={{ marginBottom: 16 }}>
        {story.premise && (
          <p
            style={{
              fontSize: 13,
              color: colors.dim,
              fontStyle: "italic",
              margin: "0 0 10px",
              lineHeight: 1.5,
            }}
          >
            {story.premise}
          </p>
        )}

        {/* form / genre / pov / tense chips */}
        {(story.form || story.genre || story.pov || story.tense) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {story.form && <Chip label={story.form} />}
            {story.genre && <Chip label={story.genre} />}
            {story.pov && <Chip label={story.pov} />}
            {story.tense && <Chip label={story.tense} />}
          </div>
        )}
      </div>

      {/* Characters subsection */}
      <h3 style={{ ...sectionTitle, marginBottom: 8 }}>Characters</h3>

      {characters.length === 0 ? (
        <p style={{ fontSize: 13, color: colors.dim, margin: "0 0 8px" }}>
          No characters yet — add the cast that drives this story. (Coming soon: suggest a
          cast from your premise.)
        </p>
      ) : (
        <div style={{ marginBottom: 4 }}>
          {characters.map((c) => (
            <CharacterRow
              key={c.id}
              character={c}
              storyId={story.id}
              onUpdateCharacter={onUpdateCharacter}
            />
          ))}
        </div>
      )}

      <NewCharacterForm onCreateCharacter={onCreateCharacter} />
    </div>
  );
}

// ── tiny Chip ─────────────────────────────────────────────────────────────────

function Chip({ label: text }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        background: colors.panelAlt,
        border: `1px solid ${colors.border}`,
        color: colors.dim,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}
