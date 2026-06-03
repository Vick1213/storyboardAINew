// Canonical domain shapes for StoryboardAI. One definition, shared by the API,
// the AI runtime, and every client. Mirrors the GraphQL schema + docs/ARCHITECTURE.md §3.

/** The shape/medium a story is written in — drives the format Claude writes in. */
export type StoryForm =
  | "novel"
  | "novella"
  | "short-story"
  | "flash-fiction"
  | "screenplay"
  | "stage-play"
  | "serial"
  | "interactive";

export interface Story {
  id: string;
  ownerSub: string;
  title: string;
  premise?: string;
  /** novel / novella / screenplay / … — feeds the assembler's cacheable style prefix. */
  form?: StoryForm;
  genre?: string;
  pov?: string;
  tense?: string;
  createdAt: string;
}

/** A character file — the "separate file" that makes storytelling persistent. */
export interface Character {
  id: string;
  storyId: string;
  name: string;
  role?: string;
  traits?: string[];
  tendencies?: string[];
  /** How they SPEAK — drives dialogue + TTS. */
  speechPatterns?: string;
  elevenLabsVoiceId?: string;
  /** Visual anchor for image consistency. */
  appearance?: string;
  /** Mutable: injuries, knowledge, mood, location — updated by the continuity pass. */
  state?: Record<string, unknown>;
  createdAt: string;
}

/** A scene/beat — the unit of writing and generation. */
export interface NarrativeNode {
  id: string;
  storyId: string;
  title?: string;
  content?: string;
  /** 1–3 sentence compression used by the context assembler. */
  summary?: string;
  charactersPresent?: string[];
  status?: "draft" | "revised" | "locked";
  createdAt: string;
}

/** Directed edge between nodes. A `choice` makes it a decision-game fork (graph, not list). */
export interface NarrativeEdge {
  id: string;
  storyId: string;
  fromNodeId: string;
  toNodeId: string;
  choice?: {
    label: string;
    condition?: string;
    effects?: Record<string, unknown>;
  };
}

export interface PlotThread {
  id: string;
  storyId: string;
  summary: string;
  status: "open" | "foreshadowed" | "resolved";
  involvedCharacterIds?: string[];
}

export interface StyleGuide {
  storyId: string;
  pov?: string;
  tense?: string;
  tone?: string;
  genre?: string;
  proseStyle?: string;
  contentRating?: string;
}

export interface Artifact {
  id: string;
  storyId: string;
  nodeId?: string;
  characterId?: string;
  kind: "image" | "audio" | "video" | "vr";
  status: "queued" | "running" | "done" | "failed";
  s3Key?: string;
  inputHash: string;
  cost?: number;
  meta?: Record<string, unknown>;
}

/** The decision-game runtime cursor (not stored on the graph). */
export interface Playthrough {
  id: string;
  storyId: string;
  userId: string;
  currentNodeId: string;
  path: string[];
  state: Record<string, unknown>;
}
