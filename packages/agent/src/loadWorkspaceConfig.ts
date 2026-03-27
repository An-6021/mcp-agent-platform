import {
  parseWorkspaceConfig,
  type WorkspaceConfig,
} from "@mcp-agent-platform/shared";
import {
  readCachedWorkspaceConfig,
  resolveCachePaths,
  writeCachedWorkspaceConfig,
} from "./cache";

export type LoadWorkspaceConfigOptions = {
  configBaseUrl?: string;
  configUrl?: string;
  workspaceId: string;
  token?: string;
  cacheDir?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type LoadedWorkspaceConfig = {
  config: WorkspaceConfig;
  source: "remote" | "cache";
  cacheFile: string;
};

export async function loadWorkspaceConfig(options: LoadWorkspaceConfigOptions): Promise<LoadedWorkspaceConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const cachePaths = resolveCachePaths(options.workspaceId, options.cacheDir);
  const cacheFile = cachePaths.cacheFile;
  const configUrl = resolveConfigUrl(options);

  try {
    const response = await fetchImpl(configUrl, {
      headers: options.token
        ? {
            Authorization: `Bearer ${options.token}`,
          }
        : undefined,
    });

    if (!response.ok) {
      throw new Error(`控制面返回 ${response.status} ${response.statusText}`);
    }

    const config = parseWorkspaceConfig(await response.json());
    await writeCachedWorkspaceConfig(cacheFile, config, now());
    return {
      config,
      source: "remote",
      cacheFile,
    };
  } catch (error) {
    const cached = await readCachedWorkspaceConfig(cacheFile);
    if (cached) {
      return {
        config: cached.config,
        source: "cache",
        cacheFile,
      };
    }
    throw error;
  }
}

export function buildConfigUrl(configBaseUrl: string, workspaceId: string): string {
  const url = new URL(configBaseUrl);
  const pathname = url.pathname.endsWith("/") ? `${url.pathname}v1/workspaces/${workspaceId}/config` : `${url.pathname}/v1/workspaces/${workspaceId}/config`;
  url.pathname = pathname.replace(/\/{2,}/g, "/");
  return url.toString();
}

export function resolveConfigUrl(options: Pick<LoadWorkspaceConfigOptions, "configUrl" | "configBaseUrl" | "workspaceId">): string {
  if (options.configUrl) {
    return new URL(options.configUrl).toString();
  }
  if (options.configBaseUrl) {
    return buildConfigUrl(options.configBaseUrl, options.workspaceId);
  }
  throw new Error("缺少配置来源：必须提供 configUrl 或 configBaseUrl");
}
