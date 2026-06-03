"use client";
// The authoring workspace — the stateful brain. Owns ALL story state and is the single
// place subscriptions are wired (invariant #4's reactive plane). Panels below are pure
// views: they render what they're given and call the mutation callbacks here. When a
// mutation fires, the matching AppSync subscription fans the new/updated item back to
// every connected client (including this one); upsertById dedupes so our own writes and
// the echoed subscription event converge to one row. That's how two tabs stay in sync.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Story,
  Character,
  NarrativeNode,
  NarrativeEdge,
} from "@storyboard/types";
import * as api from "../lib/api";
import { colors } from "../lib/ui";
import { StoryList } from "./StoryList";
import { BiblePanel } from "./BiblePanel";
import { GraphPanel } from "./GraphPanel";
import { NodeEditor } from "./NodeEditor";
import { Wizard } from "./Wizard";
import { buttonPrimary } from "../lib/ui";

function upsertById<T extends { id: string }>(prev: T[], item: T): T[] {
  const i = prev.findIndex((x) => x.id === item.id);
  if (i === -1) return [...prev, item];
  const next = prev.slice();
  next[i] = item;
  return next;
}

export function Workspace({ email, signOut }: { email?: string; signOut?: () => void }) {
  const [stories, setStories] = useState<Story[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storyId, setStoryId] = useState<string | null>(null);

  const [characters, setCharacters] = useState<Character[]>([]);
  const [nodes, setNodes] = useState<NarrativeNode[]>([]);
  const [edges, setEdges] = useState<NarrativeEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  // A node to auto-select once the story's graph finishes loading (set by the wizard,
  // which creates the opening node directly — the load effect applies it post-fetch).
  const pendingNodeRef = useRef<string | null>(null);

  // Load the user's stories once.
  useEffect(() => {
    let alive = true;
    api
      .listStories()
      .then((s) => alive && setStories(s))
      .catch((e) => console.error("listStories", e))
      .finally(() => alive && setStoriesLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // When the active story changes: clear, reload its bible+graph, (re)wire subscriptions.
  const subsRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    subsRef.current.forEach((u) => u());
    subsRef.current = [];
    setCharacters([]);
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    if (!storyId) return;

    let alive = true;
    Promise.all([
      api.listCharacters(storyId),
      api.listNodes(storyId),
      api.listEdges(storyId),
    ])
      .then(([cs, ns, es]) => {
        if (!alive) return;
        setCharacters(cs);
        setNodes(ns);
        setEdges(es);
        // Apply a wizard-requested selection now that nodes exist.
        if (pendingNodeRef.current) {
          setSelectedNodeId(pendingNodeRef.current);
          pendingNodeRef.current = null;
        }
      })
      .catch((e) => console.error("load story", e));

    subsRef.current = [
      api.onCharacterCreated(storyId, (c) => setCharacters((p) => upsertById(p, c))),
      api.onCharacterUpdated(storyId, (c) => setCharacters((p) => upsertById(p, c))),
      api.onNodeCreated(storyId, (n) => setNodes((p) => upsertById(p, n))),
      api.onNodeUpdated(storyId, (n) => setNodes((p) => upsertById(p, n))),
      api.onEdgeCreated(storyId, (e) => setEdges((p) => upsertById(p, e))),
    ];

    return () => {
      alive = false;
      subsRef.current.forEach((u) => u());
      subsRef.current = [];
    };
  }, [storyId]);

  // ── Mutation callbacks (storyId injected here so panels stay story-agnostic) ─────────
  const onCreateStory = useCallback(async (input: api.CreateStoryInput) => {
    const s = await api.createStory(input);
    setStories((p) => upsertById(p, s)); // no story subscription — update locally
    setStoryId(s.id);
  }, []);

  const onCreateCharacter = useCallback(
    async (input: Omit<api.CreateCharacterInput, "storyId">) => {
      if (!storyId) return;
      const c = await api.createCharacter({ ...input, storyId });
      setCharacters((p) => upsertById(p, c));
    },
    [storyId],
  );

  const onUpdateCharacter = useCallback(async (input: api.UpdateCharacterInput) => {
    const c = await api.updateCharacter(input);
    setCharacters((p) => upsertById(p, c));
  }, []);

  const onCreateNode = useCallback(
    async (input: Omit<api.CreateNodeInput, "storyId">) => {
      if (!storyId) return;
      const n = await api.createNode({ ...input, storyId });
      setNodes((p) => upsertById(p, n));
      setSelectedNodeId(n.id);
    },
    [storyId],
  );

  const onCreateEdge = useCallback(
    async (input: Omit<api.CreateEdgeInput, "storyId">) => {
      if (!storyId) return;
      const e = await api.createEdge({ ...input, storyId });
      setEdges((p) => upsertById(p, e));
    },
    [storyId],
  );

  const onSaveNode = useCallback(async (input: api.UpdateNodeInput) => {
    const n = await api.updateNode(input);
    setNodes((p) => upsertById(p, n));
  }, []);

  // One action = child node + edge from the source. A branchLabel makes it a choice
  // edge (decision-game fork, invariant #2). Replaces the create-node-then-edge dance.
  const onContinueFromNode = useCallback(
    async (fromNodeId: string, opts: { branchLabel?: string }) => {
      if (!storyId) return;
      const title = opts.branchLabel?.trim() || "Untitled scene";
      const child = await api.createNode({ storyId, title });
      setNodes((p) => upsertById(p, child));
      const edge = await api.createEdge({
        storyId,
        fromNodeId,
        toNodeId: child.id,
        ...(opts.branchLabel?.trim()
          ? { choice: JSON.stringify({ label: opts.branchLabel.trim() }) }
          : {}),
      });
      setEdges((p) => upsertById(p, edge));
      setSelectedNodeId(child.id);
    },
    [storyId],
  );

  // The wizard creates story/characters/opening-node directly via the API; here we just
  // adopt the new story, queue the opening node for selection, and let the story-change
  // effect load the freshly-created bible + graph from the server.
  const onWizardComplete = useCallback((s: Story, openingNodeId: string | null) => {
    setStories((p) => upsertById(p, s));
    pendingNodeRef.current = openingNodeId;
    setStoryId(s.id);
    setShowWizard(false);
  }, []);

  const story = stories.find((s) => s.id === storyId) ?? null;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <strong style={{ fontSize: 16 }}>
          StoryboardAI{story ? <span style={{ color: colors.dim, fontWeight: 400 }}> · {story.title}</span> : null}
        </strong>
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: colors.dim }}>
          {email && <span>{email}</span>}
          {signOut && (
            <button
              onClick={signOut}
              style={{ background: "none", border: `1px solid ${colors.border}`, color: colors.text, borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", flex: 1, minHeight: 0 }}>
        <aside style={{ borderRight: `1px solid ${colors.border}`, overflowY: "auto", padding: 16 }}>
          <button
            onClick={() => setShowWizard(true)}
            style={{ ...buttonPrimary, width: "100%", marginBottom: 16 }}
          >
            ✨ New story (guided)
          </button>
          <StoryList
            stories={stories}
            selectedId={storyId}
            loading={storiesLoading}
            onSelect={setStoryId}
            onCreate={onCreateStory}
          />
        </aside>

        <main style={{ overflowY: "auto", padding: 20, minWidth: 0 }}>
          {!story ? (
            <div style={{ color: colors.dim, marginTop: 60, textAlign: "center", display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
              <div>Start a new story and the AI will help you cast it and find its opening.</div>
              <button onClick={() => setShowWizard(true)} style={buttonPrimary}>
                ✨ Start guided setup
              </button>
              <div style={{ fontSize: 12 }}>…or pick one on the left.</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 20, alignItems: "start" }}>
              <BiblePanel
                story={story}
                characters={characters}
                onCreateCharacter={onCreateCharacter}
                onUpdateCharacter={onUpdateCharacter}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                <GraphPanel
                  nodes={nodes}
                  edges={edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  onCreateNode={onCreateNode}
                  onCreateEdge={onCreateEdge}
                />
                {selectedNode && (
                  <NodeEditor
                    key={selectedNode.id}
                    node={selectedNode}
                    characters={characters}
                    storyId={story.id}
                    onSave={onSaveNode}
                    onContinue={onContinueFromNode}
                  />
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {showWizard && (
        <Wizard onClose={() => setShowWizard(false)} onComplete={onWizardComplete} />
      )}
    </div>
  );
}
