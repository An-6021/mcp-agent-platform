import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseCachedWorkspaceConfig,
  type CachedWorkspaceConfig,
  type WorkspaceConfig,
} from "@mcp-agent-platform/shared";

export type CachePaths = {
  baseDir: string;
  cacheFile: string;
};

export function resolveCachePaths(workspaceId: string, cacheDir?: string): CachePaths {
  const baseDir = cacheDir ?? path.join(os.homedir(), ".mcp-hub");
  return {
    baseDir,
    cacheFile: path.join(baseDir, `${workspaceId}.json`),
  };
}

export async function readCachedWorkspaceConfig(cacheFile: string): Promise<CachedWorkspaceConfig | null> {
  try {
    const raw = await readFile(cacheFile, "utf8");
    return parseCachedWorkspaceConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeCachedWorkspaceConfig(
  cacheFile: string,
  config: WorkspaceConfig,
  savedAtMs: number,
): Promise<void> {
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const payload: CachedWorkspaceConfig = {
    savedAtMs,
    config,
  };
  await writeFile(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
