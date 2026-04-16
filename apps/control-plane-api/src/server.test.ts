import { afterEach, describe, expect, it } from "vitest";
import type {
  ConsoleRepository,
  Source,
  SourceDiscovery,
  ToolExposure,
  Workspace,
  WorkspaceConfig,
  WorkspaceDraft,
  WorkspaceExportProfile,
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

  it("console source 没有持久化 exposures 时仍按来源名生成默认工具名", async () => {
    const publishedConfig: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [],
    };

    const source: Source = {
      id: "127",
      name: "Fast Context",
      kind: "remote-http",
      enabled: true,
      createdAt: "2026-04-13T00:00:00.000Z",
      updatedAt: "2026-04-13T00:00:00.000Z",
      lastRefreshedAt: "2026-04-13T01:23:45.000Z",
      status: "ready",
      lastError: null,
      seedDiscovery: null,
      config: {
        endpoint: "http://127.0.0.1:8123/mcp",
        headers: {},
        timeoutMs: 30_000,
      },
    };

    const discovery: SourceDiscovery = {
      sourceId: "127",
      generatedAt: "2026-04-13T01:23:45.000Z",
      status: "ready",
      error: null,
      tools: [
        {
          name: "get_file_text_by_path",
          description: "Read a file by path.",
          inputSchema: { type: "object" },
        },
      ],
      resources: [],
      prompts: [],
    };

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(publishedConfig),
      consoleRepo: createConsoleRepo({
        sources: [source],
        discoveries: [discovery],
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      upstreams: [
        {
          id: "127",
          cachedCapabilities: {
            toolExposures: [{ exposedName: "fast_context_get_file_text_by_path" }],
          },
        },
      ],
    });
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

  it("export config 只下发被选中的来源", async () => {
    const publishedConfig: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [],
    };

    const sources: Source[] = [
      {
        id: "exa",
        name: "Exa",
        kind: "remote-http",
        enabled: true,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        lastRefreshedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        lastError: null,
        seedDiscovery: null,
        config: {
          endpoint: "https://example.com/mcp",
          headers: {},
          timeoutMs: 30_000,
        },
      },
      {
        id: "idea",
        name: "IDEA",
        kind: "remote-http",
        enabled: true,
        createdAt: "2026-04-13T00:00:00.000Z",
        updatedAt: "2026-04-13T00:00:00.000Z",
        lastRefreshedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        lastError: null,
        seedDiscovery: null,
        config: {
          endpoint: "http://127.0.0.1:64342/mcp",
          headers: {},
          timeoutMs: 30_000,
        },
      },
    ];

    const discoveries: SourceDiscovery[] = [
      {
        sourceId: "exa",
        generatedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "exa_search" }],
        resources: [],
        prompts: [],
      },
      {
        sourceId: "idea",
        generatedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "idea_get_file_text_by_path" }],
        resources: [],
        prompts: [],
      },
    ];

    const exposures: ToolExposure[] = [
      {
        sourceId: "exa",
        originalName: "exa_search",
        exposedName: "exa_search",
        enabled: true,
        order: 0,
        strategy: "default",
      },
      {
        sourceId: "idea",
        originalName: "idea_get_file_text_by_path",
        exposedName: "idea_get_file_text_by_path",
        enabled: true,
        order: 0,
        strategy: "default",
      },
    ];

    server = createControlPlaneServer({
      repo: createWorkspaceRepo(publishedConfig, {
        getExport: async () =>
          createExportProfile({
            name: "搜索出口",
            serverName: "search-hub",
            enabledSourceIds: ["exa"],
          }),
      }),
      consoleRepo: createConsoleRepo({
        sources,
        discoveries,
        exposures,
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/exports/export-a/config",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "search-hub",
      displayName: "搜索出口",
      upstreams: [{ id: "exa" }],
    });
    expect(response.json().upstreams).toHaveLength(1);
  });

  it("export config 存在有效 token 时未带 Bearer 会返回 401", async () => {
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
        getExport: async () => createExportProfile(),
        verifyExportToken: async () => false,
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/exports/export-a/config",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("export config 携带 Bearer token 时允许访问", async () => {
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
        getExport: async () =>
          createExportProfile({
            name: "IDE 出口",
            serverName: "idea-tools",
            enabledSourceIds: [],
          }),
        verifyExportToken: async (_workspaceId, _exportId, token) => token === "export-secret",
      }),
    });

    const response = await server.inject({
      method: "GET",
      url: "/v1/workspaces/mcp-hub/exports/export-a/config",
      headers: {
        authorization: "Bearer export-secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      workspaceId: "idea-tools",
      displayName: "IDE 出口",
      upstreams: [],
    });
  });
});

function createWorkspaceRepo(
  config: WorkspaceConfig,
  overrides?: {
    verifyToken?: WorkspaceRepository["verifyToken"];
    getExport?: WorkspaceRepository["getExport"];
    verifyExportToken?: WorkspaceRepository["verifyExportToken"];
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
    listExports: async (): Promise<WorkspaceExportProfile[]> => [],
    createExport: async () => unsupported(),
    updateExport: async () => unsupported(),
    deleteExport: async () => unsupported(),
    getExport: overrides?.getExport ?? (async (): Promise<WorkspaceExportProfile | null> => null),
    createExportToken: async () => unsupported(),
    verifyExportToken: overrides?.verifyExportToken ?? (async (): Promise<boolean> => true),
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

function createExportProfile(overrides?: Partial<WorkspaceExportProfile>): WorkspaceExportProfile {
  return {
    id: "export-a",
    workspaceId: "mcp-hub",
    name: "默认出口",
    serverName: "default-export",
    enabledSourceIds: [],
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    ...overrides,
  };
}
