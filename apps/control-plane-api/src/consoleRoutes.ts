import type { FastifyInstance } from "fastify";
import type { HostedProcessManager } from "./hostedProcessManager";
import { inspectWorkspaceCapabilities } from "@mcp-agent-platform/runtime";
import {
  buildWorkspaceConfigFromSources,
  defaultExposedName,
  getHostedRuntimeAutoStart,
  isHostedSource,
  type ConsoleRepository,
  type CreateSourceInput,
  type HostedListItem,
  type HostedRuntimeState,
  type LogEntry,
  type Source,
  type SourceDiscovery,
  type SourceListItem,
  type SourceStatus,
  type SystemSummary,
  type ToolExposure,
  type ToolListItem,
  type UpdateSourceInput,
  type UpdateToolExposureInput,
} from "@mcp-agent-platform/shared";

// 判断是否为网络连接类错误（远程不可达、连接拒绝等）
const NETWORK_ERROR_PATTERNS = ["fetch failed", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "socket hang up", "network"];
function isNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return NETWORK_ERROR_PATTERNS.some((pattern) => msg.toLowerCase().includes(pattern.toLowerCase()));
}

function ok<T>(data: T) {
  return { data, error: null };
}

function fail(code: string, message: string) {
  return { data: null, error: { code, message } };
}

function statusFromSource(source: Source): SourceStatus {
  return source.enabled ? source.status : "disabled";
}

function toSourceListItem(source: Source, discovery: SourceDiscovery | null): SourceListItem {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    enabled: source.enabled,
    status: statusFromSource(source),
    toolCount: discovery?.tools.length ?? 0,
    resourceCount: discovery?.resources.length ?? 0,
    promptCount: discovery?.prompts.length ?? 0,
    isHosted: isHostedSource(source),
    lastRefreshedAt: source.lastRefreshedAt,
    lastError: source.lastError,
  };
}

function defaultExposure(source: Source, toolName: string, order = 0): ToolExposure {
  return {
    sourceId: source.id,
    originalName: toolName,
    exposedName: defaultExposedName(source.name, toolName),
    enabled: true,
    order,
    strategy: "default",
  };
}

function emptyHostedState(source: Source): HostedRuntimeState {
  return {
    sourceId: source.id,
    status: "stopped",
    pid: null,
    startedAt: null,
    stoppedAt: null,
    restartCount: 0,
    autoStart: getHostedRuntimeAutoStart(source),
    lastExitCode: null,
    lastError: null,
  };
}

async function buildToolItems(repo: ConsoleRepository): Promise<ToolListItem[]> {
  const [sources, exposures] = await Promise.all([repo.listSources(), repo.listExposures()]);
  const exposureMap = new Map(exposures.map((item) => [`${item.sourceId}:${item.originalName}`, item]));

  const items: ToolListItem[] = [];
  for (const source of sources) {
    const discovery = await repo.getDiscovery(source.id);
    for (const tool of discovery?.tools ?? []) {
      const exposure = exposureMap.get(`${source.id}:${tool.name}`) ?? defaultExposure(source, tool.name);
      items.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        originalName: tool.name,
        exposedName: exposure.exposedName,
        enabled: exposure.enabled,
        strategy: exposure.strategy,
        description: tool.description,
        conflictStatus: "none",
      });
    }
  }

  const nameCount = new Map<string, number>();
  for (const item of items.filter((item) => item.enabled)) {
    nameCount.set(item.exposedName, (nameCount.get(item.exposedName) ?? 0) + 1);
  }

  return items.map((item) => ({
    ...item,
    conflictStatus: item.enabled && (nameCount.get(item.exposedName) ?? 0) > 1 ? "name-conflict" : "none",
  }));
}

async function buildHostedItems(repo: ConsoleRepository): Promise<HostedListItem[]> {
  const hostedSources = (await repo.listSources()).filter(isHostedSource);
  return Promise.all(
    hostedSources.map(async (source) => {
      const state = (await repo.getHostedState(source.id)) ?? emptyHostedState(source);
      const item: HostedListItem = {
        sourceId: source.id,
        name: source.name,
        kind: source.kind as HostedListItem["kind"],
        enabled: source.enabled,
        runtimeStatus: state.status,
        autoStart: state.autoStart,
        startedAt: state.startedAt,
        restartCount: state.restartCount,
        lastError: state.lastError,
      };
      return item;
    }),
  );
}

