// Prop contracts shared by the Workspace (the stateful brain) and the presentational
// panels. Kept in one type-only module so neither side drifts and there's no circular
// import. The Workspace owns ALL state + subscriptions; panels are (mostly) pure views
// that call the provided callbacks. Mutation callbacks omit storyId — the Workspace
// already knows the active story and injects it.
import type {
  Story,
  Character,
  NarrativeNode,
  NarrativeEdge,
} from "@storyboard/types";
import type {
  CreateStoryInput,
  CreateCharacterInput,
  UpdateCharacterInput,
  CreateNodeInput,
  CreateEdgeInput,
  UpdateNodeInput,
} from "../lib/api";

export interface StoryListProps {
  stories: Story[];
  selectedId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  /** Create a story; the Workspace persists it and selects it. */
  onCreate: (input: CreateStoryInput) => Promise<void>;
}

export interface BiblePanelProps {
  story: Story;
  characters: Character[];
  /** storyId is injected by the Workspace. `state` is a JSON string (AWSJSON). */
  onCreateCharacter: (input: Omit<CreateCharacterInput, "storyId">) => Promise<void>;
  onUpdateCharacter: (input: UpdateCharacterInput) => Promise<void>;
}

export interface GraphPanelProps {
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onCreateNode: (input: Omit<CreateNodeInput, "storyId">) => Promise<void>;
  /** choice is a JSON string (AWSJSON) or omitted for a plain edge. */
  onCreateEdge: (input: Omit<CreateEdgeInput, "storyId">) => Promise<void>;
}

export interface NodeEditorProps {
  node: NarrativeNode;
  /** Full cast of the story, for the charactersPresent picker. */
  characters: Character[];
  storyId: string;
  /** Persist edits (and committed grounded prose) back to the node. */
  onSave: (input: UpdateNodeInput) => Promise<void>;
  /**
   * One action: create a child node AND the edge from this node to it, then select it.
   * A `branchLabel` makes it a decision-game fork (choice edge); omitted = a plain
   * continuation. Saves the two-form dance of create-node-then-create-edge.
   */
  onContinue: (fromNodeId: string, opts: { branchLabel?: string }) => Promise<void>;
}
