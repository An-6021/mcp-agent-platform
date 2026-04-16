import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import {
  buildCachedCapabilities,
  buildWorkspaceConfigFromSources,
  parseWorkspaceConfig,
  type ConsoleRepository,
  type WorkspaceExportProfile,
  type WorkspaceConfig,
  type WorkspaceRepository,
} from "@mcp-agent-platform/shared";
import { launchAgentRuntime, StreamableHTTPServerTransport, type AgentRuntimeHandle } from "@mcp-agent-platform/runtime";

export type ControlPlaneServerOptions = {
  repo: WorkspaceRepository;
  consoleRepo?: ConsoleRepository;
  /** Serve static files from this directory (production web panel) */
  staticDir?: string;
};

type WorkspaceAuthResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "workspace_not_found" };

type WorkspaceMcpSession = {
  workspaceId: string;
  exportId: string | null;
  transport: StreamableHTTPServerTransport;
  runtime: AgentRuntimeHandle;
};

export function createControlPlaneServer(options: ControlPlaneServerOptions): FastifyInstance {
  const { repo, consoleRepo } = options;
  const mcpSessions = new Map<string, WorkspaceMcpSession>();

  const server = Fastify({
    logger: true,
  });

  server.addHook("onClose", async () => {
    await Promise.allSettled([...mcpSessions.values()].map((session) => session.runtime.close()));
    mcpSessions.clear();
  });

  server.get("/health", async () => ({
    ok: true,
  }));

  server.get("/v1/workspaces/:workspaceId/config", async (request, reply) => {
    const workspaceId = String((request.params as { workspaceId: string }).workspaceId);
    try {
      const auth = await authorizeWorkspaceAccess(repo, workspaceId, getAuthorizationHeader(request.headers.authorization));
      if (auth.status === "unauthorized") {
        reply.code(401);
        return { error: "unauthorized" };
      }

      if (auth.status === "workspace_not_found") {
        reply.code(404);
        return { error: "workspace_not_found" };
      }

      return await loadWorkspaceRuntimeConfig(repo, consoleRepo, workspaceId);
    } catch (error) {
      request.log.error({ error, workspaceId }, "Failed to read workspace config");
      reply.code(500);
      return { error: "internal_error" };
    }
  });

  server.get("/v1/workspaces/:workspaceId/exports/:exportId/config", async (request, reply) => {
    const { workspaceId, exportId } = request.params as { workspaceId: string; exportId: string };
    try {
      const auth = await authorizeExportAccess(
        repo,
        workspaceId,
        exportId,
        getAuthorizationHeader(request.headers.authorization),
      );
      if (auth.status === "unauthorized") {
        reply.code(401);
        return { error: "unauthorized" };
      }

      if (auth.status === "workspace_not_found") {
        reply.code(404);
        return { error: "workspace_not_found" };
      }

      if (auth.status === "export_not_found") {
        reply.code(404);
        return { error: "export_not_found" };
      }

      return await loadExportRuntimeConfig(repo, consoleRepo, workspaceId, exportId);
    } catch (error) {
      request.log.error({ error, workspaceId, exportId }, "Failed to read export config");
      reply.code(500);
      return { error: "internal_error" };
    }
  });

  server.route({
    method: ["GET", "POST", "DELETE"],
    url: "/v1/workspaces/:workspaceId/mcp",
    handler: async (request, reply) => {
      const workspaceId = String((request.params as { workspaceId: string }).workspaceId);
      reply.hijack();

      try {
        const parsedBody = request.body;
        const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;

        if (sessionId) {
          const session = mcpSessions.get(sessionId);
          if (!session || session.workspaceId !== workspaceId || session.exportId !== null) {
            writeJsonRpcError(reply.raw, 404, -32001, "Session not found");
            return reply;
          }

          await session.transport.handleRequest(request.raw, reply.raw, parsedBody);

          if (request.method === "DELETE") {
            mcpSessions.delete(sessionId);
            await session.runtime.close();
          }

          return reply;
        }

        const auth = await authorizeWorkspaceAccess(repo, workspaceId, getAuthorizationHeader(request.headers.authorization));
        if (auth.status === "unauthorized") {
          writeJson(reply.raw, 401, { error: "unauthorized" });
          return reply;
        }

        if (auth.status === "workspace_not_found") {
          writeJson(reply.raw, 404, { error: "workspace_not_found" });
          return reply;
        }

        if (request.method === "POST" && isInitializeRequest(parsedBody)) {
          const config = await loadWorkspaceRuntimeConfig(repo, consoleRepo, workspaceId);
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => randomUUID(),
          });
          const runtime = await launchAgentRuntime(config, transport);

          try {
            await transport.handleRequest(request.raw, reply.raw, parsedBody);

            if (transport.sessionId) {
              mcpSessions.set(transport.sessionId, {
                workspaceId,
                exportId: null,
                transport,
                runtime,
              });
            } else {
              await runtime.close();
            }
          } catch (error) {
            await runtime.close();
            throw error;
          }

          return reply;
        }

        writeJsonRpcError(reply.raw, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return reply;
      } catch (error) {
        request.log.error({ error, workspaceId }, "Failed to handle remote MCP request");
        writeJson(reply.raw, 500, { error: "internal_error" });
        return reply;
      }
    },
  });

  server.route({
    method: ["GET", "POST", "DELETE"],
    url: "/v1/workspaces/:workspaceId/exports/:exportId/mcp",
    handler: async (request, reply) => {
      const { workspaceId, exportId } = request.params as { workspaceId: string; exportId: string };
      reply.hijack();

      try {
        const parsedBody = request.body;
        const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;

        if (sessionId) {
          const session = mcpSessions.get(sessionId);
          if (!session || session.workspaceId !== workspaceId || session.exportId !== exportId) {
            writeJsonRpcError(reply.raw, 404, -32001, "Session not found");
            return reply;
          }

          await session.transport.handleRequest(request.raw, reply.raw, parsedBody);

          if (request.method === "DELETE") {
            mcpSessions.delete(sessionId);
            await session.runtime.close();
          }

          return reply;
        }

        const auth = await authorizeExportAccess(
          repo,
          workspaceId,
          exportId,
          getAuthorizationHeader(request.headers.authorization),
        );
        if (auth.status === "unauthorized") {
          writeJson(reply.raw, 401, { error: "unauthorized" });
          return reply;
        }

        if (auth.status === "workspace_not_found") {
          writeJson(reply.raw, 404, { error: "workspace_not_found" });
          return reply;
        }

        if (auth.status === "export_not_found") {
          writeJson(reply.raw, 404, { error: "export_not_found" });
          return reply;
        }

        if (request.method === "POST" && isInitializeRequest(parsedBody)) {
          const config = await loadExportRuntimeConfig(repo, consoleRepo, workspaceId, exportId);
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => randomUUID(),
          });
          const runtime = await launchAgentRuntime(config, transport);

          try {
            await transport.handleRequest(request.raw, reply.raw, parsedBody);

            if (transport.sessionId) {
              mcpSessions.set(transport.sessionId, {
                workspaceId,
                exportId,
                transport,
                runtime,
              });
            } else {
              await runtime.close();
            }
          } catch (error) {
            await runtime.close();
            throw error;
          }

          return reply;
        }

        writeJsonRpcError(reply.raw, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return reply;
      } catch (error) {
        request.log.error({ error, workspaceId, exportId }, "Failed to handle export MCP request");
        writeJson(reply.raw, 500, { error: "internal_error" });
        return reply;
      }
    },
  });

  return server;
}

type ExportAuthResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "workspace_not_found" }
  | { status: "export_not_found" };

async function authorizeWorkspaceAccess(
  repo: WorkspaceRepository,
  workspaceId: string,
  authorizationHeader?: string,
): Promise<WorkspaceAuthResult> {
  const config = await repo.getPublishedConfig(workspaceId);
  if (!config) {
    return { status: "workspace_not_found" };
  }

  const token = readBearerToken(authorizationHeader);
  const verified = await repo.verifyToken(workspaceId, token ?? "");
  if (!verified) {
    return { status: "unauthorized" };
  }

  return { status: "ok" };
}

async function authorizeExportAccess(
  repo: WorkspaceRepository,
  workspaceId: string,
  exportId: string,
  authorizationHeader?: string,
): Promise<ExportAuthResult> {
  const config = await repo.getPublishedConfig(workspaceId);
  if (!config) {
    return { status: "workspace_not_found" };
  }

  const exportProfile = await repo.getExport(workspaceId, exportId);
  if (!exportProfile) {
    return { status: "export_not_found" };
  }

  const token = readBearerToken(authorizationHeader);
  const verified = await repo.verifyExportToken(workspaceId, exportId, token ?? "");
  if (!verified) {
    return { status: "unauthorized" };
  }

  return { status: "ok" };
}