function buildSummary(sourceItems: SourceListItem[], toolItems: ToolListItem[], hostedItems: HostedListItem[]): SystemSummary {
  return {
    sourceCount: sourceItems.length,
    enabledSourceCount: sourceItems.filter((item) => item.enabled).length,
    exposedToolCount: toolItems.filter((item) => item.enabled).length,
    hiddenToolCount: toolItems.filter((item) => !item.enabled).length,
    conflictToolCount: toolItems.filter((item) => item.conflictStatus === "name-conflict").length,
    hostedRunningCount: hostedItems.filter((item) => item.runtimeStatus === "running").length,
    hostedErrorCount: hostedItems.filter((item) => item.runtimeStatus === "error").length,
  };
}

async function ensureDiscoveryExposures(repo: ConsoleRepository, source: Source, discovery: SourceDiscovery) {
  const existing = await repo.listExposures();
  const byKey = new Map(existing.map((item) => [`${item.sourceId}:${item.originalName}`, item]));

  const additions = discovery.tools
    .filter((tool) => !byKey.has(`${source.id}:${tool.name}`))
    .map((tool, index) => defaultExposure(source, tool.name, index));

  if (additions.length > 0) {
    await repo.saveExposures([...existing, ...additions]);
  }

  return { created: additions.length, updated: 0 };
}

function toDiscovery(source: Source, result: Awaited<ReturnType<typeof inspectWorkspaceCapabilities>>): SourceDiscovery {
  const upstream = result.upstreams[0];
  return {
    sourceId: source.id,
    generatedAt: result.generatedAt,
    status: upstream?.status === "error" ? "error" : "ready",
    error: upstream?.error ?? null,
    tools:
      upstream?.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })) ?? [],
    resources:
      upstream?.resources.map((resource) => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      })) ?? [],
    prompts:
      upstream?.prompts.map((prompt) => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments,
      })) ?? [],
  };
}

export function mergeDiscoveryWithPrevious(discovery: SourceDiscovery, previous: SourceDiscovery | null): SourceDiscovery {
  if (!previous || discovery.status !== "error") {
    return discovery;
  }

  return {
    ...discovery,
    tools: previous.tools,
    resources: previous.resources,
    prompts: previous.prompts,
  };
}

async function refreshSourceDiscovery(repo: ConsoleRepository, source: Source) {
  const previousDiscovery = await repo.getDiscovery(source.id);
  const config = buildWorkspaceConfigFromSources({
    sources: [source],
    workspaceId: source.id,
    displayName: source.name,
  });
  const inspection = await inspectWorkspaceCapabilities(config);
  const discovery = mergeDiscoveryWithPrevious(toDiscovery(source, inspection), previousDiscovery);

  await repo.saveDiscovery(discovery);
  const sourceStatus = discovery.status === "error"
    ? (discovery.error && isNetworkError(new Error(discovery.error)) ? "offline" as const : "error" as const)
    : "ready" as const;
  const refreshedSource = await repo.updateSource(source.id, {
    status: sourceStatus,
    lastRefreshedAt: discovery.generatedAt,
    lastError: discovery.error,
  });
  const exposureChanges = await ensureDiscoveryExposures(repo, refreshedSource, discovery);

  return { source: refreshedSource, discovery, exposureChanges };
}

async function appendSystemLog(repo: ConsoleRepository, sourceId: string, message: string) {
  const entry: LogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceId,
    timestamp: new Date().toISOString(),
    stream: "system",
    message,
  };
  await repo.appendLog(entry);
}

