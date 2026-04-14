import type { LoadWorkspaceConfigOptions } from "./loadWorkspaceConfig";

export const AGENT_USAGE = `Usage:
  mcp-hub --base-url <url> --workspace <id> [--token <token>] [--token-env <ENV_NAME>] [--cache-dir <path>]
  mcp-hub --config-url <url> --workspace <id> [--token <token>] [--token-env <ENV_NAME>] [--cache-dir <path>]

Options:
  --base-url, --config-base-url  控制面基础地址，例如 http://127.0.0.1:3100
  --config-url                   完整配置地址，优先级高于基础地址模式
  --workspace                    工作区 ID，同时作为本地缓存键
  --token                        直接传入 Bearer Token
  --token-env                    从指定环境变量读取 Bearer Token
  --cache-dir                    自定义缓存目录
  --help                         显示帮助
`;

type ParseAgentCliResult =
  | {
      ok: true;
      options: LoadWorkspaceConfigOptions;
    }
  | {
      ok: false;
      exitCode: number;
      message: string;
    };

export function parseAgentCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): ParseAgentCliResult {
  if (hasFlag(argv, "--help")) {
    return { ok: false, exitCode: 0, message: AGENT_USAGE };
  }

  const workspaceId = readFirstNonEmpty(
    getArgValue(argv, "--workspace"),
    env.MCP_AGENT_WORKSPACE,
  );
  const configUrl = readFirstNonEmpty(
    getArgValue(argv, "--config-url"),
    env.MCP_AGENT_CONFIG_URL,
  );
  const configBaseUrl = readFirstNonEmpty(
    getArgValue(argv, "--base-url"),
    getArgValue(argv, "--config-base-url"),
    env.MCP_AGENT_BASE_URL,
    env.MCP_AGENT_CONFIG_BASE_URL,
  );
  const tokenEnvName = readFirstNonEmpty(
    getArgValue(argv, "--token-env"),
    env.MCP_AGENT_TOKEN_ENV,
  );
  const token = readFirstNonEmpty(
    getArgValue(argv, "--token"),
    env.MCP_AGENT_TOKEN,
    tokenEnvName ? env[tokenEnvName] : undefined,
  );
  const cacheDir = readFirstNonEmpty(
    getArgValue(argv, "--cache-dir"),
    env.MCP_AGENT_CACHE_DIR,
  );

  if (!workspaceId) {
    return {
      ok: false,
      exitCode: 2,
      message: `${AGENT_USAGE}\n缺少必要参数：--workspace\n`,
    };
  }

  if (configUrl && configBaseUrl) {
    return {
      ok: false,
      exitCode: 2,
      message: `${AGENT_USAGE}\n--config-url 与 --base-url 不能同时使用\n`,
    };
  }

  if (!configUrl && !configBaseUrl) {
    return {
      ok: false,
      exitCode: 2,
      message: `${AGENT_USAGE}\n必须提供 --config-url 或 --base-url\n`,
    };
  }

  return {
    ok: true,
    options: {
      workspaceId,
      configUrl,
      configBaseUrl,
      token,
      cacheDir,
    },
  };
}

function getArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function readFirstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
