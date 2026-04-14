import { describe, expect, it } from "vitest";
import type { SourceDiscovery } from "@mcp-agent-platform/shared";
import { mergeDiscoveryWithPrevious } from "./consoleRoutes";

describe("mergeDiscoveryWithPrevious", () => {
  it("刷新报错时保留上次成功 discovery 的能力列表", () => {
    const previous: SourceDiscovery = {
      sourceId: "fast-context",
      generatedAt: "2026-04-13T05:00:00.000Z",
      status: "ready",
      error: null,
      tools: [{ name: "fast_context_search", description: "search" }],
      resources: [{ uri: "resource://cached", name: "cached" }],
      prompts: [{ name: "prompt-a" }],
    };

    const next: SourceDiscovery = {
      sourceId: "fast-context",
      generatedAt: "2026-04-13T05:10:00.000Z",
      status: "error",
      error: "Connection closed",
      tools: [],
      resources: [],
      prompts: [],
    };

    expect(mergeDiscoveryWithPrevious(next, previous)).toEqual({
      ...next,
      tools: previous.tools,
      resources: previous.resources,
      prompts: previous.prompts,
    });
  });

  it("刷新成功时使用最新 discovery", () => {
    const previous: SourceDiscovery = {
      sourceId: "fast-context",
      generatedAt: "2026-04-13T05:00:00.000Z",
      status: "ready",
      error: null,
      tools: [{ name: "old_tool" }],
      resources: [],
      prompts: [],
    };

    const next: SourceDiscovery = {
      sourceId: "fast-context",
      generatedAt: "2026-04-13T05:10:00.000Z",
      status: "ready",
      error: null,
      tools: [{ name: "new_tool" }],
      resources: [],
      prompts: [],
    };

    expect(mergeDiscoveryWithPrevious(next, previous)).toEqual(next);
  });
});
