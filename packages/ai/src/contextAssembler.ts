import type { Character } from "@storyboard/types";
import type { BiblePort, GraphPort, RetrievalPort } from "./ports";

// ── docs/ARCHITECTURE.md §4 — THE HEART OF THE CODEBASE ──────────────────────
// Pure, testable function: (storyId, nodeId, intent) -> a budgeted prompt context.
// You cannot fit a novel + full bible in a window, so consistency is a retrieval +
// summarization problem. This layers the right slice under a token budget.

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
  /** STABLE prefix — premise + style. Put first so it is prompt-cacheable. */
  system: string;
  /** Assembled working context (cast, recent prose, retrieved facts, obligations). */
  context: string;
  /** What the model is being asked to do, on which node. */
  instruction: string;
  estimatedTokens: number;
}

// Rough heuristic; replace with a real tokenizer before tuning budgets.
const estTokens = (s: string) => Math.ceil(s.length / 4);

const characterCard = (c: Character): string =>
  [
    `## ${c.name}${c.role ? ` (${c.role})` : ""}`,
    c.traits?.length ? `Traits: ${c.traits.join(", ")}` : "",
    c.tendencies?.length ? `Tendencies: ${c.tendencies.join(", ")}` : "",
    c.speechPatterns ? `Voice: ${c.speechPatterns}` : "",
    c.state && Object.keys(c.state).length ? `State: ${JSON.stringify(c.state)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
    deps.graph.getNode(nodeId),
  ]);
  if (!story) throw new Error(`Story ${storyId} not found`);

  // 1) Always-on, stable -> cacheable system prefix.
  const system = [
    `You are co-authoring "${story.title}".`,
    story.premise ? `Premise: ${story.premise}` : "",
    style ? `Style — POV: ${style.pov ?? story.pov}; tense: ${style.tense ?? story.tense}; tone: ${style.tone ?? ""}; rating: ${style.contentRating ?? "unspecified"}.` : "",
    `Stay consistent with the bible below. Never contradict established facts.`,
  ]
    .filter(Boolean)
    .join("\n");

  // 2) Cast in scene (full cards).
  const cast = node?.charactersPresent?.length
    ? await deps.bible.getCharacters(node.charactersPresent)
    : [];

  // 3) Recent narrative, verbatim, along the active path.
  const recent = await deps.graph.getRecentPath(nodeId, recentK);

  // 4) Distant narrative, summarized (compression, not truncation).
  const arc = await deps.graph.getArcSummary(storyId, nodeId);

  // 5) Retrieved (RAG) — pulls in the thing established 200 pages ago.
  const query = [node?.summary, node?.content, ...cast.map((c) => c.name)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 500);
  const retrieved = query ? await deps.retrieval.search(storyId, query, 8) : [];

  // 6) Open obligations relevant to the present cast.
  const threads = await deps.bible.getOpenPlotThreads(storyId);

  // Assemble under budget: cheap-and-essential first, retrieval last (most droppable).
  const sections: Array<{ label: string; body: string; priority: number }> = [
    { label: "CAST IN SCENE", body: cast.map(characterCard).join("\n\n"), priority: 1 },
    { label: "RECENT (verbatim)", body: recent.map((n) => n.content ?? n.summary ?? "").join("\n\n"), priority: 2 },
    { label: "STORY SO FAR (summary)", body: arc, priority: 3 },
    { label: "OPEN THREADS", body: threads.map((t) => `- ${t.summary}`).join("\n"), priority: 4 },
    { label: "POSSIBLY RELEVANT", body: retrieved.map((r) => `(${r.kind}) ${r.text}`).join("\n"), priority: 5 },
  ].filter((s) => s.body.trim().length > 0);

  let used = estTokens(system);
  const kept: string[] = [];
  for (const s of sections.sort((a, b) => a.priority - b.priority)) {
    const block = `\n### ${s.label}\n${s.body}`;
    const cost = estTokens(block);
    if (used + cost > budget) continue; // drop lowest-priority sections that don't fit
    kept.push(block);
    used += cost;
  }

  const instruction = describeIntent(intent, node?.title ?? nodeId);

  return {
    system,
    context: kept.join("\n"),
    instruction,
    estimatedTokens: used + estTokens(instruction),
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
