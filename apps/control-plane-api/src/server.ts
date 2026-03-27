import Fastify, { type FastifyInstance } from "fastify";
import type { WorkspaceRepository } from "@mcp-agent-platform/shared";

export type ControlPlaneServerOptions = {
  repo: WorkspaceRepository;
  /** Serve static files from this directory (production web panel) */
  staticDir?: string;
};

export function createControlPlaneServer(options: ControlPlaneServerOptions): FastifyInstance {
  const { repo } = options;

  const server = Fastify({
    logger: true,
  });

  server.get("/health", async () => ({
    ok: true,
  }));

  server.get("/v1/workspaces/:workspaceId/config", async (request, reply) => {
    const workspaceId = String((request.params as { workspaceId: string }).workspaceId);

    // Token verification
    const authHeader = request.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : undefined;

    const tokens = await repo.listTokens(workspaceId);
    const hasActiveToken = tokens.some((token) => !token.revokedAt);

    if (hasActiveToken) {
      // Token is configured → require valid bearer
      if (!bearerToken || !(await repo.verifyToken(workspaceId, bearerToken))) {
        reply.code(401);
        return { error: "unauthorized" };
      }
    } else if (bearerToken) {
      // A token was sent but none is configured - still verify (handles legacy env tokens)
      if (!(await repo.verifyToken(workspaceId, bearerToken))) {
        reply.code(401);
        return { error: "unauthorized" };
      }
    }

    try {
      const config = await repo.getPublishedConfig(workspaceId);
      if (!config) {
        reply.code(404);
        return { error: "workspace_not_found" };
      }
      return config;
    } catch (error) {
      request.log.error({ error, workspaceId }, "Failed to read workspace config");
      reply.code(500);
      return { error: "internal_error" };
    }
  });

  return server;
}
