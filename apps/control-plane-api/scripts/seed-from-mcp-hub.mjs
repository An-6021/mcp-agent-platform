#!/usr/bin/env node
/**
 * 从本机 MCP-hub 的 config.json 读取 servers 配置，
 * 转换为 control-plane-api 的 console source 文件。
 *
 * 用法: node scripts/seed-from-mcp-hub.mjs
 */

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "../data");
const consoleDir = join(dataDir, "console");
const sourcesDir = join(consoleDir, "sources");

// ── 读取 MCP-hub 配置 ───────────────────────────────────────────────
const mcpHubConfigPath = join(
  homedir(),
  "Library/Application Support/com.mcp.hub/config.json",
);

if (!existsSync(mcpHubConfigPath)) {
  console.error(`❌ 未找到 MCP-hub 配置: ${mcpHubConfigPath}`);
  process.exit(1);
}

const mcpHubConfig = JSON.parse(readFileSync(mcpHubConfigPath, "utf8"));
const servers = mcpHubConfig.servers ?? {};

// ── 清除旧的 console 数据 ───────────────────────────────────────────
if (existsSync(consoleDir)) {
  rmSync(consoleDir, { recursive: true, force: true });
  console.log("🧹 已清除旧 console 数据");
}

mkdirSync(sourcesDir, { recursive: true });

// ── 转换并写入 ──────────────────────────────────────────────────────
const now = new Date().toISOString();
let count = 0;

for (const [id, server] of Object.entries(servers)) {
  const source = buildSource(id, server);
  if (!source) {
    console.warn(`⚠️  跳过未知 transport 类型: ${id} (${server.transport})`);
    continue;
  }

  const filePath = join(sourcesDir, `${id}.json`);
  writeFileSync(filePath, JSON.stringify(source, null, 2) + "\n", "utf8");
  count++;
  console.log(`✅ ${id} → ${source.kind} (${source.enabled ? "启用" : "停用"})`);
}

console.log(`\n✨ 共导入 ${count} 个 source 到 ${sourcesDir}`);

// ── 转换函数 ────────────────────────────────────────────────────────

function buildSource(id, server) {
  const base = {
    id,
    name: server.label || id,
    enabled: server.enabled ?? true,
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastRefreshedAt: null,
    status: server.enabled ? "unknown" : "disabled",
    lastError: null,
  };

  if (server.transport === "http") {
    return {
      ...base,
      kind: "remote-http",
      config: {
        endpoint: server.url,
        headers: server.headers ?? {},
        timeoutMs: server.timeoutMs ?? 30000,
      },
    };
  }

  if (server.transport === "stdio") {
    return {
      ...base,
      kind: "local-stdio",
      config: {
        command: server.command,
        cwd: server.cwd ?? null,
        env: server.env ?? {},
        timeoutMs: server.timeoutMs ?? 30000,
      },
    };
  }

  return null;
}
