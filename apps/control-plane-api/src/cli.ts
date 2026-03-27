import path from "node:path";
import { fileURLToPath } from "node:url";
import { createControlPlaneServer } from "./server";
import { createFileRepository } from "./repository/fileRepository";
import { registerAdminRoutes } from "./adminRoutes";

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function parseWorkspaceTokens(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, string>;
}

async function main() {
  const port = Number(getArgValue("--port") ?? process.env.PORT ?? "3100");
  const host = getArgValue("--host") ?? process.env.HOST ?? "127.0.0.1";
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const dataDir =
    getArgValue("--data-dir") ??
    process.env.MCP_CONTROL_PLANE_DATA_DIR ??
    path.resolve(currentDir, "../data");
  const legacyTokens = parseWorkspaceTokens(process.env.MCP_CONTROL_PLANE_TOKENS);

  const repo = createFileRepository({ dataDir, legacyTokens });

  const server = createControlPlaneServer({ repo });

  // Register CORS for dev
  await server.register(import("@fastify/cors"), { origin: true });

  // Register admin routes
  registerAdminRoutes(server, { repo });

  // Serve static files in production
  const webDistDir = path.resolve(currentDir, "../../control-plane-web/dist");
  try {
    const { default: fastifyStatic } = await import("@fastify/static");
    await server.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/",
      wildcard: false,
      decorateReply: false,
    });
    // SPA fallback: serve index.html for non-API routes
    server.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith("/v1/") ||
        request.url.startsWith("/admin/") ||
        request.url.startsWith("/health")
      ) {
        reply.code(404);
        return { error: "not_found" };
      }
      return reply.sendFile("index.html");
    });
  } catch {
    // @fastify/static not available or web dist not built — skip
  }

  await server.listen({ port, host });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
