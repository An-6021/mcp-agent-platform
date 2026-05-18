import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ConsoleRepository, Source, SourceDiscovery, ToolExposure } from "@a1ua/mcp-hub-shared";
import { mergeDiscoveryWithPrevious, registerConsoleRoutes } from "./consoleRoutes";

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

  it("停用的 source 不计入暴露工具列表", async () => {
    const sources: Source[] = [
      {
        id: "enabled-source",
        name: "enabled-source",
        kind: "remote-http",
        enabled: true,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        lastRefreshedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        lastError: null,
        seedDiscovery: null,
        config: {
          endpoint: "https://enabled.example.com/mcp",
          headers: {},
          timeoutMs: 30_000,
        },
      },
      {
        id: "disabled-source",
        name: "disabled-source",
        kind: "remote-http",
        enabled: false,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        lastRefreshedAt: "2026-04-13T01:23:45.000Z",
        status: "disabled",
        lastError: null,
        seedDiscovery: null,
        config: {
          endpoint: "https://disabled.example.com/mcp",
          headers: {},
          timeoutMs: 30_000,
        },
      },
    ];
    const discoveries: SourceDiscovery[] = [
      {
        sourceId: "enabled-source",
        generatedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "enabled_tool" }],
        resources: [],
        prompts: [],
      },
      {
        sourceId: "disabled-source",
        generatedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "disabled_tool" }],
        resources: [],
        prompts: [],
      },
    ];
    const exposures: ToolExposure[] = [
      {
        sourceId: "enabled-source",
        originalName: "enabled_tool",
        exposedName: "enabled_tool",
        enabled: true,
        order: 0,
        strategy: "default",
      },
      {
        sourceId: "disabled-source",
        originalName: "disabled_tool",
        exposedName: "disabled_tool",
        enabled: true,
        order: 0,
        strategy: "default",
      },
    ];

    const server = Fastify({ logger: false });
    registerConsoleRoutes(server, {
      repo: createConsoleRepo({
        sources,
        discoveries,
        exposures,
      }),
    });

    try {
      const sourcesResponse = await server.inject({
        method: "GET",
        url: "/admin/sources",
      });
      const toolsResponse = await server.inject({
        method: "GET",
        url: "/admin/tools",
      });

      expect(sourcesResponse.statusCode).toBe(200);
      expect(sourcesResponse.json().data.summary).toMatchObject({
        sourceCount: 2,
        enabledSourceCount: 1,
        exposedToolCount: 1,
      });

      expect(toolsResponse.statusCode).toBe(200);
      expect(toolsResponse.json().data.summary).toMatchObject({
        exposedToolCount: 1,
        sourceCount: 1,
      });
      expect(toolsResponse.json().data.items).toHaveLength(1);
      expect(toolsResponse.json().data.items[0]).toMatchObject({
        sourceId: "enabled-source",
        exposedName: "enabled_tool",
      });
    } finally {
      await server.close();
    }
  });
});

function createConsoleRepo(input: {
  sources?: Source[];
  discoveries?: SourceDiscovery[];
  exposures?: ToolExposure[];
}): ConsoleRepository {
  const sources = input.sources ?? [];
  const discoveries = new Map((input.discoveries ?? []).map((item) => [item.sourceId, item]));
  const exposures = input.exposures ?? [];

  return {
    listSources: async (): Promise<Source[]> => sources,
    getSource: async (id: string): Promise<Source | null> => sources.find((source) => source.id === id) ?? null,
    createSource: async () => unsupported(),
    updateSource: async () => unsupported(),
    deleteSource: async () => unsupported(),
    saveDiscovery: async () => unsupported(),
    getDiscovery: async (sourceId: string) => discoveries.get(sourceId) ?? null,
    listExposures: async () => exposures,
    saveExposure: async () => unsupported(),
    saveExposures: async () => unsupported(),
    getHostedState: async () => null,
    saveHostedState: async () => unsupported(),
    listHostedStates: async () => [],
    appendLog: async () => unsupported(),
    listLogs: async () => [],
  };
}

function unsupported(): never {
  throw new Error("not implemented");
}
