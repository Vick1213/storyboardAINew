import type { Character, StoryForm } from "@storyboard/types";
import type { BiblePort, GraphPort, RetrievalPort } from "./ports";

// Form-specific FORMAT directives. The story's form (screenplay vs novella vs …) changes
// HOW the model writes, not just what — so it goes in the stable, cacheable system prefix
// (invariant #6), keyed off a value that's constant for the life of the story. Unknown /
// undefined forms fall back to prose (the default for a writing app).
const FORM_DIRECTIVES: Record<StoryForm, string> = {
  novel: "Form: novel. Write in prose: paragraphs, narration, interiority. Pace for the long form.",
  novella: "Form: novella. Write in prose: paragraphs and narration, tighter and more focused than a novel.",
  "short-story": "Form: short story. Write in prose, economical — every scene earns its place toward a single effect.",
  "flash-fiction": "Form: flash fiction. Write in prose, extremely compressed; imply more than you state.",
  screenplay:
    "Form: screenplay. Format as a screenplay: scene headings (INT./EXT. LOCATION — TIME), present-tense action lines, and character cue lines (NAME in caps) above dialogue. No prose narration or interior monologue — externalize everything into action and dialogue.",
  "stage-play":
    "Form: stage play. Format for the stage: ACT/SCENE headings, character names before dialogue, and parenthetical stage directions. Convey interiority through dialogue and action, not narration.",
  serial: "Form: serial. Write in prose as an episodic installment — end on a hook, assume returning readers.",
  interactive:
    "Form: interactive fiction. Write in prose for a branching, choice-driven story; keep scenes self-contained so they can lead to multiple continuations.",
};

const formDirective = (form?: StoryForm): string =>
  form && FORM_DIRECTIVES[form] ? FORM_DIRECTIVES[form] : "";

// ── docs/ARCHITECTURE.md §4 — THE HEART OF THE CODEBASE ──────────────────────
// Pure, testable function: (storyId, nodeId, intent) -> a budgeted prompt context.
// You cannot fit a novel + full bible in a window, so consistency is a retrieval +
// summarization problem. This layers the right slice under a token budget, and
// SEGMENTS the result by cache-stability so the caller can prompt-cache the stable
// prefix (invariant #6): premise+style (cross-session) and the bible slice (stable
// within a session) are cacheable; recent prose + retrieval change and are not.

export type Intent = "continue" | "rewrite" | "ideate" | "draft";

export interface AssembleDeps {
  bible: BiblePort;
  graph: GraphPort;
  retrieval: RetrievalPort;
}

export interface AssembleOptions {
  /** Total budget for the assembled context (excludes the model's output). */
  tokenBudget?: number;
  /** Verbatim recent nodes along the active path. */
  recentK?: number;
}

export interface PromptContext {
  /** STABLE across the whole session — premise + style. Prompt-cache breakpoint A. */
  system: string;
  /** Stable WITHIN a session — cast cards, open threads, arc summary. Cache breakpoint B. */
  cacheableContext: string;
  /** Changes as the story grows / per query — recent verbatim prose + retrieved facts. */
  dynamicContext: string;
  /** What the model is being asked to do, on which node. */
  instruction: string;
  estimatedTokens: number;
  /** What actually made it into the context (post-budget) — for observability/UI, not sent to the model. */
  included: {
    cast: string[];
    recent: number;
    retrieved: number;
    threads: number;
    arc: boolean;
  };
}

// Rough heuristic; replace with a real tokenizer before tuning budgets.
export const estTokens = (s: string) => Math.ceil(s.length / 4);

