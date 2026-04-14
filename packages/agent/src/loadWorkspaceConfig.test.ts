import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadWorkspaceConfig, resolveConfigUrl } from "./loadWorkspaceConfig";

const sampleConfig = {
  schemaVersion: 1,
  workspaceId: "mcp-hub",
  displayName: "mcp-hub",
  generatedAt: "2026-03-17T00:00:00.000Z",
  cacheTtlSeconds: 300,
  upstreams: [
    {
      id: "docs",
      label: "Remote Docs",
      kind: "direct-http",
      url: "https://example.com/mcp",
      headers: {},
    },
  ],
};

describe("loadWorkspaceConfig", () => {
  it("优先从远程加载并写入缓存", async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "mcp-hub-"));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(sampleConfig), { status: 200 }));

    const result = await loadWorkspaceConfig({
      configBaseUrl: "http://127.0.0.1:3100",
      workspaceId: "mcp-hub",
      token: "mcp-hub-token",
      cacheDir,
      fetchImpl,
      now: () => 1_234_567,
    });

    expect(result.source).toBe("remote");
    expect(result.config.workspaceId).toBe("mcp-hub");

    const savedRaw = await readFile(path.join(cacheDir, "mcp-hub.json"), "utf8");
    expect(JSON.parse(savedRaw)).toMatchObject({
      savedAtMs: 1_234_567,
      config: sampleConfig,
    });
  });

  it("远程失败时回退到本地缓存", async () => {
    const cacheDir = await mkdtemp(path.join(os.tmpdir(), "mcp-hub-"));
    const cacheFile = path.join(cacheDir, "mcp-hub.json");
    await writeFile(
      cacheFile,
      `${JSON.stringify({ savedAtMs: 1_234_567, config: sampleConfig }, null, 2)}\n`,
      "utf8",
    );

    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await loadWorkspaceConfig({
      configBaseUrl: "http://127.0.0.1:3100",
      workspaceId: "mcp-hub",
      cacheDir,
      fetchImpl,
    });

    expect(result.source).toBe("cache");
    expect(result.config.workspaceId).toBe("mcp-hub");
  });

  it("支持直接使用完整 config-url", () => {
    const resolved = resolveConfigUrl({
      configUrl: "https://mcp.a1yu.com/v1/workspaces/mcp-hub/config",
      workspaceId: "mcp-hub",
    });

    expect(resolved).toBe("https://mcp.a1yu.com/v1/workspaces/mcp-hub/config");
  });
});
