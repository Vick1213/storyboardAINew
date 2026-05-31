import { describe, it, expect } from "vitest";
import { buildClaudePrompt, type PromptContext } from "../src/index";

const base: PromptContext = {
  system: "You are co-authoring \"X\".",
  cacheableContext: "### CAST IN SCENE\n## Mara",
  dynamicContext: "### RECENT (verbatim)\nMara reached the docks.",
  instruction: "Continue the prose.",
  estimatedTokens: 42,
};

describe("buildClaudePrompt", () => {
  it("emits system as an ARRAY of content blocks with an ephemeral cache breakpoint", () => {
    const p = buildClaudePrompt(base);
    expect(Array.isArray(p.system)).toBe(true);
    expect(p.system[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(p.system[0].text).toContain("co-authoring");
  });

  it("caches the stable bible block but NOT the trailing dynamic+task block", () => {
    const p = buildClaudePrompt(base);
    const content = p.messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0].cache_control).toEqual({ type: "ephemeral" }); // bible slice
    expect(content[0].text).toContain("## Mara");
    expect(content[1].cache_control).toBeUndefined(); // recent + task — uncached
  });

  it("puts the actual task LAST so it sits after every cached prefix", () => {
    const p = buildClaudePrompt(base);
    const tail = p.messages[0].content.at(-1)!.text;
    expect(tail).toContain("Mara reached the docks."); // recent first
    expect(tail.trimEnd().endsWith("Continue the prose.")).toBe(true);
    expect(tail).toContain("### TASK");
  });

  it("collapses to a single uncached user block when there is no cacheable bible slice", () => {
    const p = buildClaudePrompt({ ...base, cacheableContext: "   " });
    const content = p.messages[0].content;
    expect(content).toHaveLength(1);
    expect(content[0].cache_control).toBeUndefined();
    expect(content[0].text).toContain("### TASK");
  });

  it("never exceeds the 4 cache_control breakpoint ceiling", () => {
    const p = buildClaudePrompt(base);
    const breakpoints =
      p.system.filter((b) => b.cache_control).length +
      p.messages.flatMap((m) => m.content).filter((b) => b.cache_control).length;
    expect(breakpoints).toBeLessThanOrEqual(4);
  });
});
