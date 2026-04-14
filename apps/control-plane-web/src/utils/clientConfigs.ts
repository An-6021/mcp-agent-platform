export type ClientConfigSnippet = {
  id: "toml" | "json";
  title: string;
  format: "toml" | "json";
  fileHint: string;
  content: string;
};

type ClientConfigOptions = {
  workspaceId: string;
  token?: string;
};

const LOCAL_WEB_PORT = "5173";
const LOCAL_API_BASE_URL = import.meta.env.VITE_LOCAL_API_BASE_URL ?? "http://127.0.0.1:3100";
const PUBLIC_CONTROL_PLANE_BASE_URL = __MCP_AGENT_PUBLIC_CONTROL_PLANE_BASE_URL__.trim();

export function getControlPlaneBaseUrl(origin = window.location.origin): string {
  if (PUBLIC_CONTROL_PLANE_BASE_URL) {
    return PUBLIC_CONTROL_PLANE_BASE_URL.replace(/\/+$/g, "");
  }

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

export function getWorkspaceMcpUrl(workspaceId: string, origin = window.location.origin): string {
  return `${getControlPlaneBaseUrl(origin)}/v1/workspaces/${workspaceId}/mcp`;
}

export function getWorkspaceConfigUrl(workspaceId: string, origin = window.location.origin): string {
  return `${getControlPlaneBaseUrl(origin)}/v1/workspaces/${workspaceId}/config`;
}

const PUBLIC_PACKAGE_NAME = "mcp-hub";

function buildAgentArgs(workspaceId: string, token?: string): string[] {
  const args = [
    "-y",
    PUBLIC_PACKAGE_NAME,
    "--base-url",
    getControlPlaneBaseUrl(),
    "--workspace",
    workspaceId,
  ];

  if (token) {
    args.push("--token", token);
  }

  return args;
}

export function buildAgentCommand(options: ClientConfigOptions): string {
  const serverName = options.workspaceId;
  return ["codex", "mcp", "add", serverName, "--", "npx", ...buildAgentArgs(options.workspaceId, options.token)].join(" ");
}

export function buildClientConfigSnippets(options: ClientConfigOptions): ClientConfigSnippet[] {
  const serverName = options.workspaceId;
  const mcpUrl = getWorkspaceMcpUrl(options.workspaceId);
  const agentArgs = buildAgentArgs(options.workspaceId, options.token);

  return [
    {
      id: "toml",
      title: "TOML",
      format: "toml",
      fileHint: "~/.codex/config.toml",
      content: [
        `[mcp_servers.${JSON.stringify(serverName)}]`,
        `command = "npx"`,
        `args = ${JSON.stringify(agentArgs)}`,
      ].join("\n"),
    },
    {
      id: "json",
      title: "JSON",
      format: "json",
      fileHint: ".mcp.json / .cursor/mcp.json",
      content: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              type: "http",
              url: mcpUrl,
              ...(options.token
                ? {
                    headers: {
                      Authorization: `Bearer ${options.token}`,
                    },
                  }
                : {}),
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}
