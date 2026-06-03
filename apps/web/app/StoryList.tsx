"use client";
// StoryList: left-sidebar story switcher + creator.
// Pure view — all state mutations go through props; no direct API calls here.
import { useState, CSSProperties } from "react";
import type { StoryListProps } from "./panels";
import { colors, sectionTitle, field, button, buttonPrimary, label } from "../lib/ui";
import type { CreateStoryInput } from "../lib/api";

// ── helpers ───────────────────────────────────────────────────────────────────

const storyBtn = (selected: boolean): CSSProperties => ({
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  borderRadius: 8,
  border: `1px solid ${selected ? colors.accent : colors.border}`,
  background: selected ? `${colors.accent}18` : "transparent",
  color: colors.text,
  cursor: "pointer",
  marginBottom: 4,
  fontFamily: "inherit",
  transition: "border-color 0.15s, background 0.15s",
});

// ── form state shape ──────────────────────────────────────────────────────────

interface FormState {
  title: string;
  premise: string;
  form: string;
  genre: string;
  pov: string;
  tense: string;
}

// Sensible defaults so starting a story is title + premise + (pick a form); the rest is
// pre-filled and editable later — lowers the friction to begin.
const emptyForm = (): FormState => ({
  title: "",
  premise: "",
  form: "novel",
  genre: "",
  pov: "third-limited",
  tense: "past",
});

// Story forms (mirrors StoryForm in @storyboard/types). Drives how the AI writes.
const FORMS: Array<{ value: string; label: string }> = [
  { value: "novel", label: "Novel" },
  { value: "novella", label: "Novella" },
  { value: "short-story", label: "Short story" },
  { value: "flash-fiction", label: "Flash fiction" },
  { value: "screenplay", label: "Screenplay" },
  { value: "stage-play", label: "Stage play" },
  { value: "serial", label: "Serial" },
  { value: "interactive", label: "Interactive" },
];

// ── component ─────────────────────────────────────────────────────────────────

export function StoryList({ stories, selectedId, loading, onSelect, onCreate }: StoryListProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);

  function set(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || submitting) return;

    // Build input, omitting blank optionals so the API doesn't receive empty strings
    const input: CreateStoryInput = { title: form.title.trim() };
    if (form.premise.trim()) input.premise = form.premise.trim();
    if (form.form) input.form = form.form as CreateStoryInput["form"];
    if (form.genre.trim()) input.genre = form.genre.trim();
    if (form.pov.trim()) input.pov = form.pov.trim();
    if (form.tense.trim()) input.tense = form.tense.trim();

    setSubmitting(true);
    try {
      await onCreate(input);
      setForm(emptyForm());
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <p style={sectionTitle}>Stories</p>

      {/* Story list */}
      {loading ? (
        <span style={{ color: colors.dim, fontSize: 13, padding: "4px 0" }}>Loading…</span>
      ) : (
        <div style={{ marginBottom: 8 }}>
          {stories.map((s) => (
            <button
              key={s.id}
              style={storyBtn(s.id === selectedId)}
              onClick={() => onSelect(s.id)}
            >
              <span style={{ fontWeight: 600, fontSize: 14, display: "block" }}>{s.title}</span>
              {(s.form || s.genre) && (
                <span style={{ fontSize: 12, color: colors.dim }}>
                  {[s.form, s.genre].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          ))}
          {stories.length === 0 && (
            <span style={{ color: colors.dim, fontSize: 13, padding: "4px 0" }}>
              No stories yet.
            </span>
          )}
        </div>
      )}

      {/* Toggle for create form */}
      {!open ? (
        <button
          style={{ ...button, width: "100%", textAlign: "center", marginTop: 4 }}
          onClick={() => setOpen(true)}
        >
          ＋ New story
        </button>
      ) : (
        <form
          onSubmit={handleCreate}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginTop: 4,
            padding: 12,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            background: colors.panelAlt,
          }}
        >
          {/* title — required */}
          <label style={label}>
            Title *
            <input
              style={field}
              value={form.title}
              onChange={set("title")}
              placeholder="Untitled story"
              autoFocus
            />
          </label>

          {/* premise */}
          <label style={label}>
            Premise
            <textarea
              style={{ ...field, resize: "vertical", minHeight: 56 }}
              value={form.premise}
              onChange={set("premise")}
              placeholder="What is this story about?"
            />
          </label>

          {/* form — what KIND of story; drives how the AI writes (prose vs screenplay …) */}
          <label style={label}>
            Form
            <select style={field} value={form.form} onChange={set("form")}>
              {FORMS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </label>

          {/* genre + pov + tense in a compact row (pre-filled with sensible defaults) */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <label style={label}>
              Genre
              <input style={field} value={form.genre} onChange={set("genre")} placeholder="Fantasy" />
            </label>
            <label style={label}>
              POV
              {/* small select keeps the form compact */}
              <select style={field} value={form.pov} onChange={set("pov")}>
                <option value="">—</option>
                <option value="first">First</option>
                <option value="second">Second</option>
                <option value="third-limited">Third limited</option>
                <option value="third-omniscient">Third omniscient</option>
              </select>
            </label>
            <label style={label}>
              Tense
              <select style={field} value={form.tense} onChange={set("tense")}>
                <option value="">—</option>
                <option value="past">Past</option>
                <option value="present">Present</option>
              </select>
            </label>
          </div>

          {/* actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              style={button}
              onClick={() => { setOpen(false); setForm(emptyForm()); }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                ...buttonPrimary,
                opacity: !form.title.trim() || submitting ? 0.5 : 1,
                cursor: !form.title.trim() || submitting ? "not-allowed" : "pointer",
              }}
              disabled={!form.title.trim() || submitting}
            >
              {submitting ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
