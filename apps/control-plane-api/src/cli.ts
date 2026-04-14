import path from "node:path";
import { fileURLToPath } from "node:url";
import { createControlPlaneServer } from "./server";
import { createConsoleFileRepository } from "./repository/consoleFileRepository";
import { createFileRepository } from "./repository/fileRepository";
import { registerAdminRoutes } from "./adminRoutes";
import { registerConsoleRoutes } from "./consoleRoutes";
import { HostedProcessManager } from "./hostedProcessManager";

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
  const consoleRepo = createConsoleFileRepository({ dataDir });

  const server = createControlPlaneServer({ repo, consoleRepo });

  await server.register(import("@fastify/cors"), { origin: true });

  const processManager = new HostedProcessManager(consoleRepo);

  registerAdminRoutes(server, { repo });
  registerConsoleRoutes(server, { repo: consoleRepo, processManager });

  const webDistDir = path.resolve(currentDir, "../../control-plane-web/dist");
  try {
    const { default: fastifyStatic } = await import("@fastify/static");
    await server.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/",
      wildcard: false,
    });
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
    // @fastify/static not available or web dist not built - skip
  }

  await server.listen({ port, host });

  // 启动后自动刷新所有已启用 source 的能力（后台执行，不阻塞启动）
  setImmediate(async () => {
    try {
      server.log.info("Auto-refreshing all sources on startup...");
      const res = await server.inject({ method: "POST", url: "/admin/sources/refresh-all" });
      const body = JSON.parse(res.body) as { data: { total: number; succeeded: number; failed: number } };
      server.log.info(
        `Auto-refresh complete: ${body.data.succeeded}/${body.data.total} succeeded, ${body.data.failed} failed`,
      );

      server.log.info("Starting hosted sources with autoStart enabled...");
      const hosted = await processManager.startAutoStartSources();
      server.log.info(
        `Hosted auto-start complete: ${hosted.started}/${hosted.total} started, ${hosted.failed} failed`,
      );
    } catch (error) {
      server.log.error({ error }, "Auto-refresh failed");
    }
  });

  // 优雅停止：关闭所有托管进程
  const shutdown = async () => {
    server.log.info("Shutting down hosted processes...");
    await processManager.shutdownAll();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
