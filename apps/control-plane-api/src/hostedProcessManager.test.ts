import { afterEach, describe, expect, it } from "vitest";
import type {
  ConsoleRepository,
  HostedRuntimeState,
  LogEntry,
  Source,
  SourceDiscovery,
  ToolExposure,
  UpdateSourceInput,
} from "@mcp-agent-platform/shared";
import { HostedProcessManager } from "./hostedProcessManager";

const activeManagers: HostedProcessManager[] = [];

afterEach(async () => {
  await Promise.all(activeManagers.splice(0).map((manager) => manager.shutdownAll()));
});

describe("HostedProcessManager", () => {
  it("启动 hosted single-file 时保持 stdin 打开，进程不会立刻退出", async () => {
    const source = createHostedSingleFileSource();
    const repo = createConsoleRepo([source]);
    const manager = new HostedProcessManager(repo);
    activeManagers.push(manager);

    const state = await manager.start(source);
    await wait(150);

    expect(state.status).toBe("running");
    expect(manager.isRunning(source.id)).toBe(true);
    expect((await repo.getHostedState(source.id))?.status).toBe("running");
  });

  it("只自动启动启用且 autoStart 打开的 hosted 来源", async () => {
    const enabledSource = createHostedSingleFileSource();
    const disabledSource = { ...createHostedSingleFileSource(), id: "disabled", enabled: false };
    const manualSource = {
      ...createHostedSingleFileSource(),
      id: "manual",
      config: { ...createHostedSingleFileSource().config, autoStart: false },
    };
    const repo = createConsoleRepo([enabledSource, disabledSource, manualSource]);
    const manager = new HostedProcessManager(repo);
    activeManagers.push(manager);

    const result = await manager.startAutoStartSources();
    await wait(150);

    expect(result.total).toBe(1);
    expect(result.started).toBe(1);
    expect(manager.isRunning(enabledSource.id)).toBe(true);
    expect(manager.isRunning(disabledSource.id)).toBe(false);
    expect(manager.isRunning(manualSource.id)).toBe(false);
  });
});

function createHostedSingleFileSource(): Source {
  return {
    id: "keepalive",
    name: "keepalive",
    enabled: true,
    tags: [],
    createdAt: "2026-04-13T00:00:00.000Z",
    updatedAt: "2026-04-13T00:00:00.000Z",
    lastRefreshedAt: null,
    status: "ready",
    lastError: null,
    kind: "hosted-single-file",
    config: {
      fileName: "server.mjs",
      runtime: "node",
      source: `
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
setInterval(() => {}, 1000);
`,
      args: [],
      cwd: null,
      env: {},
      timeoutMs: 30_000,
      autoStart: true,
    },
  };
}

function createConsoleRepo(initialSources: Source[]): ConsoleRepository {
  const sources = new Map(initialSources.map((source) => [source.id, source]));
  const hostedStates = new Map<string, HostedRuntimeState>();
  const logs: LogEntry[] = [];

  return {
    listSources: async () => [...sources.values()],
    getSource: async (id: string) => sources.get(id) ?? null,
    createSource: async () => {
      throw new Error("not implemented");
    },
    updateSource: async (_id: string, _patch: UpdateSourceInput) => {
      throw new Error("not implemented");
    },
    deleteSource: async () => {
      throw new Error("not implemented");
    },
    saveDiscovery: async (_discovery: SourceDiscovery) => {
      throw new Error("not implemented");
    },
    getDiscovery: async () => null,
    listExposures: async (): Promise<ToolExposure[]> => [],
    saveExposure: async () => {
      throw new Error("not implemented");
    },
    saveExposures: async () => {
      throw new Error("not implemented");
    },
    getHostedState: async (sourceId: string) => hostedStates.get(sourceId) ?? null,
    saveHostedState: async (state: HostedRuntimeState) => {
      hostedStates.set(state.sourceId, state);
    },
    listHostedStates: async () => [...hostedStates.values()],
    appendLog: async (entry: LogEntry) => {
      logs.push(entry);
    },
    listLogs: async (sourceId: string, limit = 100) => logs.filter((item) => item.sourceId === sourceId).slice(-limit),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
