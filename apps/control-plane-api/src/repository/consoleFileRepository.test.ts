import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createConsoleFileRepository } from "./consoleFileRepository";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDataDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "console-file-repo-"));
  tempDirs.push(dir);
  return dir;
}

describe("createConsoleFileRepository", () => {
  it("ida-pro-mcp 空 discovery 会回退到内置 seed", async () => {
    const dataDir = await createTempDataDir();
    const repo = createConsoleFileRepository({ dataDir });

    const discovery = await repo.getDiscovery("ida-pro-mcp");

    expect(discovery?.status).toBe("error");
    expect(discovery?.error).toBe("fetch failed");
    expect(discovery?.tools.length).toBeGreaterThan(0);
    expect(discovery?.resources.length).toBeGreaterThan(0);
  });

  it("已有非空 discovery 时保留本地快照", async () => {
    const dataDir = await createTempDataDir();
    const discoveriesDir = path.join(dataDir, "console", "discoveries");
    await mkdir(discoveriesDir, { recursive: true });
    await writeFile(
      path.join(discoveriesDir, "ida-pro-mcp.json"),
      JSON.stringify({
        sourceId: "ida-pro-mcp",
        generatedAt: "2026-04-13T01:23:45.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "custom_tool", description: "custom" }],
        resources: [],
        prompts: [],
      }),
      "utf8",
    );

    const repo = createConsoleFileRepository({ dataDir });
    const discovery = await repo.getDiscovery("ida-pro-mcp");

    expect(discovery?.generatedAt).toBe("2026-04-13T01:23:45.000Z");
    expect(discovery?.tools).toEqual([{ name: "custom_tool", description: "custom" }]);
  });

  it("createSource 支持写入离线快照", async () => {
    const dataDir = await createTempDataDir();
    const repo = createConsoleFileRepository({ dataDir });

    await repo.createSource({
      id: "snapshot-source",
      name: "Snapshot Source",
      kind: "remote-http",
      config: {
        endpoint: "https://example.com/mcp",
      },
      seedDiscovery: {
        generatedAt: "2026-04-13T03:21:00.000Z",
        status: "ready",
        error: null,
        tools: [{ name: "seed_tool", description: "from seed" }],
        resources: [{ uri: "seed://resource", name: "Seed Resource" }],
        prompts: [],
      },
    });

    const source = await repo.getSource("snapshot-source");
    const discovery = await repo.getDiscovery("snapshot-source");

    expect(source?.seedDiscovery?.generatedAt).toBe("2026-04-13T03:21:00.000Z");
    expect(source?.status).toBe("ready");
    expect(discovery?.tools).toEqual([{ name: "seed_tool", description: "from seed" }]);
    expect(discovery?.resources).toEqual([{ uri: "seed://resource", name: "Seed Resource" }]);
  });
});
