# StoryboardAI — Architecture & Product Design

> "Claude Code, but for writing stories." A multimodal, globally-synced creative
> environment where a story is a **project** — with a living story bible, persistent
> characters, and branching narrative — that an AI agent co-authors with you across
> text, image, and audio (and eventually video and VR).

This document is the source of truth for *what we are building and why the pieces fit*.
It is written for an engineer who wants the real reasoning, not a brochure. Read the
**§3 Data Model** and **§4 Context-Assembly & Continuity** sections closely — those are
the actual product. Everything else (stack, infra) is commodity and swappable.

---

## 0. The one-paragraph thesis

Most "AI writing" tools are one-shot prompt boxes: you ask, it writes, it forgets. They
feel like talking to a stranger every paragraph. The thing that makes *real* storytelling
work is **persistent, authoritative state** — a character who behaves consistently in
chapter 30 the way they were established in chapter 1; a world whose rules don't quietly
change; plot threads that get paid off. So the central engineering bet of this product is
not "call an LLM." It is: **maintain a structured story bible as the source of truth, and
assemble exactly the right slice of it into the model's context on every action, then
check the model's output back against it for drift.** Get that loop right and the rest
(voice, images, audio, branching) hangs off it cleanly.

---

## 1. Product scope & phasing (decided)

**v1 magical loop:** writing + audio + image, with persistent characters whose traits and
tendencies live in their own files. AI is **toggleable** between an autonomous *agent* and
a steerable *copilot*, with emphasis on agentic assistance. A reader can passively
read/listen, or go deep — develop complex characters and ask the AI for branching paths,
a **decision-game** where choices fork the narrative.

| Phase | What ships | Why this order |
|------|-----------|----------------|
| **P0 — Skeleton** | Auth, story CRUD, the bible data model, a real editor, global sync | Nothing is magical without the project container. |
| **P1 — The loop (MVP)** | Copilot writing grounded in the bible + character files; token streaming; continuity-check pass; usage/credits ledger | This is the whole differentiator. Ship this and it already feels different. |
| **P2 — Agent + branching** | Agent-mode tool loop (plan → act → approve); narrative **graph** with choice edges; decision-game reader with state/flags | Branching is built on a model we chose in P0, so it's additive, not a rewrite. |
| **P3 — Multimodal** | Per-scene image storyboards (character-consistent); multi-voice audiobook TTS; ElevenLabs voice input/conversational authoring | Expensive ops — gated by the credits system from P1. |
| **P4 — Seams (deferred)** | Video, then VR | **Not designed here.** §9 lists the architectural seams we leave open so these don't require a teardown. |

**Frontend posture:** *web-first for authoring* (rich editor surface), Expo/React Native
later for **consumption** (reading, listening, playing decision branches on a phone).
"Synced globally, phone + web" is satisfied by a **single reactive backend** (§5) — it does
**not** require a shared cross-platform component layer in v1, and we will not build one yet.

---

## 2. System overview

Everything is **AWS-native**, defined in **AWS CDK (TypeScript)** in the same monorepo.
The backend is a **platform-agnostic API boundary** — web, mobile, and future VR are all
just clients of one GraphQL API.

```
                    ┌──────────────────────────────────────────────┐
                    │                 CLIENTS                        │
                    │  Web (Next.js, authoring)   Expo (consume) ··· │
                    └───────┬───────────────────────────┬───────────┘
                            │ GraphQL queries/mutations  │ token stream
                            │ + subscriptions (sync)     │ (LLM writing)
              ┌─────────────▼─────────────┐   ┌──────────▼───────────────┐
              │  AWS AppSync (GraphQL API)│   │  LAMBDA (response stream) │
              │  • managed WS subscriptions│   │  • LLM streaming (Claude  │
              │  • Lambda resolvers       │   │    via Amazon Bedrock)     │
              │  • Cognito authorization  │◄──┤  • context assembly        │
              └──┬───────────────┬────────┘   │  • agent tool loop         │
                 │               │            └──────────┬───────────────┘
        ┌────────▼──────┐ ┌──────▼─────────┐             │ start execution
        │  DynamoDB     │ │ Aurora Svrl v2 │             ▼
        │ reactive state│ │ Postgres +     │  ┌──────────────────────────┐
        │ bible/graph/  │ │ pgvector (RAG, │  │  STEP FUNCTIONS (durable) │
        │ artifacts/play│ │ embeddings)    │  │  • audiobook render        │
        └───────────────┘ └────────────────┘  │  • image/storyboard gen     │
                 ▲                             │  • batch continuity sweeps  │
                 │ mutation fans out           └──────┬──────────┬─────────┘
        ┌────────┴──────┐                             ▼          ▼
        │ S3+CloudFront │◄────────────────── ElevenLabs   fal.ai/Replicate
        │ media bytes   │                    (TTS/STT/    (FLUX/SDXL image,
        └───────────────┘                     voice agent) later video)
```

