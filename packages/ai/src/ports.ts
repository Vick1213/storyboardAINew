import type { Character, NarrativeNode, PlotThread, StyleGuide, Story } from "@storyboard/types";

// The assembler depends on these INTERFACES, never on a concrete store. Today they're
// backed by DynamoDB (state) + a naive keyword scan standing in for Aurora pgvector
// (retrieval); swapping either is invisible here.
//
// Note: node-addressed methods take `storyId` as well as `nodeId`. The single-table
// design keys nodes by (STORY#<storyId>, NODE#<nodeId>), so a bare `nodeId` can't form
// a key. `storyId` is always in scope at the assembler's call sites, so we thread it
// through rather than add a GSI on node id. (docs/ARCHITECTURE.md §3.2)

export interface BiblePort {
  getStory(storyId: string): Promise<Story | null>;
  getStyleGuide(storyId: string): Promise<StyleGuide | null>;
  getCharacters(storyId: string, ids: string[]): Promise<Character[]>;
  getOpenPlotThreads(storyId: string): Promise<PlotThread[]>;
}

export interface GraphPort {
  getNode(storyId: string, nodeId: string): Promise<NarrativeNode | null>;
  /**
   * Walk the active path BACKWARD from a node, following edges, newest-first.
   * Branching means "previous" is path-dependent — we follow incoming edges, NOT
   * table/insertion order. With reconvergence (multiple incoming edges) the adapter
   * picks one deterministic parent; the assembler treats the result as the active path.
   */
  getRecentPath(storyId: string, nodeId: string, k: number): Promise<NarrativeNode[]>;
  /** Rolled-up summary of the path BEFORE the recent window (compression, not truncation). */
  getArcSummary(storyId: string, beforeNodeId: string): Promise<string>;
}

export interface RetrievalPort {
  /** Vector search (Aurora pgvector, eventually) over node summaries + bible entries. */
  search(storyId: string, query: string, limit: number): Promise<RetrievedChunk[]>;
}

export interface RetrievedChunk {
  kind: "node" | "character" | "lore";
  id: string;
  text: string;
  score: number;
}
