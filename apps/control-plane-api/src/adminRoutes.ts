import type { FastifyInstance } from "fastify";
import { inspectWorkspaceCapabilities } from "@mcp-agent-platform/runtime";
import {
  WORKSPACE_CONFIG_SCHEMA_VERSION,
  parseWorkspaceConfig,
  type Workspace,
  type WorkspaceDraft,
  type WorkspaceRepository,
} from "@mcp-agent-platform/shared";

type AdminRouteOptions = {
  repo: WorkspaceRepository;
};

function ok(data: unknown) {
  return { data, error: null };
}

function fail(code: string, message: string) {
  return { data: null, error: { code, message } };
}

async function buildEffectiveConfig(repo: WorkspaceRepository, workspace: Workspace) {
  const draft = await repo.getDraft(workspace.id);
  const published = await repo.getPublishedConfig(workspace.id);

  if (draft) {
    return parseWorkspaceConfig({
      schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
      workspaceId: workspace.id,
      displayName: draft.displayName,
      generatedAt: new Date().toISOString(),
      cacheTtlSeconds: draft.cacheTtlSeconds,
      upstreams: draft.upstreams,
    });
  }

  if (published) {
    return published;
  }

  return parseWorkspaceConfig({
    schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
    workspaceId: workspace.id,
    displayName: workspace.displayName,
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: workspace.cacheTtlSeconds,
    upstreams: [],
  });
}

