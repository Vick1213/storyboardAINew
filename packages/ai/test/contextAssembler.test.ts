import { describe, it, expect } from "vitest";
import type { Character, NarrativeNode, PlotThread, Story, StyleGuide } from "@storyboard/types";
import {
  assembleContext,
  estTokens,
  type AssembleDeps,
  type BiblePort,
  type GraphPort,
  type RetrievalPort,
  type RetrievedChunk,
} from "../src/index";

// ── In-memory fakes — the assembler depends only on the port interfaces ──────

const STORY: Story = {
  id: "s1",
  ownerSub: "u1",
  title: "The Ashfall Letters",
  premise: "A courier carries letters across a city that forgets its dead.",
  pov: "third-limited",
  tense: "past",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const STYLE: StyleGuide = {
  storyId: "s1",
  pov: "third-limited",
  tense: "past",
  tone: "elegiac, dry-witted",
  contentRating: "PG-13",
};

const MARA: Character = {
  id: "c-mara",
  storyId: "s1",
  name: "Mara",
  role: "protagonist",
  traits: ["stubborn", "loyal to a fault"],
  tendencies: ["deflects with humor when scared"],
  speechPatterns: "clipped, sardonic",
  appearance: "scarred courier's coat, ash-grey eyes",
  state: { location: "the Lower Docks", wounded: true },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const JON: Character = {
  id: "c-jon",
  storyId: "s1",
  name: "Jon",
  role: "supporting",
  traits: ["cautious"],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const NODES: Record<string, NarrativeNode> = {
  n1: { id: "n1", storyId: "s1", title: "Arrival", content: "Mara reached the docks at dusk.", summary: "Mara arrives at the docks.", createdAt: "2026-01-01T00:00:01.000Z" },
  n2: { id: "n2", storyId: "s1", title: "The Handoff", content: "The letter changed hands.", summary: "Mara hands off the letter.", createdAt: "2026-01-01T00:00:02.000Z" },
  n3: { id: "n3", storyId: "s1", title: "Ambush", content: "Steel in the fog.", summary: "An ambush in the fog.", charactersPresent: ["c-mara", "c-jon"], createdAt: "2026-01-01T00:00:03.000Z" },
};

const THREADS: PlotThread[] = [
  { id: "t1", storyId: "s1", summary: "Who sent the unsigned letter?", status: "open" },
  { id: "t2", storyId: "s1", summary: "The resolved debt to the harbormaster.", status: "resolved" },
];

function makeDeps(over: Partial<{ retrieval: RetrievedChunk[]; threads: PlotThread[] }> = {}): AssembleDeps {
  const bible: BiblePort = {
    getStory: async (id) => (id === STORY.id ? STORY : null),
    getStyleGuide: async () => STYLE,
    getCharacters: async (_storyId, ids) => [MARA, JON].filter((c) => ids.includes(c.id)),
    getOpenPlotThreads: async () => over.threads ?? THREADS.filter((t) => t.status !== "resolved"),
  };
  const graph: GraphPort = {
    getNode: async (_storyId, nodeId) => NODES[nodeId] ?? null,
    getRecentPath: async (_storyId, _nodeId, k) => [NODES.n2, NODES.n1].slice(0, k),
    getArcSummary: async () => "Earlier: Mara took the courier's oath and lost her brother to the fog.",
  };
  const retrieval: RetrievalPort = {
    search: async () =>
      over.retrieval ?? [{ kind: "lore", id: "l1", text: "The fog erases names from gravestones.", score: 0.9 }],
  };
  return { bible, graph, retrieval };
}

describe("assembleContext", () => {
  it("throws when the story is missing", async () => {
    await expect(assembleContext("nope", "n3", "continue", makeDeps())).rejects.toThrow(/not found/);
  });

  it("puts premise + style into the stable system prefix", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.system).toContain("The Ashfall Letters");
    expect(ctx.system).toContain("A courier carries letters");
    expect(ctx.system).toContain("third-limited");
    expect(ctx.system).toContain("elegiac");
  });

  it("includes full character cards for charactersPresent, in the cacheable segment", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.cacheableContext).toContain("## Mara (protagonist)");
    expect(ctx.cacheableContext).toContain("deflects with humor when scared");
    expect(ctx.cacheableContext).toContain('"wounded":true');
    expect(ctx.cacheableContext).toContain("## Jon");
    // cards are bible state, not dynamic prose
    expect(ctx.dynamicContext).not.toContain("## Mara");
  });

  it("omits the cast block when the node has no charactersPresent", async () => {
    const ctx = await assembleContext("s1", "n1", "continue", makeDeps());
    expect(ctx.cacheableContext).not.toContain("## Mara");
  });

  it("routes recent verbatim prose + retrieval into the dynamic segment, chronologically", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.dynamicContext).toContain("The letter changed hands."); // recent (n2)
    expect(ctx.dynamicContext).toContain("Mara reached the docks"); // recent (n1)
    expect(ctx.dynamicContext).toContain("The fog erases names"); // retrieved
    // getRecentPath returns newest-first [n2, n1]; the block must read oldest-first.
    expect(ctx.dynamicContext.indexOf("Mara reached the docks")).toBeLessThan(
      ctx.dynamicContext.indexOf("The letter changed hands."),
    );
  });

  it("puts open threads + arc summary in the cacheable segment and skips resolved threads", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.cacheableContext).toContain("Who sent the unsigned letter?");
    expect(ctx.cacheableContext).toContain("took the courier's oath");
    expect(ctx.cacheableContext).not.toContain("harbormaster");
  });

  it("maps each intent to its instruction", async () => {
    const deps = makeDeps();
    expect((await assembleContext("s1", "n3", "continue", deps)).instruction).toMatch(/^Continue/);
    expect((await assembleContext("s1", "n3", "rewrite", deps)).instruction).toMatch(/^Rewrite/);
    expect((await assembleContext("s1", "n3", "ideate", deps)).instruction).toMatch(/3 distinct directions/);
    expect((await assembleContext("s1", "n3", "draft", deps)).instruction).toMatch(/^Draft/);
  });

  it("anchors the instruction to the node's own summary (fork premise, not just the title)", async () => {
    // The fork-drift bug: "continue" with only the title let the model follow the
    // recent prose into a sibling branch. The node summary must reach the model.
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.instruction).toContain("An ambush in the fog.");
  });

  it("omits the scene clause when the node has no summary", async () => {
    const noSummary: NarrativeNode = { id: "ns", storyId: "s1", title: "Untitled", createdAt: "2026-01-01T00:00:09.000Z" };
    const deps = makeDeps();
    deps.graph.getNode = async () => noSummary;
    const ctx = await assembleContext("s1", "ns", "continue", deps);
    expect(ctx.instruction).not.toContain("This scene:");
  });

  it("states fork discipline (cast = who is present) in the cacheable system prefix", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.system).toContain("CAST IN SCENE");
    expect(ctx.system).toMatch(/do not reintroduce characters/i);
  });

  it("is deterministic — repeated calls produce a byte-identical cacheable prefix", async () => {
    const a = await assembleContext("s1", "n3", "continue", makeDeps());
    const b = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(b.system).toBe(a.system);
    expect(b.cacheableContext).toBe(a.cacheableContext);
  });

  it("reports what actually made it into the context via `included`", async () => {
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps());
    expect(ctx.included.cast).toEqual(["Mara", "Jon"]);
    expect(ctx.included.recent).toBe(2);
    expect(ctx.included.retrieved).toBe(1);
    expect(ctx.included.threads).toBe(1);
    expect(ctx.included.arc).toBe(true);
  });

  it("drops the lowest-priority section (retrieval) first under a tight budget", async () => {
    // Big retrieved chunk so it is clearly the marginal section.
    const bigRetrieval: RetrievedChunk[] = [
      { kind: "lore", id: "big", text: "X".repeat(4000), score: 0.5 },
    ];
    const ctx = await assembleContext("s1", "n3", "continue", makeDeps({ retrieval: bigRetrieval }), {
      tokenBudget: 600,
    });
    // Cast (priority 1) survives; the giant retrieval (priority 5) is dropped.
    expect(ctx.cacheableContext).toContain("## Mara");
    expect(ctx.dynamicContext).not.toContain("XXXX");
    expect(ctx.estimatedTokens).toBeLessThanOrEqual(600 + estTokens(ctx.instruction) + 1);
  });
});
