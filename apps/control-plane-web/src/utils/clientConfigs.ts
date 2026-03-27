export type ClientConfigSnippet = {
  id: "codex" | "claude-code" | "cursor" | "opencode";
  title: string;
  format: "toml" | "json";
  fileHint: string;
  description: string;
  content: string;
};

type ClientConfigOptions = {
  workspaceId: string;
  hasToken: boolean;
  tokenValue?: string | null;
};

const LOCAL_WEB_PORT = "5173";
const LOCAL_API_BASE_URL = import.meta.env.VITE_LOCAL_API_BASE_URL ?? "http://127.0.0.1:3100";

export function getControlPlaneBaseUrl(origin = window.location.origin): string {
  try {
    const current = new URL(origin);
    const isLocalHost = current.hostname === "127.0.0.1" || current.hostname === "localhost";
    if (import.meta.env.DEV && isLocalHost) {
      return LOCAL_API_BASE_URL;
    }
    if (isLocalHost && current.port === LOCAL_WEB_PORT) {
      return LOCAL_API_BASE_URL;
    }
    return current.origin;
  } catch {
    return LOCAL_API_BASE_URL;
  }
}

export function getWorkspaceConfigUrl(workspaceId: string, origin = window.location.origin): string {
  return `${getControlPlaneBaseUrl(origin)}/v1/workspaces/${workspaceId}/config`;
}

export function buildAgentCommand(options: ClientConfigOptions): string {
  return buildAgentArgs(options).join(" ");
}

export function buildClientConfigSnippets(options: ClientConfigOptions): ClientConfigSnippet[] {
  const { workspaceId, hasToken } = options;
  const serverName = `mcp-agent-${workspaceId}`;
  const args = buildAgentArgs(options);
  const commandSpec = buildCommandSpec(args);

  return [
    {
      id: "codex",
      title: "Codex",
      format: "toml",
      fileHint: "~/.codex/config.toml",
      description: "直接追加一个 MCP server 条目即可。",
      content: buildCodexToml(serverName, args, hasToken, Boolean(options.tokenValue)),
    },
    {
      id: "claude-code",
      title: "Claude Code",
      format: "json",
      fileHint: "Claude Code 的 MCP JSON 配置",
      description: "把这段合并到 `mcpServers` 配置中。",
      content: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              type: "stdio",
              command: commandSpec.command,
              args: commandSpec.args,
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "cursor",
      title: "Cursor",
      format: "json",
      fileHint: ".cursor/mcp.json 或 ~/.cursor/mcp.json",
      description: "可作为项目级或全局 MCP 配置使用。",
      content: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              type: "stdio",
              command: commandSpec.command,
              args: commandSpec.args,
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "opencode",
      title: "OpenCode",
      format: "json",
      fileHint: "opencode.json 或 ~/.config/opencode/opencode.json",
      description: "放到 `mcp` 配置下即可加载本地 agent。",
      content: JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          mcp: {
            [serverName]: {
              type: "local",
              command: args,
              enabled: true,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

function buildAgentArgs({ workspaceId, hasToken, tokenValue }: ClientConfigOptions): string[] {
  const args = [
    "npx",
    "-y",
    "mcp-agent-platform",
    "--config-url",
    getWorkspaceConfigUrl(workspaceId),
    "--workspace",
    workspaceId,
  ];

  if (hasToken) {
    if (tokenValue) {
      args.push("--token", tokenValue);
    } else {
      args.push("--token-env", "MCP_AGENT_TOKEN");
    }
  }

  return args;
}

function buildCodexToml(serverName: string, args: string[], hasToken: boolean, hasInlineToken: boolean): string {
  const lines = [
    `[mcp_servers.${JSON.stringify(serverName)}]`,
    `command = ${JSON.stringify(args[0])}`,
    `args = ${formatTomlArray(args.slice(1))}`,
  ];

  if (hasToken && !hasInlineToken) {
    lines.push(`env_vars = ${formatTomlArray(["MCP_AGENT_TOKEN"])}`);
  }

  return lines.join("\n");
}

function buildCommandSpec(args: string[]): { command: string; args: string[] } {
  const [command, ...commandArgs] = args;

  if (!command) {
    throw new Error("agent 启动命令不能为空");
  }

  return {
    command,
    args: commandArgs,
  };
}

function formatTomlArray(values: string[]): string {
  if (values.length === 0) {
    return "[]";
  }

  const items = values.map((value, index) => {
    const suffix = index === values.length - 1 ? "" : ",";
    return `  ${JSON.stringify(value)}${suffix}`;
  });

  return `[\n${items.join("\n")}\n]`;
}
