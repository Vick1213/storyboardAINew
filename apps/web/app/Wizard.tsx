"use client";
// Guided first-run flow — the "seamless" onboarding (onboarding plan, final item). It
// chains the pieces we already have (createStory + story form + suggestCharacters +
// suggestOpeningScene) into ONE sequence so a new user goes idea -> a living, populated
// story without poking at four separate panels. AI generation calls hit lib/api directly
// (like grounded writing); the story is created mid-flow so the suggestion endpoints —
// which read the bible by storyId — have something to ground on. Nothing AI-proposed is
// kept unless the user advances past its step (invariant #1: human-curated bible).
import { useEffect, useState } from "react";
import type { Story, Character } from "@storyboard/types";
import * as api from "../lib/api";
import { colors, field, button, buttonPrimary, label, sectionTitle } from "../lib/ui";

const FORMS = [
  "novel", "novella", "short-story", "flash-fiction",
  "screenplay", "stage-play", "serial", "interactive",
] as const;

const STEPS = ["Premise", "Form & style", "Cast", "Opening scene"] as const;

export function Wizard({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: (story: Story, openingNodeId: string | null) => void;
}) {
  const [step, setStep] = useState(0); // 0..3
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step 1–2 inputs
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [form, setForm] = useState<string>("novel");
  const [genre, setGenre] = useState("");
  const [pov, setPov] = useState("third-limited");
  const [tense, setTense] = useState("past");

  // created entities (story is created on the 2->3 transition)
  const [story, setStory] = useState<Story | null>(null);
  const [createdChars, setCreatedChars] = useState<Character[]>([]);
  const [openingNodeId, setOpeningNodeId] = useState<string | null>(null);

  // step 3 (cast)
  const [castDrafts, setCastDrafts] = useState<api.CharacterDraft[] | null>(null);
  const [castSelected, setCastSelected] = useState<Set<number>>(new Set());

  // step 4 (scene) — editable
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneTitle, setSceneTitle] = useState("");
  const [sceneSummary, setSceneSummary] = useState("");
  const [sceneNames, setSceneNames] = useState<string[]>([]);
  const [sceneLoaded, setSceneLoaded] = useState(false);

  function fail(e: unknown) {
    setError(e instanceof Error ? e.message : String(e));
  }

  // ── step 2 -> 3: create the story, then suggest a cast ──────────────────────
  async function createStoryAndAdvance() {
    setBusy(true);
    setError(null);
    try {
      const s = await api.createStory({
        title: title.trim(),
        premise: premise.trim() || undefined,
        form: form as api.CreateStoryInput["form"],
        genre: genre.trim() || undefined,
        pov: pov || undefined,
        tense: tense || undefined,
      });
      setStory(s);
      setStep(2);
      // auto-suggest the cast
      const drafts = await api.suggestCharacters(s.id, 4);
      setCastDrafts(drafts);
      setCastSelected(new Set(drafts.map((_, i) => i)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function regenerateCast() {
    if (!story) return;
    setBusy(true);
    setError(null);
    try {
      const drafts = await api.suggestCharacters(story.id, 4);
      setCastDrafts(drafts);
      setCastSelected(new Set(drafts.map((_, i) => i)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ── step 3 -> 4: persist selected cast, then suggest the opening scene ───────
  async function addCastAndAdvance() {
    if (!story) return;
    setBusy(true);
    setError(null);
    try {
      const created: Character[] = [];
      for (const i of [...castSelected].sort((a, b) => a - b)) {
        const d = castDrafts?.[i];
        if (!d) continue;
        created.push(
          await api.createCharacter({
            storyId: story.id,
            name: d.name,
            role: d.role,
            traits: d.traits,
            tendencies: d.tendencies,
            speechPatterns: d.speechPatterns,
            appearance: d.appearance,
          }),
        );
      }
      setCreatedChars(created);
      setStep(3);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ── step 4: fetch the opening-scene suggestion once we land there ────────────
  useEffect(() => {
    if (step !== 3 || !story || sceneLoaded) return;
    setSceneLoading(true);
    api
      .suggestOpeningScene(story.id)
      .then((d) => {
        setSceneTitle(d.title);
        setSceneSummary(d.summary);
        setSceneNames(d.characterNames ?? []);
      })
      .catch(fail)
      .finally(() => {
        setSceneLoading(false);
        setSceneLoaded(true);
      });
  }, [step, story, sceneLoaded]);

  // map suggested character names -> ids of the cast we just created (case-insensitive)
  function matchedCharacterIds(): string[] {
    const byName = new Map(createdChars.map((c) => [c.name.toLowerCase(), c.id]));
    return sceneNames
      .map((n) => byName.get(n.trim().toLowerCase()))
      .filter((x): x is string => Boolean(x));
  }

  async function finish(withScene: boolean) {
    if (!story) return;
    setBusy(true);
    setError(null);
    try {
      let nodeId: string | null = null;
      if (withScene && sceneTitle.trim()) {
        const node = await api.createNode({
          storyId: story.id,
          title: sceneTitle.trim(),
          summary: sceneSummary.trim() || undefined,
          charactersPresent: matchedCharacterIds(),
        });
        nodeId = node.id;
      }
      setOpeningNodeId(nodeId);
      onComplete(story, nodeId);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────
  const canNext1 = title.trim().length > 0;

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        zIndex: 50,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 620,
          background: colors.panel,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* header + progress */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 18 }}>✨ New story</strong>
          <button
            onClick={onClose}
            disabled={busy}
            style={{ background: "none", border: "none", color: colors.dim, fontSize: 20, cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, textAlign: "center" }}>
              <div
                style={{
                  height: 3,
                  borderRadius: 2,
                  background: i <= step ? colors.accent : colors.border,
                  marginBottom: 4,
                }}
              />
              <span style={{ fontSize: 11, color: i === step ? colors.accent : colors.dim }}>{s}</span>
            </div>
          ))}
        </div>

        {error && <p style={{ fontSize: 13, color: colors.danger, margin: 0 }}>{error}</p>}

        {/* ── Step 1: premise ── */}
        {step === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={label}>
              Title *
              <input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled story" autoFocus />
            </label>
            <label style={label}>
              Premise
              <textarea
                style={{ ...field, minHeight: 90, resize: "vertical" }}
                value={premise}
                onChange={(e) => setPremise(e.target.value)}
                placeholder="What is this story about? The more vivid, the better the AI's suggestions."
              />
            </label>
            <Footer>
              <button style={button} onClick={onClose}>Cancel</button>
              <button
                style={canNext1 ? buttonPrimary : { ...buttonPrimary, opacity: 0.5, cursor: "not-allowed" }}
                onClick={() => setStep(1)}
                disabled={!canNext1}
              >
                Next
              </button>
            </Footer>
          </div>
        )}

        {/* ── Step 2: form & style ── */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={label}>
              Form
              <select style={field} value={form} onChange={(e) => setForm(e.target.value)}>
                {FORMS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label style={label}>
                Genre
                <input style={field} value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Fantasy" />
              </label>
              <label style={label}>
                POV
                <select style={field} value={pov} onChange={(e) => setPov(e.target.value)}>
                  <option value="first">First</option>
                  <option value="second">Second</option>
                  <option value="third-limited">Third limited</option>
                  <option value="third-omniscient">Third omniscient</option>
                </select>
              </label>
              <label style={label}>
                Tense
                <select style={field} value={tense} onChange={(e) => setTense(e.target.value)}>
                  <option value="past">Past</option>
                  <option value="present">Present</option>
                </select>
              </label>
            </div>
            <Footer>
              <button style={button} onClick={() => setStep(0)} disabled={busy}>Back</button>
              <button
                style={busy ? { ...buttonPrimary, opacity: 0.6, cursor: "not-allowed" } : buttonPrimary}
                onClick={createStoryAndAdvance}
                disabled={busy}
              >
                {busy ? "Creating & casting…" : "Create & suggest cast"}
              </button>
            </Footer>
          </div>
        )}

        {/* ── Step 3: cast ── */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ ...sectionTitle, margin: 0 }}>Proposed cast — pick who joins the bible</p>
            {!castDrafts && busy && <p style={{ color: colors.dim, fontSize: 13 }}>Imagining a cast…</p>}
            {castDrafts && castDrafts.length === 0 && (
              <p style={{ color: colors.dim, fontSize: 13 }}>No suggestions returned — you can add characters later.</p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {castDrafts?.map((d, i) => (
                <label
                  key={i}
                  style={{
                    display: "flex", gap: 8, padding: 8, borderRadius: 8, cursor: "pointer",
                    background: castSelected.has(i) ? colors.panelAlt : "transparent",
                    border: `1px solid ${castSelected.has(i) ? colors.border : "transparent"}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={castSelected.has(i)}
                    onChange={() =>
                      setCastSelected((prev) => {
                        const n = new Set(prev);
                        n.has(i) ? n.delete(i) : n.add(i);
                        return n;
                      })
                    }
                    style={{ accentColor: colors.accent, marginTop: 2 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {d.name}
                      {d.role && <span style={{ color: colors.dim, fontWeight: 400 }}> · {d.role}</span>}
                    </div>
                    {!!d.traits?.length && (
                      <div style={{ fontSize: 12, color: colors.dim, marginTop: 2 }}>{d.traits.join(", ")}</div>
                    )}
                    {!!d.tendencies?.length && (
                      <div style={{ fontSize: 12, color: colors.dim, fontStyle: "italic", marginTop: 2 }}>
                        {d.tendencies.slice(0, 2).join(" · ")}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
            <Footer>
              <button style={button} onClick={regenerateCast} disabled={busy}>Regenerate</button>
              <div style={{ flex: 1 }} />
              <button style={button} onClick={() => setStep(3)} disabled={busy}>Skip</button>
              <button
                style={busy ? { ...buttonPrimary, opacity: 0.6, cursor: "not-allowed" } : buttonPrimary}
                onClick={addCastAndAdvance}
                disabled={busy}
              >
                {busy ? "Adding…" : `Add ${castSelected.size} & continue`}
              </button>
            </Footer>
          </div>
        )}

        {/* ── Step 4: opening scene ── */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ ...sectionTitle, margin: 0 }}>Opening scene — where the story begins</p>
            {sceneLoading ? (
              <p style={{ color: colors.dim, fontSize: 13 }}>Finding a strong opening…</p>
            ) : (
              <>
                <label style={label}>
                  Scene title
                  <input style={field} value={sceneTitle} onChange={(e) => setSceneTitle(e.target.value)} />
                </label>
                <label style={label}>
                  What happens
                  <textarea
                    style={{ ...field, minHeight: 90, resize: "vertical" }}
                    value={sceneSummary}
                    onChange={(e) => setSceneSummary(e.target.value)}
                  />
                </label>
                {sceneNames.length > 0 && (
                  <p style={{ fontSize: 12, color: colors.dim, margin: 0 }}>
                    Present: {sceneNames.join(", ")}
                  </p>
                )}
              </>
            )}
            <Footer>
              <button style={button} onClick={() => finish(false)} disabled={busy}>
                Finish without scene
              </button>
              <div style={{ flex: 1 }} />
              <button
                style={busy || !sceneTitle.trim() ? { ...buttonPrimary, opacity: 0.6, cursor: "not-allowed" } : buttonPrimary}
                onClick={() => finish(true)}
                disabled={busy || !sceneTitle.trim()}
              >
                {busy ? "Finishing…" : "Create scene & open story"}
              </button>
            </Footer>
          </div>
        )}
      </div>
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>{children}</div>;
}
