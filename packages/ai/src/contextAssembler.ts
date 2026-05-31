import type { Character } from "@storyboard/types";
import type { BiblePort, GraphPort, RetrievalPort } from "./ports";

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
    style || story.pov || story.tense
      ? `Style — POV: ${style?.pov ?? story.pov ?? "unspecified"}; tense: ${style?.tense ?? story.tense ?? "unspecified"}; tone: ${style?.tone ?? "unspecified"}; rating: ${style?.contentRating ?? "unspecified"}.`
      : "",
    `Stay consistent with the bible below. Never contradict established facts; honour each character's traits, tendencies, and voice.`,
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

  const instruction = describeIntent(intent, node?.title ?? nodeId);

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

function describeIntent(intent: Intent, nodeRef: string): string {
  switch (intent) {
    case "continue":
      return `Continue the prose from where "${nodeRef}" leaves off, in voice and style.`;
    case "rewrite":
      return `Rewrite "${nodeRef}" preserving plot beats but improving the prose.`;
    case "ideate":
      return `Propose 3 distinct directions the story could take from "${nodeRef}".`;
    case "draft":
      return `Draft the scene "${nodeRef}" from the established context.`;
  }
}
