import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const nodeExecPath = process.execPath;
const localApiBaseUrl = process.env.MCP_CONTROL_PLANE_API_BASE_URL ?? "http://127.0.0.1:3100";
const webPort = Number(process.env.MCP_CONTROL_PLANE_WEB_PORT ?? "5173");

export default defineConfig({
  plugins: [react()],
  define: {
    __MCP_AGENT_LOCAL_REPO_ROOT__: JSON.stringify(repoRoot),
    __MCP_AGENT_LOCAL_NODE_EXECUTABLE__: JSON.stringify(nodeExecPath),
  },
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: false,
    proxy: {
      "/admin": localApiBaseUrl,
      "/v1": localApiBaseUrl,
      "/health": localApiBaseUrl,
    },
  },
});