Two distinct planes, deliberately separated:

- **The reactive plane (AppSync + DynamoDB):** all *durable state* — stories, the bible,
  narrative graph, artifacts metadata, playthroughs. Clients subscribe via AppSync
  subscriptions; any mutation fans out to every device. This is what makes the app
  "globally synced," and the GraphQL API is the single boundary every platform speaks to.
  (Embeddings/RAG live in **Aurora pgvector**, not DynamoDB — §4.)
- **The streaming/compute plane (Lambda streaming + Step Functions):** anything that
  *doesn't fit* the request/response model — token streaming from the LLM, and long-running
  media renders. Results are written *back* via AppSync mutations, which then sync them out.
  We do **not** stream LLM tokens through the database. (Verify current Lambda/AppSync
  limits before pushing heavy compute into a resolver vs. a Step Functions step.)

---

## 3. The data model — the actual product

A **Story** is a project (think: a repo). It has three layers:

1. **The Bible** — authoritative, structured world/character state (the "separate files").
2. **The Narrative graph** — the story content itself, as nodes + edges (enables branching).
3. **Artifacts** — generated media bound to narrative nodes.

### 3.1 The Bible (source of truth)

Each entity is its own document — this *is* the "character file in a separate file" the
product is built around. The bible is small relative to the prose, changes slowly, and is
the thing we ground generation against.

> **Storage mapping.** Entities below are the *logical* shapes (also the GraphQL types in
> `lib/types`). They persist in **DynamoDB** (single-table design) as the reactive source of
> truth. **Embeddings do not live inline in DynamoDB** — each entity's vector lives in
> **Aurora pgvector** keyed by `id`, queried during context assembly (§4). The `embedding`
> fields shown are conceptual pointers, not DynamoDB attributes.

```ts
// Logical entity shapes (GraphQL types; persisted in DynamoDB)
characters: {
  storyId, name, aliases[],
  role,                       // protagonist | antagonist | supporting | ...
  traits: string[],           // "stubborn", "loyal to a fault"
  tendencies: string[],       // behavioral priors: "deflects with humor when scared"
  voice: {                    // how they SPEAK — drives dialogue + TTS
    speechPatterns: string,   // idiolect, verbal tics, formality
    elevenLabsVoiceId?: string,
  },
  backstory: string,
  arc: string,                // intended transformation
  relationships: { otherCharacterId, type, status }[],
  appearance: string,         // VISUAL ANCHOR for image consistency
  visualAnchorImageId?: string, // reference image / seed for consistent renders
  state: Record<string, any>, // mutable: injuries, knowledge, location, mood — updated by continuity pass
  embedding: number[],        // for retrieval
}

locations / factions / items / loreFacts: { ... similar, each its own doc ... }

plotThreads: {
  storyId, summary, status,   // open | foreshadowed | resolved
  involvedCharacterIds[], setupNodeId?, payoffNodeId?,
}

timeline: { storyId, order, when, summary, nodeIds[] } // chronology, for "what happened when"

styleGuide: {
  storyId, pov, tense, tone, genre,
  proseStyle, vocabularyNotes, contentRating, // safety/rating bound to the story
}
```

> **Why state is mutable on the character.** A character isn't static — they get injured,
> learn secrets, change allegiance. The **continuity pass** (§4.3) updates `state` as the
> story advances, so "what does the AI know about Mara *right now*" is always answerable.

### 3.2 The Narrative graph (branching from day one)

This is the **decide-now-or-pay-later** fork. Branching ("decision-game paths") means the
content is a **directed graph**, not a list. We model it as a graph even when a story is
mostly linear — a linear story is just nodes joined by single edges. Retrofitting branching
onto a linear list is a painful migration; we pay the small upfront cost instead.

