import type { Character, NarrativeNode, PlotThread, StyleGuide, Story } from "@storyboard/types";

// The assembler depends on these INTERFACES, never on a concrete store. Today they're
// backed by DynamoDB (state) + Aurora pgvector (retrieval); swapping either is invisible here.

export interface BiblePort {
  getStory(storyId: string): Promise<Story | null>;
  getStyleGuide(storyId: string): Promise<StyleGuide | null>;
  getCharacters(ids: string[]): Promise<Character[]>;
  getOpenPlotThreads(storyId: string): Promise<PlotThread[]>;
}

export interface GraphPort {
  getNode(nodeId: string): Promise<NarrativeNode | null>;
  /** Walk the active path BACKWARD from a node (branching => "previous" is path-dependent). */
  getRecentPath(nodeId: string, k: number): Promise<NarrativeNode[]>;
  /** Rolled-up summary of everything before the recent window. */
  getArcSummary(storyId: string, beforeNodeId: string): Promise<string>;
}

export interface RetrievalPort {
  /** Vector search (Aurora pgvector) over node summaries + bible entries. */
  search(storyId: string, query: string, limit: number): Promise<RetrievedChunk[]>;
}

export interface RetrievedChunk {
  kind: "node" | "character" | "lore";
  id: string;
  text: string;
  score: number;
}
