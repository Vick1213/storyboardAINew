"use client";
// The single GraphQL seam between the web client and the backend (CLAUDE.md: "the GraphQL
// API is the only seam between frontends and backend"). Every panel imports from here —
// no ad-hoc gql strings scattered in components, no re-declared entity shapes (we reuse
// @storyboard/types). Auth is Cognito userPool (configured in providers.tsx via Amplify).
import { generateClient } from "aws-amplify/api";
import type {
  Story,
  Character,
  NarrativeNode,
  NarrativeEdge,
} from "@storyboard/types";

// One client for the whole app. Amplify must be configured before this runs — it is,
// because providers.tsx calls configureAmplify() at module load on the client.
const client = generateClient();

// ── Selection sets (kept in one place so queries/subscriptions stay in sync) ──────────
const STORY_FIELDS = `id ownerSub title premise form genre pov tense createdAt`;
const CHARACTER_FIELDS = `id storyId name role traits tendencies speechPatterns elevenLabsVoiceId appearance state createdAt`;
const NODE_FIELDS = `id storyId title content summary charactersPresent status createdAt`;
const EDGE_FIELDS = `id storyId fromNodeId toNodeId choice createdAt`;

// graphql() returns a Promise (queries/mutations) or an Observable (subscriptions).
// This thin helper unwraps the `{ data: { <field>: T } }` envelope for the former.
async function run<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = (await client.graphql({ query, variables })) as { data: Record<string, T> };
  const key = Object.keys(res.data)[0]!; // single-field operations — always exactly one key
  return res.data[key] as T; // noUncheckedIndexedAccess widens to T | undefined; the key exists
}

// ── Queries ───────────────────────────────────────────────────────────────────────────
export const listStories = () =>
  run<Story[]>(`query { listStories { ${STORY_FIELDS} } }`);

export const listCharacters = (storyId: string) =>
  run<Character[]>(
    `query($storyId: ID!) { listCharacters(storyId: $storyId) { ${CHARACTER_FIELDS} } }`,
    { storyId },
  );

export const listNodes = (storyId: string) =>
  run<NarrativeNode[]>(
    `query($storyId: ID!) { listNodes(storyId: $storyId) { ${NODE_FIELDS} } }`,
    { storyId },
  );

export const listEdges = (storyId: string) =>
  run<NarrativeEdge[]>(
    `query($storyId: ID!) { listEdges(storyId: $storyId) { ${EDGE_FIELDS} } }`,
    { storyId },
  );

// AI-proposed cast (not persisted until the user accepts via createCharacter).
export interface CharacterDraft {
  name: string;
  role?: string;
  traits?: string[];
  tendencies?: string[];
  speechPatterns?: string;
  appearance?: string;
}
const DRAFT_FIELDS = `name role traits tendencies speechPatterns appearance`;
export const suggestCharacters = (storyId: string, count = 4) =>
  run<CharacterDraft[]>(
    `query($input: SuggestCharactersInput!) { suggestCharacters(input: $input) { ${DRAFT_FIELDS} } }`,
    { input: { storyId, count } },
  );

// ── Mutations ─────────────────────────────────────────────────────────────────────────
export type CreateStoryInput = Pick<Story, "title"> &
  Partial<Pick<Story, "premise" | "form" | "genre" | "pov" | "tense">>;
export const createStory = (input: CreateStoryInput) =>
  run<Story>(
    `mutation($input: CreateStoryInput!) { createStory(input: $input) { ${STORY_FIELDS} } }`,
    { input },
  );

export type CreateCharacterInput = Pick<Character, "storyId" | "name"> &
  Partial<Pick<Character, "role" | "traits" | "tendencies" | "speechPatterns" | "elevenLabsVoiceId" | "appearance">> & {
    state?: string; // AWSJSON is a JSON string on the wire
  };
export const createCharacter = (input: CreateCharacterInput) =>
  run<Character>(
    `mutation($input: CreateCharacterInput!) { createCharacter(input: $input) { ${CHARACTER_FIELDS} } }`,
    { input },
  );

export type UpdateCharacterInput = Pick<Character, "storyId" | "id"> &
  Partial<Pick<Character, "name" | "role" | "traits" | "tendencies" | "speechPatterns" | "elevenLabsVoiceId" | "appearance">> & {
    state?: string;
  };
export const updateCharacter = (input: UpdateCharacterInput) =>
  run<Character>(
    `mutation($input: UpdateCharacterInput!) { updateCharacter(input: $input) { ${CHARACTER_FIELDS} } }`,
    { input },
  );