export function registerAdminRoutes(server: FastifyInstance, options: AdminRouteOptions) {
  const { repo } = options;

  // ── List workspaces ─────────────────────────────────────────────

  server.get("/admin/workspaces", async () => {
    const list = await repo.list();
    return ok(list);
  });

  // ── Create workspace ────────────────────────────────────────────

  server.post("/admin/workspaces", async (request, reply) => {
    const body = request.body as {
      id?: string;
      displayName?: string;
      description?: string;
      cacheTtlSeconds?: number;
    };

    if (!body?.id || !body?.displayName) {
      reply.code(400);
      return fail("invalid_input", "id and displayName are required");
    }

    try {
      const workspace = await repo.createWorkspace({
        id: body.id,
        displayName: body.displayName,
        description: body.description,
        cacheTtlSeconds: body.cacheTtlSeconds,
      });
      reply.code(201);
      return ok(workspace);
    } catch (error) {
      reply.code(409);
      return fail("already_exists", (error as Error).message);
    }
  });

  // ── Get workspace detail (includes draft) ───────────────────────

  server.get("/admin/workspaces/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }
    const draft = await repo.getDraft(id);
    const publishedConfig = await repo.getPublishedConfig(id);
    const tokens = await repo.listTokens(id);
    return ok({ workspace, draft, publishedConfig, tokens });
  });

  server.get("/admin/workspaces/:id/exports", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    const items = await repo.listExports(id);
    return ok({ items });
  });

  server.post("/admin/workspaces/:id/exports", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { name?: string; serverName?: string; enabledSourceIds?: string[] } | null) ?? {};

    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    if (!body.name?.trim() || !body.serverName?.trim()) {
      reply.code(400);
      return fail("invalid_input", "name and serverName are required");
    }

    try {
      const item = await repo.createExport(id, {
        name: body.name,
        serverName: body.serverName,
        enabledSourceIds: body.enabledSourceIds ?? [],
      });
      reply.code(201);
      return ok({ item });
    } catch (error) {
      reply.code(500);
      return fail("export_create_failed", (error as Error).message);
    }
  });

  server.put("/admin/workspaces/:id/exports/:exportId", async (request, reply) => {
    const { id, exportId } = request.params as { id: string; exportId: string };
    const body = (request.body as { name?: string; serverName?: string; enabledSourceIds?: string[] } | null) ?? {};

    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const item = await repo.updateExport(id, exportId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.serverName !== undefined ? { serverName: body.serverName } : {}),
        ...(body.enabledSourceIds !== undefined ? { enabledSourceIds: body.enabledSourceIds } : {}),
      });
      return ok({ item });
    } catch (error) {
      reply.code(404);
      return fail("export_not_found", (error as Error).message);
    }
  });

  server.delete("/admin/workspaces/:id/exports/:exportId", async (request, reply) => {
    const { id, exportId } = request.params as { id: string; exportId: string };

    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      await repo.deleteExport(id, exportId);
      return ok({ deleted: true as const });
    } catch (error) {
      reply.code(404);
      return fail("export_not_found", (error as Error).message);
    }
  });

  server.get("/admin/workspaces/:id/capabilities", async (request, reply) => {
    const { id } = request.params as { id: string };
    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const config = await buildEffectiveConfig(repo, workspace);
      const capabilities = await inspectWorkspaceCapabilities(config);
      return ok(capabilities);
    } catch (error) {
      reply.code(500);
      return fail("capabilities_failed", (error as Error).message);
    }
  });

  // ── Save draft ──────────────────────────────────────────────────

  server.put("/admin/workspaces/:id/draft", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Partial<WorkspaceDraft> | null;

    if (!body) {
      reply.code(400);
      return fail("invalid_input", "Request body is required");
    }

    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    const draft: WorkspaceDraft = {
      workspaceId: id,
      displayName: body.displayName ?? ws.displayName,
      cacheTtlSeconds: body.cacheTtlSeconds ?? ws.cacheTtlSeconds,
      upstreams: body.upstreams ?? [],
      updatedAt: new Date().toISOString(),
      updatedBy: body.updatedBy ?? "admin",
    };

    try {
      await repo.saveDraft(draft);
      return ok(draft);
    } catch (error) {
      reply.code(500);
      return fail("save_failed", (error as Error).message);
    }
  });

  // ── Publish ─────────────────────────────────────────────────────

  server.post("/admin/workspaces/:id/publish", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { publishedBy?: string; note?: string } | null) ?? {};

    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const snapshot = await repo.publish(id, {
        publishedBy: body.publishedBy ?? "admin",
        note: body.note,
      });
      return ok(snapshot);
    } catch (error) {
      reply.code(422);
      return fail("publish_failed", (error as Error).message);
    }
  });

  // ── List snapshots ──────────────────────────────────────────────

  server.get("/admin/workspaces/:id/snapshots", async (request, reply) => {
    const { id } = request.params as { id: string };
    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }
    const snapshots = await repo.listSnapshots(id);
    return ok(snapshots);
  });

  // ── Rollback ────────────────────────────────────────────────────

  server.post("/admin/workspaces/:id/rollback", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { version?: number } | null;

    if (!body?.version) {
      reply.code(400);
      return fail("invalid_input", "version is required");
    }

    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const snapshot = await repo.rollback(id, body.version);
      return ok(snapshot);
    } catch (error) {
      reply.code(404);
      return fail("snapshot_not_found", (error as Error).message);
    }
  });

  // ── Token management ────────────────────────────────────────────

  server.post("/admin/workspaces/:id/tokens", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { label?: string } | null) ?? {};

    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const result = await repo.createToken(id, {
        label: body.label,
      });
      return ok({
        token: result.token,
        meta: result.meta,
      });
    } catch (error) {
      reply.code(500);
      return fail("token_create_failed", (error as Error).message);
    }
  });

  server.post("/admin/workspaces/:id/tokens/:tokenId/revoke", async (request, reply) => {
    const { id, tokenId } = request.params as { id: string; tokenId: string };

    const ws = await repo.getWorkspace(id);
    if (!ws) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const meta = await repo.revokeToken(id, tokenId);
      return ok({ meta });
    } catch (error) {
      reply.code(404);
      return fail("token_not_found", (error as Error).message);
    }
  });

  server.post("/admin/workspaces/:id/exports/:exportId/token", async (request, reply) => {
    const { id, exportId } = request.params as { id: string; exportId: string };
    const body = (request.body as { label?: string } | null) ?? {};

    const workspace = await repo.getWorkspace(id);
    if (!workspace) {
      reply.code(404);
      return fail("workspace_not_found", `Workspace "${id}" not found`);
    }

    try {
      const result = await repo.createExportToken(id, exportId, {
        label: body.label,
      });
      return ok({
        token: result.token,
        meta: result.meta,
      });
    } catch (error) {
      reply.code(404);
      return fail("export_token_create_failed", (error as Error).message);
    }
  });
}