```ts
nodes: {                      // a scene / beat — the unit of writing & generation
  storyId, chapterId?,
  title?, content: string,    // the prose
  summary: string,            // 1–3 sentence compression, used for context assembly
  charactersPresent: characterId[],
  locationId?, timelineRef?,
  status,                     // draft | revised | locked
  embedding: number[],        // semantic retrieval
}

edges: {                      // directed; an edge MAY carry a choice
  storyId, fromNodeId, toNodeId,
  choice?: {                  // present => this is a decision-game fork
    label: string,            // "Open the door" / "Walk away"
    condition?: string,       // optional gate, e.g. "flags.hasKey === true"
    effects?: Record<string,any>, // mutate playthrough state
  },
}

chapters: { storyId, order, title } // soft grouping/ordering overlay on the graph
```

- **Linear story:** nodes connected by edges with no `choice`.
- **Decision game:** a node with multiple outgoing `choice` edges = a fork. The graph is a
  **DAG by default** but supports deliberate **reconvergence** (multiple paths merging back
  to one node) — design for merges, guard against accidental cycles.
- **Playthrough** (reading/playing a branching story) is *not* stored on the graph — it's a
  per-session cursor + state bag (§3.4).

### 3.3 Artifacts (generated media)

```ts
artifacts: {
  storyId, nodeId?, characterId?,
  kind,                       // image | audio | video(later) | vr(later)
  provider, providerJobId,
  status,                     // queued | running | done | failed
  r2Key,                      // where the bytes live
  inputHash,                  // for CACHING — see §6.3
  cost,                       // credits debited
  meta,                       // seed, voiceId, model, dimensions, ...
}
```

### 3.4 Playthrough (the decision-game runtime)

```ts
playthroughs: {
  storyId, userId,
  currentNodeId,
  path: nodeId[],             // breadcrumb of visited nodes
  state: Record<string,any>,  // flags / inventory / relationship meters
}
```

Reading a branching story = walk the graph from `currentNodeId`, render its choice edges,
evaluate `condition`s against `state`, apply `effects` on selection, advance. This is a
light interactive-fiction engine — and crucially, the *same graph* an author writes is the
graph a reader plays.

---

## 4. Context assembly & continuity — the hard CS problem

You **cannot** fit an 80,000-word novel plus a full bible into a context window. So
consistency over a long work is fundamentally a **retrieval + summarization + verification**
problem. This section is the engine of the product.

### 4.1 Assembling context for an action on node *N*

When the agent/copilot acts on node *N* (write, continue, rewrite), we build its context
from layers, under a **token budget**:

1. **Always-on (cheap, cached):** story premise + `styleGuide` (POV, tense, tone, rating).
   This is stable across the whole session → a perfect **prompt-cache** prefix (§7).
2. **Cast in scene:** full character cards (traits, tendencies, voice, current `state`) for
   every `charactersPresent` in *N*, plus characters their relationships pull in.
3. **Recent narrative (verbatim):** the last *K* nodes **along the active path** (we walk the
   graph backward from *N*, not "the previous row in a table" — branching means "previous"
   is path-dependent).
4. **Distant narrative (summarized):** a rolling/hierarchical summary of the path before
   those *K* nodes (chapter summaries → arc summary). Compression, not truncation.
5. **Retrieved (RAG):** vector search (**Aurora Postgres + pgvector**) over node summaries +
   bible entries for entities/topics mentioned near *N*. Pulls in "the thing established 200 pages
   ago that's suddenly relevant."
6. **Open obligations:** `plotThreads` with status `open`/`foreshadowed` involving the
   present cast/location — so the model can pay things off and not drop threads.

The assembler is a pure, testable function: `(storyId, nodeId, intent) → PromptContext`.
**This function is the heart of the codebase.** It deserves the most tests.

### 4.2 Hierarchical memory (so it scales to a novel)

```
loreFacts + character state ──┐
chapter summaries ────────────┼──► assembled, budgeted context ──► LLM
arc summary ──────────────────┘
verbatim last-K nodes ────────┘
```

Summaries are generated **on write** (when a node is committed, summarize it; roll up
chapter summaries lazily). Summarization is itself an LLM job — cheap model, cached.

### 4.3 The continuity pass (drift detection — what makes it "real")

After a node is written/committed, run a **continuity-check** pass:

1. **Extract claims** from the new prose: entity-state changes ("Mara is now wounded", "it's
   night", "Jon learns the password"), new entities, relationship shifts.
2. **Diff against the bible/timeline.** Contradiction? ("Mara died two chapters ago" / "the
   castle was described as stone, now it's wood.")
3. **Three outcomes:**
   - *Consistent new fact* → propose a bible/`state`/`timeline` **update** (user confirms in
     agent mode, auto-applies in trusted copilot flows).
   - *Contradiction* → **flag** inline for the author with the conflicting source cited.
   - *New entity* → propose a new bible stub so it's tracked going forward.

This closes the loop: prose is generated *from* the bible and folded *back into* it. The
bible stays authoritative and alive. Without this pass, character files rot and the
"persistent state" promise is fiction.

---

## 5. The AI runtime (toggleable: copilot ⇄ agent)

Both modes share **one tool layer** and **one context assembler**. The only difference is
*how much autonomy* the model has. (These are the **product** story-agents — distinct from
the dev-side `.claude/agents/` that help us *build* the app. See §8.)

**Tool layer** (the agent's verbs — same set both modes can call):

| Tool | Purpose |
|------|---------|
| `read_bible(query)` | RAG over characters/lore/threads |
| `write_node(...)` / `revise_node(...)` | create/edit prose |
| `update_character(...)` / `update_state(...)` | mutate the bible (continuity) |
| `add_plot_thread(...)` / `resolve_thread(...)` | track setups & payoffs |
| `create_branch(nodeId, choices[])` | author decision-game forks |
| `generate_image(nodeId, prompt)` | enqueue storyboard render |
| `synthesize_speech(text, voiceId)` | enqueue TTS |
| `continuity_check(nodeId)` | run §4.3 |

- **Copilot mode:** user issues one explicit op ("continue", "rewrite this scene with more
  dread", "draft Mara's dialogue", "give me 3 directions"). One assembled-context call,
  **streamed** to the editor. No unprompted action.
- **Agent mode (emphasis):** user gives a goal ("draft chapter 3 from the outline"). A
  **planner loop** decomposes it, calls tools, and **checkpoints for approval** before
  destructive/expensive steps — exactly the plan→act→approve rhythm of Claude Code. The
  bible grounds every step; the continuity pass runs between steps.

**Product story-personas** (specialized prompt profiles the runtime can adopt per task):
*Continuity Editor*, *Character-Voice* (writes a line *as* a specific character using their
`voice`), *Prose Stylist*, *Branching-Path Designer*, *Narration Director* (maps lines to
voices for the audiobook), *Storyboard Artist* (scene → image prompt using visual anchors).
These are configuration over the same engine, not separate services.

---

## 6. Multimodal pipeline

All media generation is **async + durable** (Step Functions), never inline in a request:
`mutation → job state (DynamoDB) → Step Functions step → provider → S3 → update job (mutation) → subscription fans out`.

### 6.1 Audio / audiobook (ElevenLabs)
- **Multi-voice:** the *Narration Director* persona maps each line to a voice — narrator
  voice for prose, each character's `elevenLabsVoiceId` for their dialogue. Render per
  line/node, stitch into a chapter/audiobook track.
- **Voice input / conversational authoring:** ElevenLabs Conversational AI + STT as a
  hands-free entry path — user *talks* the story, transcription feeds the writing agent,
  response is streamed and optionally spoken back.

### 6.2 Image / storyboard (fal.ai or Replicate — FLUX/SDXL)
- **Per-scene panels** generated from node content via the *Storyboard Artist*.
- **Character consistency** (the hard part): each character carries a **visual anchor** —
  a reference image + locked prompt fragment + stored seed (later: a per-character LoRA).
  Renders reuse the anchor so the same character looks like themselves across panels.

### 6.3 Cost, credits & caching (in MVP, not "later")
Multimodal gen costs real money per op; a single 10-hour audiobook + per-scene art can be
expensive. So from **v1**:
- A **usage/credits ledger** per user (DynamoDB); every LLM and media op debits it;
  estimate-before-run with a confirmation on expensive jobs; per-plan rate limits.
- **Aggressive caching** keyed by `inputHash = hash(text|prompt + voiceId/seed + settings)`.
  Identical TTS/image requests are served from S3, never re-billed. This single mechanism is
  the difference between viable and bankrupt.

---

## 7. Tech stack — AWS-native, one repo, defined in CDK

Single monorepo. All infra is **AWS CDK (TypeScript)** in `infra/`. The backend is a
platform-agnostic **GraphQL API** so every frontend (web now, mobile/VR later) is just a
client. Two third-party APIs remain (ElevenLabs, image gen) because AWS has no equivalent;
**Claude runs on Bedrock**, inside the account.

| Concern | Choice | Why |
|--------|--------|-----|
| Repo | Single monorepo, pnpm workspaces (+ Turborepo) | one tree: app + infra + shared types/logic |
| IaC | **AWS CDK (TypeScript)** | infra as code in the same language; you own it |
| Web (authoring, v1) | Next.js (App Router), TS, Tailwind + shadcn/ui | best editor surface |
| Editor | Tiptap / ProseMirror | structured rich text, node-aware |
| Mobile (consume, later) | Expo / React Native | reuse types, not components |
| **API + sync** | **AWS AppSync** (GraphQL + managed WS subscriptions) | the platform-agnostic boundary; subscriptions = global sync |
| Compute | **Lambda** (resolvers + response streaming) | serverless, pay-per-use |
| Reactive state | **DynamoDB** (single-table) | pairs natively with AppSync subscriptions |
| Vector / RAG | **Aurora Serverless v2 Postgres + pgvector** | embeddings + retrieval for context assembly |
| Auth | **Amazon Cognito** | native AppSync authorization + IAM |
| LLM | **Claude via Amazon Bedrock** | IAM auth, no key, data stays in-account; **prompt caching** the bible prefix |
| Durable jobs | **AWS Step Functions** | reliable steps for long media renders & batch sweeps |
| Media storage | **S3 + CloudFront** | bytes + CDN for audio/images/video |
| TTS / STT / voice agent | ElevenLabs *(external)* | best-in-class voices + conversational agent |
| Image gen | fal.ai / Replicate *(external)* | many models behind one API |
| Observability | CloudWatch + X-Ray + custom cost dashboard | traces, logs, the credits ledger |

**Prompt caching is mandatory, not optional.** The premise + style guide + stable bible
slices form a large, reused prefix on nearly every call. Caching it cuts both latency and
cost dramatically — design the prompt so the cacheable part is the prefix.

---

## 8. Two kinds of "agents" — keep them separate

This product touches the word "agent" in two unrelated ways. Conflating them creates
confusion, so we name them explicitly:

- **Dev-side agents** — Claude Code subagents in `.claude/agents/` that help us *build this
  repository* (an AWS-backend specialist, an AI-orchestration specialist, etc.). They write code.
  See `CLAUDE.md` and `.claude/agents/`.
- **Product story-agents** — the in-app writing personas (§5) that *co-author stories at
  runtime*. They are prompt/config profiles over the shared AI runtime; they live in
  application code, not in `.claude/`.

`CLAUDE.md` is dev-side. The story bible is the product-side analog of `CLAUDE.md`.

---

## 9. Deferred seams (video & VR — explicitly NOT designed)

We are not designing these now, but the model already leaves the seams open:
- **`artifacts.kind`** is an open enum → `video` and `vr` slot in beside `image`/`audio`.
- **The media pipeline** (job → provider → S3 → sync) is provider-agnostic → a video model
  (e.g. a future text-to-video provider) is a new Step Functions step, not new architecture.
- **Nodes carry enough structure** (scene content, cast, location, visual anchors) to drive
  a shot list later; video = "storyboard panels in motion."
- **VR** would consume the same node/scene graph as spatial scenes — a new client + renderer,
  not a new data model.

Marking these as seams (not designs) is deliberate: it keeps the big vision honest without
pretending we've solved text-to-VR today.

---

## 10. What to build first (concrete P0→P1)

0. **CDK bootstrap** — the monorepo + a minimal CDK stack (AppSync, DynamoDB, Cognito) that
   deploys. Get the deploy loop working before building features.
1. **GraphQL schema + DynamoDB single-table design** for the **bible** + **narrative graph**
   (§3) — get the shapes right; they're expensive to migrate.
2. Cognito auth + story CRUD + Tiptap editor wired to AppSync (reactive subscriptions prove
   sync works end-to-end).
3. The **context assembler** (§4.1) as a pure, well-tested function (Aurora pgvector behind a
   retrieval interface).
4. Copilot writing via a **Lambda response-streaming** endpoint calling **Claude on
   Bedrock**, with prompt caching.
5. The **continuity pass** (§4.3) + character-file updates.
6. The **credits ledger** (§6.3) tracking LLM spend (media enforcement comes with P3).

Ship that and you have the magical core: a story that *remembers*, characters that *stay
themselves*, and an AI that writes *with* you rather than *at* you.