const characterCard = (c: Character): string =>
  [
    `## ${c.name}${c.role ? ` (${c.role})` : ""}`,
    c.traits?.length ? `Traits: ${c.traits.join(", ")}` : "",
    c.tendencies?.length ? `Tendencies: ${c.tendencies.join(", ")}` : "",
    c.speechPatterns ? `Voice: ${c.speechPatterns}` : "",
    c.appearance ? `Appearance: ${c.appearance}` : "",
    c.state && Object.keys(c.state).length ? `State: ${JSON.stringify(c.state)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

type Segment = "cacheable" | "dynamic";

export async function assembleContext(
  storyId: string,
  nodeId: string,
  intent: Intent,
  deps: AssembleDeps,
  opts: AssembleOptions = {},
): Promise<PromptContext> {
  const budget = opts.tokenBudget ?? 12_000;
  const recentK = opts.recentK ?? 6;

  const [story, style, node] = await Promise.all([
    deps.bible.getStory(storyId),
    deps.bible.getStyleGuide(storyId),
    deps.graph.getNode(storyId, nodeId),
  ]);
  if (!story) throw new Error(`Story ${storyId} not found`);

  // 1) Always-on, stable -> cacheable system prefix (cross-session).
  const system = [
    `You are co-authoring "${story.title}".`,
    story.premise ? `Premise: ${story.premise}` : "",
    formDirective(story.form),
    style || story.pov || story.tense
      ? `Style — POV: ${style?.pov ?? story.pov ?? "unspecified"}; tense: ${style?.tense ?? story.tense ?? "unspecified"}; tone: ${style?.tone ?? "unspecified"}; rating: ${style?.contentRating ?? "unspecified"}.`
      : "",
    `Stay consistent with the bible below. Never contradict established facts; honour each character's traits, tendencies, and voice.`,
    // Fork discipline: at a branch, two sibling nodes share the same recent prose but
    // differ in cast/premise. Without this, "continue" drifts toward whoever is most
    // vivid in the recent window (e.g. a character dropped at the fork). No per-node
    // names here, so the prefix stays cross-session stable and cacheable (invariant #6).
    `Write only the scene described in the instruction. Treat CAST IN SCENE as the complete set of characters present; do not reintroduce characters or settings from earlier prose unless the instruction calls for them.`,
  ]
    .filter(Boolean)
    .join("\n");

  // 2) Cast in scene (full cards) — stable within a session.
  const cast = node?.charactersPresent?.length
    ? await deps.bible.getCharacters(storyId, node.charactersPresent)
    : [];

  // 3) Recent narrative, verbatim, along the active path (changes as the story grows).
  const recent = await deps.graph.getRecentPath(storyId, nodeId, recentK);

  // 4) Distant narrative, summarized (compression, not truncation) — stable within session.
  const arc = await deps.graph.getArcSummary(storyId, nodeId);

  // 5) Retrieved (RAG) — pulls in the thing established 200 pages ago (per-query).
  const query = [node?.summary, node?.content, ...cast.map((c) => c.name)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const retrieved = query ? await deps.retrieval.search(storyId, query, 8) : [];

  // 6) Open obligations relevant to the present cast.
  const threads = await deps.bible.getOpenPlotThreads(storyId);

  // Assemble under budget. Drop lowest-priority sections that don't fit; retrieval is
  // the most droppable, the cast is essential. Each section carries its cache segment.
  const allSections: Array<{ label: string; body: string; priority: number; segment: Segment }> = [
    { label: "CAST IN SCENE", body: cast.map(characterCard).join("\n\n"), priority: 1, segment: "cacheable" },
    // getRecentPath walks BACKWARD (newest-first); present it chronologically so the
    // model reads the lead-up in story order before continuing.
    { label: "RECENT (verbatim)", body: [...recent].reverse().map((n) => n.content ?? n.summary ?? "").join("\n\n"), priority: 2, segment: "dynamic" },
    { label: "STORY SO FAR (summary)", body: arc, priority: 3, segment: "cacheable" },
    { label: "OPEN THREADS", body: threads.map((t) => `- ${t.summary}`).join("\n"), priority: 4, segment: "cacheable" },
    { label: "POSSIBLY RELEVANT", body: retrieved.map((r) => `(${r.kind}) ${r.text}`).join("\n"), priority: 5, segment: "dynamic" },
  ];
  const sections = allSections.filter((s) => s.body.trim().length > 0);

  let used = estTokens(system);
  const kept: Array<{ label: string; block: string; segment: Segment }> = [];
  for (const s of [...sections].sort((a, b) => a.priority - b.priority)) {
    const block = `### ${s.label}\n${s.body}`;
    const cost = estTokens(block);
    if (used + cost > budget) continue; // drop lowest-priority sections that don't fit
    kept.push({ label: s.label, block, segment: s.segment });
    used += cost;
  }

  // Preserve a stable, deterministic section order within each segment so the cacheable
  // prefix is byte-identical across calls (a reordered prefix is a cache miss).
  const keptLabels = new Set(kept.map((k) => k.label));
  const join = (seg: Segment) =>
    kept.filter((k) => k.segment === seg).map((k) => k.block).join("\n\n");

  const instruction = describeIntent(intent, node?.title ?? nodeId, node?.summary);

  return {
    system,
    cacheableContext: join("cacheable"),
    dynamicContext: join("dynamic"),
    instruction,
    estimatedTokens: used + estTokens(instruction),
    included: {
      cast: keptLabels.has("CAST IN SCENE") ? cast.map((c) => c.name) : [],
      recent: keptLabels.has("RECENT (verbatim)") ? recent.length : 0,
      retrieved: keptLabels.has("POSSIBLY RELEVANT") ? retrieved.length : 0,
      threads: keptLabels.has("OPEN THREADS") ? threads.length : 0,
      arc: keptLabels.has("STORY SO FAR (summary)"),
    },
  };
}

function describeIntent(intent: Intent, nodeRef: string, summary?: string): string {
  // The node's own summary is THIS branch's premise. Passing only the title let
  // "continue" follow whatever was most salient in the recent prose — at a fork that
  // meant importing a sibling branch's scene. The summary anchors the model to where
  // this node actually goes. (Appended, so existing intent prefixes are unchanged.)
  const scene = summary ? ` This scene: ${summary}` : "";
  switch (intent) {
    case "continue":
      return `Continue the prose from where "${nodeRef}" leaves off, in voice and style.${scene}`;
    case "rewrite":
      return `Rewrite "${nodeRef}" preserving plot beats but improving the prose.${scene}`;
    case "ideate":
      return `Propose 3 distinct directions the story could take from "${nodeRef}".${scene}`;
    case "draft":
      return `Draft the scene "${nodeRef}" from the established context.${scene}`;
  }
}
