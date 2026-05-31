# StoryboardAI

**Claude Code, but for writing stories.** A multimodal, globally-synced creative
environment where a story is a *project* — with a living story bible, persistent characters
whose traits and tendencies live in their own files, and a branching narrative — co-authored
by an AI that toggles between an autonomous **agent** and a steerable **copilot**, across
**text, image, and audio** (video and VR are deferred seams).

## Start here
- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — the design source of truth. Read §3
  (data model) and §4 (context assembly & continuity); that is the actual product.
- **[`CLAUDE.md`](CLAUDE.md)** — dev guide & invariants for working on the repo.
- **`.claude/agents/`** — dev-side subagents that help *build* the app (AWS backend, AI
  orchestration, narrative engine, web frontend). These are distinct from the in-app
  *story-agents* (a product runtime feature; see ARCHITECTURE §5).

## The core bet
Persistent, authoritative state. The bible is the source of truth; the AI assembles the
right slice of it into context on every action and checks its output back against it for
drift. That loop — not "call an LLM" — is what makes it feel like real storytelling.

## Status
Greenfield. Not yet scaffolded. First work: CDK bootstrap + GraphQL/DynamoDB schema +
context assembler. See ARCHITECTURE §10 for the concrete P0→P1 build order.

## Stack (AWS-native, one repo, CDK)
Single monorepo · Next.js (web) · Expo (mobile, later) · **AWS AppSync** (GraphQL + sync) ·
**Lambda** · **DynamoDB** + **Aurora Serverless v2 / pgvector** · **Cognito** · **Claude via
Amazon Bedrock** · **Step Functions** · **S3 + CloudFront** · ElevenLabs · fal.ai/Replicate.
All infra defined in **AWS CDK (TypeScript)**.