async function loadWorkspaceRuntimeConfig(
  repo: WorkspaceRepository,
  consoleRepo: ConsoleRepository | undefined,
  workspaceId: string,
): Promise<WorkspaceConfig> {
  const publishedConfig = await repo.getPublishedConfig(workspaceId);
  if (!publishedConfig) {
    throw new Error(`Workspace "${workspaceId}" not found`);
  }

  const config = await buildRuntimeConfigFromConsoleSources(workspaceId, publishedConfig, consoleRepo);
  return await enrichWorkspaceConfig(config, consoleRepo);
}

async function loadExportRuntimeConfig(
  repo: WorkspaceRepository,
  consoleRepo: ConsoleRepository | undefined,
  workspaceId: string,
  exportId: string,
): Promise<WorkspaceConfig> {
  const publishedConfig = await repo.getPublishedConfig(workspaceId);
  if (!publishedConfig) {
    throw new Error(`Workspace "${workspaceId}" not found`);
  }

  const exportProfile = await repo.getExport(workspaceId, exportId);
  if (!exportProfile) {
    throw new Error(`Export "${exportId}" not found for workspace "${workspaceId}"`);
  }

  const config = await buildRuntimeConfigForExport(workspaceId, publishedConfig, exportProfile, consoleRepo);
  return await enrichWorkspaceConfig(config, consoleRepo);
}

async function buildRuntimeConfigFromConsoleSources(
  workspaceId: string,
  publishedConfig: WorkspaceConfig,
  consoleRepo?: ConsoleRepository,
): Promise<WorkspaceConfig> {
  if (!consoleRepo) return publishedConfig;

  const sources = await consoleRepo.listSources();
  if (sources.length === 0) return publishedConfig;

  const runtimeConfig = buildWorkspaceConfigFromSources({
    workspaceId,
    displayName: publishedConfig.displayName,
    sources,
  });

  return parseWorkspaceConfig({
    ...runtimeConfig,
    schemaVersion: publishedConfig.schemaVersion,
    cacheTtlSeconds: publishedConfig.cacheTtlSeconds,
  });
}

async function buildRuntimeConfigForExport(
  workspaceId: string,
  publishedConfig: WorkspaceConfig,
  exportProfile: WorkspaceExportProfile,
  consoleRepo?: ConsoleRepository,
): Promise<WorkspaceConfig> {
  const enabledSourceIds = new Set(exportProfile.enabledSourceIds);

  if (consoleRepo) {
    const sources = await consoleRepo.listSources();
    const filteredSources = sources.filter((source) => source.enabled && enabledSourceIds.has(source.id));
    const runtimeConfig = buildWorkspaceConfigFromSources({
      workspaceId: exportProfile.serverName,
      displayName: exportProfile.name,
      sources: filteredSources,
    });

    return parseWorkspaceConfig({
      ...runtimeConfig,
      schemaVersion: publishedConfig.schemaVersion,
      cacheTtlSeconds: publishedConfig.cacheTtlSeconds,
    });
  }

  return parseWorkspaceConfig({
    ...publishedConfig,
    workspaceId: exportProfile.serverName,
    displayName: exportProfile.name,
    upstreams: publishedConfig.upstreams.filter((upstream) => upstream.enabled && enabledSourceIds.has(upstream.id)),
  });
}

async function enrichWorkspaceConfig(config: WorkspaceConfig, consoleRepo?: ConsoleRepository): Promise<WorkspaceConfig> {
  if (!consoleRepo || config.upstreams.length === 0) return config;

  const exposures = await consoleRepo.listExposures();
  const upstreams = await Promise.all(
    config.upstreams.map(async (upstream) => {
      const discovery = await consoleRepo.getDiscovery(upstream.id);
      return {
        ...upstream,
        cachedCapabilities: buildCachedCapabilities(discovery, exposures, upstream.label),
      };
    }),
  );

  return parseWorkspaceConfig({
    ...config,
    upstreams,
  });
}

function isInitializeRequest(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      "method" in body &&
      (body as { method?: unknown }).method === "initialize",
  );
}

function getAuthorizationHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return Array.isArray(value) ? value[0] : undefined;
}

function readBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function writeJson(response: ServerResponse, status: number, body: Record<string, string>) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
