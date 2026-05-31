import type { PromptContext } from "./contextAssembler";

// Turn an assembled PromptContext into the Anthropic Messages API shape, with
// `cache_control` on the stable prefix. PROVIDER-AGNOSTIC: this returns the generic
// { system, messages } the Messages API expects; the Bedrock handler wraps it with
// `anthropic_version` + `max_tokens`. Keeping it here means the cache layout — the
// thing that silently fails if mis-shaped — is unit-tested in the pure core.
//
// Prompt caching is a PREFIX match (max 4 breakpoints, stable content first):
//   tools -> system -> messages.
//   • breakpoint A: the whole `system` block (premise + style)        — cross-session
//   • breakpoint B: the first user block (cast + threads + arc)       — per-session
//   • the trailing user block (recent prose + retrieval + the task)   — uncached
// `cache_control` MUST sit on a content block (system/messages must be ARRAYS, not
// strings) or nothing caches. See shared/prompt-caching.md.

export interface CacheControl {
  type: "ephemeral";
}
export interface TextBlock {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}
export interface ClaudeMessage {
  role: "user" | "assistant";
  content: TextBlock[];
}
export interface ClaudePrompt {
  system: TextBlock[];
  messages: ClaudeMessage[];
}

const EPHEMERAL: CacheControl = { type: "ephemeral" };

export function buildClaudePrompt(ctx: PromptContext): ClaudePrompt {
  const system: TextBlock[] = [
    { type: "text", text: ctx.system, cache_control: EPHEMERAL },
  ];

  const content: TextBlock[] = [];

  // breakpoint B — stable bible slice. Only emit (and cache) when non-empty, so an
  // empty block never sits between the cached system prefix and the dynamic tail.
  if (ctx.cacheableContext.trim()) {
    content.push({ type: "text", text: ctx.cacheableContext, cache_control: EPHEMERAL });
  }

  // trailing, uncached: recent prose + retrieval, then the actual ask last.
  const tail = [ctx.dynamicContext.trim(), `### TASK\n${ctx.instruction}`]
    .filter(Boolean)
    .join("\n\n");
  content.push({ type: "text", text: tail });

  return { system, messages: [{ role: "user", content }] };
}