export type CreateNodeInput = Pick<NarrativeNode, "storyId"> &
  Partial<Pick<NarrativeNode, "title" | "content" | "summary" | "charactersPresent">>;
export const createNode = (input: CreateNodeInput) =>
  run<NarrativeNode>(
    `mutation($input: CreateNodeInput!) { createNode(input: $input) { ${NODE_FIELDS} } }`,
    { input },
  );

export type UpdateNodeInput = Pick<NarrativeNode, "storyId" | "id"> &
  Partial<Pick<NarrativeNode, "title" | "content" | "summary" | "charactersPresent" | "status">>;
export const updateNode = (input: UpdateNodeInput) =>
  run<NarrativeNode>(
    `mutation($input: UpdateNodeInput!) { updateNode(input: $input) { ${NODE_FIELDS} } }`,
    { input },
  );

export type CreateEdgeInput = Pick<NarrativeEdge, "storyId" | "fromNodeId" | "toNodeId"> & {
  choice?: string; // AWSJSON
};
export const createEdge = (input: CreateEdgeInput) =>
  run<NarrativeEdge>(
    `mutation($input: CreateEdgeInput!) { createEdge(input: $input) { ${EDGE_FIELDS} } }`,
    { input },
  );

// ── Subscriptions (live sync — invariant #4's reactive plane) ─────────────────────────
// Each returns an unsubscribe fn. The backend fans out a matching mutation to every
// subscribed client; two tabs stay in sync without polling.
type Sub = { unsubscribe: () => void };

function subscribe<T>(
  query: string,
  storyId: string,
  field: string,
  onItem: (item: T) => void,
): () => void {
  const observable = client.graphql({ query, variables: { storyId } }) as {
    subscribe: (handlers: {
      next: (msg: { data: Record<string, T> }) => void;
      error: (e: unknown) => void;
    }) => Sub;
  };
  const sub = observable.subscribe({
    next: ({ data }) => {
      const item = data?.[field];
      if (item) onItem(item);
    },
    error: (e) => console.error(`subscription ${field} error`, e),
  });
  return () => sub.unsubscribe();
}

export const onCharacterCreated = (storyId: string, cb: (c: Character) => void) =>
  subscribe<Character>(
    `subscription($storyId: ID!) { onCharacterCreated(storyId: $storyId) { ${CHARACTER_FIELDS} } }`,
    storyId,
    "onCharacterCreated",
    cb,
  );

export const onCharacterUpdated = (storyId: string, cb: (c: Character) => void) =>
  subscribe<Character>(
    `subscription($storyId: ID!) { onCharacterUpdated(storyId: $storyId) { ${CHARACTER_FIELDS} } }`,
    storyId,
    "onCharacterUpdated",
    cb,
  );

export const onNodeCreated = (storyId: string, cb: (n: NarrativeNode) => void) =>
  subscribe<NarrativeNode>(
    `subscription($storyId: ID!) { onNodeCreated(storyId: $storyId) { ${NODE_FIELDS} } }`,
    storyId,
    "onNodeCreated",
    cb,
  );

export const onNodeUpdated = (storyId: string, cb: (n: NarrativeNode) => void) =>
  subscribe<NarrativeNode>(
    `subscription($storyId: ID!) { onNodeUpdated(storyId: $storyId) { ${NODE_FIELDS} } }`,
    storyId,
    "onNodeUpdated",
    cb,
  );

export const onEdgeCreated = (storyId: string, cb: (e: NarrativeEdge) => void) =>
  subscribe<NarrativeEdge>(
    `subscription($storyId: ID!) { onEdgeCreated(storyId: $storyId) { ${EDGE_FIELDS} } }`,
    storyId,
    "onEdgeCreated",
    cb,
  );

// ── Grounded writing (the streaming plane — NOT GraphQL; invariant #4) ────────────────
// Streams Claude's grounded prose for a node. Tokens stream straight from the Lambda URL;
// the committed prose is persisted separately via updateNode (DB = source of truth).
const STREAMING_URL = process.env.NEXT_PUBLIC_STREAMING_URL ?? "";
export type Intent = "continue" | "rewrite" | "ideate" | "draft";

export async function streamGrounded(
  body: { storyId: string; nodeId: string; intent: Intent },
  onToken: (chunk: string) => void,
): Promise<void> {
  if (!STREAMING_URL) throw new Error("NEXT_PUBLIC_STREAMING_URL is not set");
  const res = await fetch(STREAMING_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    onToken(decoder.decode(value, { stream: true }));
  }
}
