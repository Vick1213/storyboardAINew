# CLAUDE.md — StoryboardAI (dev guide)

This file orients Claude Code (and humans) when working **on this repository**. It is
dev-side. Do not confuse it with the *story bible*, which is the product-side analog of this
file (authoritative state the writing AI reads). See `docs/ARCHITECTURE.md`.

## What this project is
"Claude Code, but for writing stories." A multimodal, globally-synced creative app where a
story is a **project** with a living bible, persistent characters, and a **branching**
narrative, co-authored by an AI that toggles between autonomous **agent** and steerable
**copilot**. v1 covers **writing + image + audio**; video/VR are deferred seams.

**Read `docs/ARCHITECTURE.md` before non-trivial work.** The product *is* §3 (data model)
and §4 (context assembly & continuity). The stack (§7) is commodity.

## The non-negotiable invariants
1. **The bible is the source of truth.** Generated prose is grounded in it and folded back
   into it via the continuity pass. Never let character/world state live only inside prose.
2. **Narrative content is a graph (DAG), never a list.** Branching is a day-one model
   decision. Don't add APIs that assume linear "next scene."
3. **The context assembler is a pure, tested function** `(storyId, nodeId, intent) → context`.
   Changes here need tests. It is the heart of the codebase.
4. **Two planes stay separate:** durable state in DynamoDB behind AppSync (reactive sync);
   LLM token streaming in Lambda response-streaming endpoints; long media renders in Step
   Functions. Never stream tokens through the DB.
5. **Cost is a feature.** Every LLM/media op debits the credits ledger and respects the
   `inputHash` cache. No un-metered, un-cached generation paths.
6. **Prompt caching is mandatory.** Structure prompts so the stable bible/style prefix is
   cacheable. (Use the `claude-api` skill when touching Claude calls.)

## Stack (see §7 for rationale) — AWS-native, one repo, CDK
Single monorepo (pnpm workspaces + Turborepo). All infra in **AWS CDK (TS)** under `infra/`.
Next.js (web, authoring) · Expo (mobile, consumption — later) · **AWS AppSync** (GraphQL API
+ subscriptions = sync) · **Lambda** (resolvers + response streaming) · **DynamoDB**
(reactive state) + **Aurora Serverless v2 / pgvector** (RAG) · **Cognito** (auth) · **Claude
via Amazon Bedrock** · **Step Functions** (durable jobs) · **S3 + CloudFront** (media) ·
ElevenLabs (TTS/STT/voice agent, external) · fal.ai/Replicate (image, external).

## Layout (single monorepo — target)
Everything in one repo. The GraphQL API is the only seam between frontends and backend.
```
apps/web            Next.js authoring app (one client of the GraphQL API)
apps/mobile         Expo consumption app (later)
infra/              AWS CDK app — AppSync, DynamoDB, Aurora, Cognito, Lambda, Step Functions, S3
functions/          Lambda handlers (GraphQL resolvers, LLM streaming, job steps)
packages/ai         context assembler, agent runtime, tool layer, story-personas
packages/types      shared TS / GraphQL types
docs/ARCHITECTURE.md  the design source of truth
```

## Conventions
- TypeScript everywhere; shared types in `packages/types`, no duplicated entity shapes.
- The GraphQL schema + DynamoDB single-table design are the canonical data shape; don't
  redefine entities ad hoc in the client.
- Keep the assembler and continuity logic in `packages/ai`, framework-agnostic and unit-tested.
- Media generation only via the Step Functions job path (job state → provider → S3 → mutation/sync).
- Match surrounding code style; prefer small, composable functions over large handlers.

## When working here
- Use the dev-side subagents in `.claude/agents/` for specialized work (AWS backend, AI
  orchestration, narrative engine, web frontend).
- This is greenfield and **not yet a git repo** and **not scaffolded** — early work is
  bootstrapping the monorepo, the CDK stack, and the GraphQL/DynamoDB schema. Commit/push
  only when asked.
- The product story-agents (§5) are application code/prompt profiles, not `.claude/agents/`.
