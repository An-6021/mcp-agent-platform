import { afterEach, describe, expect, it } from "vitest";
import type {
  ConsoleRepository,
  Source,
  SourceDiscovery,
  ToolExposure,
  Workspace,
  WorkspaceConfig,
  WorkspaceDraft,
  WorkspaceRepository,
  WorkspaceSummary,
  WorkspaceTokenMeta,
} from "@mcp-agent-platform/shared";
import { createControlPlaneServer } from "./server";

let server: ReturnType<typeof createControlPlaneServer> | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe("createControlPlaneServer", () => {
  it("下发 workspace config 时注入 cachedCapabilities", async () => {
    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "exa",
          label: "Exa",
          kind: "direct-http",
          url: "https://example.com/mcp",
          headers: {},
          enabled: true,
        },
      ],
    };

    const discovery: SourceDiscovery = {
      sourceId: "exa",
      generatedAt: "2026-04-13T01:23:45.000Z",
      status: "ready",
      error: null,
      tools: [
        {
          name: "exa_search",
          description: "Search the web using Exa.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
      resources: [],
      prompts: [],
    };

    const exposure: ToolExposure = {
      sourceId: "exa",
      originalName: "exa_search",
      exposedName: "exa_exa_search",
      enabled: true,
      order: 0,
      strategy: "default",
    };

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(config),
      consoleRepo: createConsoleRepo({
        discoveries: [discovery],
        exposures: [exposure],
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "mcp-hub",
      upstreams: [
        {
          id: "exa",
          cachedCapabilities: {
            generatedAt: "2026-04-13T01:23:45.000Z",
            tools: [{ name: "exa_search" }],
            toolExposures: [{ exposedName: "exa_exa_search" }],
          },
        },
      ],
    });
  });

  it("存在 console sources 时优先下发 console sources", async () => {
    const publishedConfig: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "openai-docs",
          label: "OpenAI 开发者文档",
          kind: "direct-http",
          url: "https://developers.openai.com/mcp",
          headers: {},
          enabled: true,
        },
      ],
    };

    const exaSource: Source = {
      id: "exa",
      name: "exa",
      kind: "hosted-single-file",
      enabled: true,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
      lastRefreshedAt: "2026-04-13T01:23:45.000Z",
      status: "ready",
      lastError: null,
      seedDiscovery: null,
      config: {
        fileName: "exa-server.ts",
        runtime: "node",
        source: "console.log('exa');",
        args: [],
        cwd: null,
        env: {},
        timeoutMs: 30_000,
        autoStart: true,
      },
    };

    const discovery: SourceDiscovery = {
      sourceId: "exa",
      generatedAt: "2026-04-13T01:23:45.000Z",
      status: "ready",
      error: null,
      tools: [
        {
          name: "exa_search",
          description: "Search the web using Exa.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string" },
            },
            required: ["query"],
          },
        },
      ],
      resources: [],
      prompts: [],
    };

    const exposure: ToolExposure = {
      sourceId: "exa",
      originalName: "exa_search",
      exposedName: "exa_exa_search",
      enabled: true,
      order: 0,
      strategy: "default",
    };

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(publishedConfig),
      consoleRepo: createConsoleRepo({
        sources: [exaSource],
        discoveries: [discovery],
        exposures: [exposure],
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "mcp-hub",
      upstreams: [
        {
          id: "exa",
          kind: "hosted-single-file",
          cachedCapabilities: {
            tools: [{ name: "exa_search" }],
            toolExposures: [{ exposedName: "exa_exa_search" }],
          },
        },
      ],
    });
    expect(response.json().upstreams).toHaveLength(1);
  });

  it("存在有效 token 时未带 Bearer 会返回 401", async () => {
    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [],
    };

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(config, {
        verifyToken: async () => false,
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/config",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("携带 Bearer token 时允许访问", async () => {
    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [],
    };

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(config, {
        verifyToken: async (_workspaceId, token) => token === "secret-token",
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/config",
      headers: {
        authorization: "Bearer secret-token",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "mcp-hub",
      upstreams: [],
    });
  });
});

function createWorkspaceRepo(
  config: WorkspaceConfig,
  overrides?: {
    verifyToken?: WorkspaceRepository["verifyToken"];
  },
): WorkspaceRepository {
  return {
    list: async (): Promise<WorkspaceSummary[]> => [],
    getWorkspace: async (): Promise<Workspace | null> => null,
    createWorkspace: async () => unsupported(),
    getDraft: async (): Promise<WorkspaceDraft | null> => null,
    saveDraft: async () => unsupported(),
    getPublishedConfig: async () => config,
    publish: async () => unsupported(),
    listSnapshots: async () => unsupported(),
    rollback: async () => unsupported(),
    listTokens: async (): Promise<WorkspaceTokenMeta[]> => [],
    createToken: async () => unsupported(),
    revokeToken: async () => unsupported(),
    verifyToken: overrides?.verifyToken ?? (async (): Promise<boolean> => true),
  };
}

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