export function registerConsoleRoutes(server: FastifyInstance, options: { repo: ConsoleRepository; processManager?: HostedProcessManager }) {
  const { repo, processManager } = options;

  server.get("/admin/sources", async () => {
    const sources = await repo.listSources();
    const sourceItems = await Promise.all(
      sources.map(async (source) => toSourceListItem(source, await repo.getDiscovery(source.id))),
    );
    const [toolItems, hostedItems] = await Promise.all([buildToolItems(repo), buildHostedItems(repo)]);

    return ok({
      items: sourceItems,
      summary: buildSummary(sourceItems, toolItems, hostedItems),
    });
  });

  server.post("/admin/sources", async (request, reply) => {
    const body = (request.body ?? {}) as CreateSourceInput;

    if (!body.id || !body.name || !body.kind) {
      reply.code(400);
      return fail("invalid_input", "id, name and kind are required");
    }

    try {
      const source = await repo.createSource(body);
      reply.code(201);
      return ok(source);
    } catch (error) {
      reply.code(409);
      return fail("source_create_failed", (error as Error).message);
    }
  });

  server.get("/admin/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source) {
      reply.code(404);
      return fail("source_not_found", `Source \"${sourceId}\" not found`);
    }

    return ok({
      source,
      discovery: await repo.getDiscovery(sourceId),
      hostedState: await repo.getHostedState(sourceId),
    });
  });

  server.put("/admin/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const body = (request.body ?? {}) as UpdateSourceInput;

    try {
      const source = await repo.updateSource(sourceId, body);
      return ok(source);
    } catch (error) {
      reply.code(404);
      return fail("source_update_failed", (error as Error).message);
    }
  });

  server.delete("/admin/sources/:sourceId", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };

    try {
      await repo.deleteSource(sourceId);
      return ok({ deleted: true as const });
    } catch (error) {
      reply.code(404);
      return fail("source_delete_failed", (error as Error).message);
    }
  });

  server.post("/admin/sources/:sourceId/toggle", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const { enabled } = (request.body ?? {}) as { enabled?: boolean };

    if (typeof enabled !== "boolean") {
      reply.code(400);
      return fail("invalid_input", "enabled is required");
    }

    try {
      const source = await repo.updateSource(sourceId, {
        enabled,
        status: enabled ? "unknown" : "disabled",
      });
      return ok(source);
    } catch (error) {
      reply.code(404);
      return fail("source_not_found", (error as Error).message);
    }
  });

  server.post("/admin/sources/:sourceId/refresh", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source) {
      reply.code(404);
      return fail("source_not_found", `Source \"${sourceId}\" not found`);
    }

    try {
      return ok(await refreshSourceDiscovery(repo, source));
    } catch (error) {
      const errorStatus = isNetworkError(error) ? "offline" as const : "error" as const;
      await repo.updateSource(source.id, {
        status: errorStatus,
        lastRefreshedAt: new Date().toISOString(),
        lastError: (error as Error).message,
      }).catch(() => {});
      reply.code(500);
      return fail("source_refresh_failed", (error as Error).message);
    }
  });

  server.post("/admin/sources/:sourceId/snapshot", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source) {
      reply.code(404);
      return fail("source_not_found", `Source \"${sourceId}\" not found`);
    }

    try {
      reply.type("application/json");
      return (await refreshSourceDiscovery(repo, source)).discovery;
    } catch (error) {
      const errorStatus = isNetworkError(error) ? "offline" as const : "error" as const;
      await repo.updateSource(source.id, {
        status: errorStatus,
        lastRefreshedAt: new Date().toISOString(),
        lastError: (error as Error).message,
      }).catch(() => {});
      reply.code(500);
      return fail("source_snapshot_failed", (error as Error).message);
    }
  });

  // 批量刷新所有已启用 source 的能力
  server.post("/admin/sources/refresh-all", async () => {
    const sources = await repo.listSources();
    const enabledSources = sources.filter((source) => source.enabled);
    const results: Array<{ sourceId: string; status: "ok" | "error"; toolCount: number; error?: string }> = [];

    for (const source of enabledSources) {
      try {
        const refreshed = await refreshSourceDiscovery(repo, source);
        results.push({ sourceId: source.id, status: "ok", toolCount: refreshed.discovery.tools.length });
      } catch (error) {
        const errorStatus = isNetworkError(error) ? "offline" as const : "error" as const;
        await repo.updateSource(source.id, {
          status: errorStatus,
          lastRefreshedAt: new Date().toISOString(),
          lastError: (error as Error).message,
        }).catch(() => {});
        results.push({ sourceId: source.id, status: "error", toolCount: 0, error: (error as Error).message });
      }
    }

    return ok({
      total: enabledSources.length,
      succeeded: results.filter((item) => item.status === "ok").length,
      failed: results.filter((item) => item.status === "error").length,
      results,
    });
  });

  server.get("/admin/tools", async (request) => {
    const query = request.query as {
      sourceId?: string;
      enabled?: string;
      conflictOnly?: string;
      q?: string;
    };

    const allItems = await buildToolItems(repo);
    const items = allItems.filter((item) => {
      if (query.sourceId && item.sourceId !== query.sourceId) return false;
      if (query.enabled === "true" && !item.enabled) return false;
      if (query.enabled === "false" && item.enabled) return false;
      if (query.conflictOnly === "true" && item.conflictStatus !== "name-conflict") return false;
      if (query.q) {
        const keyword = query.q.toLowerCase();
        const haystack = [item.exposedName, item.originalName, item.sourceName].join(" ").toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });

    return ok({
      items,
      summary: {
        exposedToolCount: allItems.filter((item) => item.enabled).length,
        hiddenToolCount: allItems.filter((item) => !item.enabled).length,
        conflictToolCount: allItems.filter((item) => item.conflictStatus === "name-conflict").length,
        sourceCount: new Set(allItems.map((item) => item.sourceId)).size,
      },
    });
  });

  server.put("/admin/tools/:sourceId/:toolName", async (request, reply) => {
    const { sourceId, toolName } = request.params as { sourceId: string; toolName: string };
    const body = (request.body ?? {}) as UpdateToolExposureInput;
    const source = await repo.getSource(sourceId);

    if (!source) {
      reply.code(404);
      return fail("source_not_found", `Source \"${sourceId}\" not found`);
    }

    const existing = (await repo.listExposures()).find(
      (item) => item.sourceId === sourceId && item.originalName === toolName,
    );

    const next: ToolExposure = {
      sourceId,
      originalName: toolName,
      exposedName: body.exposedName ?? existing?.exposedName ?? defaultExposedName(source.name, toolName),
      enabled: body.enabled ?? existing?.enabled ?? true,
      order: existing?.order ?? 0,
      strategy:
        body.enabled === false
          ? "hidden"
          : body.exposedName
            ? "renamed"
            : existing?.strategy ?? "default",
    };

    return ok(await repo.saveExposure(next));
  });

  server.post("/admin/tools/batch", async (request) => {
    const body = (request.body ?? {}) as {
      items?: Array<{ sourceId: string; originalName: string; exposedName?: string; enabled?: boolean }>;
    };

    const current = await repo.listExposures();
    const next = [...current];

    for (const item of body.items ?? []) {
      const source = await repo.getSource(item.sourceId);
      if (!source) continue;

      const index = next.findIndex(
        (entry) => entry.sourceId === item.sourceId && entry.originalName === item.originalName,
      );
      const prev: ToolExposure =
        index >= 0 ? next[index] ?? defaultExposure(source, item.originalName, next.length) : defaultExposure(source, item.originalName, next.length);

      const merged: ToolExposure = {
        sourceId: item.sourceId,
        originalName: item.originalName,
        exposedName: item.exposedName ?? prev.exposedName,
        enabled: item.enabled ?? prev.enabled,
        order: prev.order,
        strategy:
          item.enabled === false
            ? "hidden"
            : item.exposedName
              ? "renamed"
              : prev.strategy,
      };

      if (index >= 0) {
        next[index] = merged;
      } else {
        next.push(merged);
      }
    }

    await repo.saveExposures(next);
    return ok({ updated: body.items?.length ?? 0 });
  });

  server.post("/admin/tools/rebuild", async () => {
    const sources = await repo.listSources();
    let createdExposureCount = 0;

    for (const source of sources) {
      const discovery = await repo.getDiscovery(source.id);
      if (!discovery) continue;
      const changes = await ensureDiscoveryExposures(repo, source, discovery);
      createdExposureCount += changes.created;
    }

    const items = await buildToolItems(repo);
    return ok({
      sourceCount: sources.length,
      toolCount: items.length,
      createdExposureCount,
    });
  });

  server.get("/admin/hosted", async () => {
    const items = await buildHostedItems(repo);
    return ok({
      items,
      summary: {
        total: items.length,
        running: items.filter((item) => item.runtimeStatus === "running").length,
        stopped: items.filter((item) => item.runtimeStatus === "stopped").length,
        error: items.filter((item) => item.runtimeStatus === "error").length,
      },
    });
  });

  server.post("/admin/hosted/:sourceId/start", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source || !isHostedSource(source)) {
      reply.code(404);
      return fail("hosted_source_not_found", `Hosted source \"${sourceId}\" not found`);
    }

    // 如果有进程管理器则真正拉起进程，否则只标记状态
    if (processManager) {
      try {
        const state = await processManager.start(source);
        return ok({ state });
      } catch (error) {
        reply.code(500);
        return fail("hosted_start_failed", (error as Error).message);
      }
    }

    const current = (await repo.getHostedState(sourceId)) ?? emptyHostedState(source);
    const next: HostedRuntimeState = {
      ...current,
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      lastError: null,
      autoStart: getHostedRuntimeAutoStart(source),
    };

    await repo.saveHostedState(next);
    await appendSystemLog(repo, sourceId, `Hosted source ${source.name} marked as started`);
    return ok({ state: next });
  });

  server.post("/admin/hosted/:sourceId/stop", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source || !isHostedSource(source)) {
      reply.code(404);
      return fail("hosted_source_not_found", `Hosted source \"${sourceId}\" not found`);
    }

    if (processManager) {
      try {
        const state = await processManager.stop(sourceId);
        return ok({ state });
      } catch (error) {
        reply.code(500);
        return fail("hosted_stop_failed", (error as Error).message);
      }
    }

    const current = (await repo.getHostedState(sourceId)) ?? emptyHostedState(source);
    const next: HostedRuntimeState = {
      ...current,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      pid: null,
    };

    await repo.saveHostedState(next);
    await appendSystemLog(repo, sourceId, `Hosted source ${source.name} marked as stopped`);
    return ok({ state: next });
  });

  server.post("/admin/hosted/:sourceId/restart", async (request, reply) => {
    const { sourceId } = request.params as { sourceId: string };
    const source = await repo.getSource(sourceId);
    if (!source || !isHostedSource(source)) {
      reply.code(404);
      return fail("hosted_source_not_found", `Hosted source \"${sourceId}\" not found`);
    }

    if (processManager) {
      try {
        const state = await processManager.restart(source);
        return ok({ state });
      } catch (error) {
        reply.code(500);
        return fail("hosted_restart_failed", (error as Error).message);
      }
    }

    const current = (await repo.getHostedState(sourceId)) ?? emptyHostedState(source);
    const next: HostedRuntimeState = {
      ...current,
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      restartCount: current.restartCount + 1,
      lastError: null,
      autoStart: getHostedRuntimeAutoStart(source),
    };

    await repo.saveHostedState(next);
    await appendSystemLog(repo, sourceId, `Hosted source ${source.name} marked as restarted`);
    return ok({ state: next });
  });

  server.get("/admin/hosted/:sourceId/logs", async (request) => {
    const { sourceId } = request.params as { sourceId: string };
    const { limit } = request.query as { limit?: string };
    const items = await repo.listLogs(sourceId, limit ? Number.parseInt(limit, 10) : 100);
    return ok({ items });
  });

  // 批量迁移所有 hosted-npm 来源为 local-stdio（npx -y packageName）
  server.post("/admin/migrate/hosted-npm-to-local-stdio", async () => {
    const sources = await repo.listSources();
    const npmSources = sources.filter((s) => s.kind === "hosted-npm");

    if (npmSources.length === 0) {
      return ok({ migrated: 0, results: [] });
    }

    const results: Array<{ sourceId: string; status: "ok" | "error"; error?: string }> = [];

    for (const source of npmSources) {
      try {
        const config = source.config as { packageName: string; binName?: string; args?: string[]; cwd?: string | null; env?: Record<string, string>; timeoutMs?: number };
        // 构建 npx 命令：npx -y packageName [args...]
        const command = ["npx", "-y", config.packageName];
        if (config.args?.length) {
          command.push(...config.args);
        }

        // 保留 discovery 数据
        const discovery = await repo.getDiscovery(source.id);

        // 先删后建（原子迁移），保留同一 id
        await repo.deleteSource(source.id);
        await repo.createSource({
          id: source.id,
          name: source.name,
          kind: "local-stdio",
          enabled: source.enabled,
          config: {
            command,
            cwd: config.cwd ?? null,
            env: config.env ?? {},
            timeoutMs: config.timeoutMs ?? 30_000,
          },
          ...(source.seedDiscovery ? { seedDiscovery: { ...source.seedDiscovery, sourceId: source.id } } : {}),
        });

        // 恢复 discovery（deleteSource 会删除它）
        if (discovery) {
          await repo.saveDiscovery(discovery);
        }

        results.push({ sourceId: source.id, status: "ok" });
      } catch (error) {
        results.push({ sourceId: source.id, status: "error", error: (error as Error).message });
      }
    }

    return ok({
      migrated: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  });
}
