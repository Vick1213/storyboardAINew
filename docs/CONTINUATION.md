# Continuation prompt

Paste this into a fresh Claude Code session in this repo to pick up where we left off.

---

You're working on **StoryboardAI** — "Claude Code, but for writing stories." Read
`docs/ARCHITECTURE.md` (the design source of truth — §3 data model and §4 context
assembly/continuity are the actual product), then `CLAUDE.md` (dev invariants) and
`docs/QUICKSTART.md` (deploy).

**Stack (decided, don't relitigate):** single monorepo, AWS-native via AWS CDK (TypeScript),
region **us-west-2**. AppSync (GraphQL + subscriptions = sync) · Lambda · DynamoDB (reactive
state) + Aurora Serverless v2/pgvector (RAG, deferred) · Cognito · Claude via Amazon Bedrock ·
Step Functions (deferred) · S3. ElevenLabs + fal/Replicate are external. Do NOT reintroduce
Convex/Vercel/Inngest/Clerk/R2.

**Current state (verified):** `pnpm install` + `pnpm -r typecheck` pass on all packages;
`cd infra && pnpm exec cdk synth` produces a clean template and bundles both Lambdas. NOT yet
deployed (root creds + Bedrock model access + bootstrap still pending — that's a human step).

**What exists:** CDK stack (Cognito, DynamoDB single-table, AppSync API + 7 resolvers, S3,
Bedrock streaming Lambda w/ Function URL); `functions/graphql` resolver; `functions/streaming`
Bedrock handler; `packages/types` domain shapes; `packages/ai` context assembler + ports
(Bible/Graph/Retrieval interfaces); `apps/web` Next.js shell + streaming demo.

**Deferred (commented in `infra/lib/storyboard-stack.ts`):** Aurora pgvector, Step Functions
media pipelines, CloudFront, credits-ledger metering.

**Pick up with ONE of these (ask me which if unsure):**
1. **Live sync loop (§10 step 3):** Cognito sign-in via Amplify in `apps/web`, then story +
   character/bible CRUD UI wired to AppSync, with `onCharacterCreated`/`onNodeCreated`
   subscriptions proving end-to-end live sync across devices.
2. **Grounded writing loop (§10 steps 3–4):** implement the `BiblePort`/`GraphPort`/
   `RetrievalPort` against DynamoDB, feed `assembleContext()` into a real Bedrock call
   (prompt-cache the stable bible prefix), and stream the result into the editor.
3. **RAG infra:** add Aurora Serverless v2 + pgvector to the CDK stack and back `RetrievalPort`
   with it (embeddings on node/bible writes).

Use the dev subagents in `.claude/agents/` (aws-backend, ai-orchestration, narrative-engine,
web-frontend). Keep the GraphQL API as the only seam between frontends and backend; keep the
context assembler pure and unit-tested.
