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

type ExportClientConfigOptions = {
  workspaceId: string;
  exportId: string;
  serverName: string;
  token?: string;
};

const LOCAL_WEB_PORT = "5173";
const LOCAL_API_BASE_URL = import.meta.env.VITE_LOCAL_API_BASE_URL ?? "http://127.0.0.1:3100";
const PUBLIC_CONTROL_PLANE_BASE_URL = __MCP_AGENT_PUBLIC_CONTROL_PLANE_BASE_URL__.trim();
const CLIENT_SHELL_COMMAND = "/bin/sh";

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

export function getExportMcpUrl(workspaceId: string, exportId: string, origin = window.location.origin): string {
  return `${getControlPlaneBaseUrl(origin)}/v1/workspaces/${workspaceId}/exports/${exportId}/mcp`;
}

export function getExportConfigUrl(workspaceId: string, exportId: string, origin = window.location.origin): string {
  return `${getControlPlaneBaseUrl(origin)}/v1/workspaces/${workspaceId}/exports/${exportId}/config`;
}

const PUBLIC_PACKAGE_NAME = "@sudau/mcp-hub";

function buildWorkspaceAgentArgs(workspaceId: string, token?: string): string[] {
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

function buildExportAgentArgs(options: ExportClientConfigOptions): string[] {
  const args = [
    "-y",
    PUBLIC_PACKAGE_NAME,
    "--config-url",
    getExportConfigUrl(options.workspaceId, options.exportId),
    "--workspace",
    options.serverName,
  ];

  if (options.token) {
    args.push("--token", options.token);
  }

  return args;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildShellWrappedAgentArgs(agentArgs: string[]): string[] {
  const command = ["npx", ...agentArgs].map(shellQuote).join(" ");
  const script = [
    'PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'if [ -d "$HOME/.nvm/versions/node" ]; then for dir in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$dir" ] && PATH="$dir:$PATH"; done; fi',
    `exec ${command}`,
  ].join("; ");

  return ["-lc", script];
}

export function buildAgentCommand(options: ClientConfigOptions): string {
  const serverName = options.workspaceId;
  return ["codex", "mcp", "add", serverName, "--", "npx", ...buildWorkspaceAgentArgs(options.workspaceId, options.token)].join(" ");
}

export function buildClientConfigSnippets(options: ClientConfigOptions): ClientConfigSnippet[] {
  const serverName = options.workspaceId;
  const shellWrappedArgs = buildShellWrappedAgentArgs(buildWorkspaceAgentArgs(options.workspaceId, options.token));

  return [
    {
      id: "toml",
      title: "TOML",
      format: "toml",
      fileHint: "~/.codex/config.toml",
      content: [
        `[mcp_servers.${JSON.stringify(serverName)}]`,
        `command = ${JSON.stringify(CLIENT_SHELL_COMMAND)}`,
        `args = ${JSON.stringify(shellWrappedArgs)}`,
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
              command: CLIENT_SHELL_COMMAND,
              args: shellWrappedArgs,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}

export function buildExportClientConfigSnippets(options: ExportClientConfigOptions): ClientConfigSnippet[] {
  const shellWrappedArgs = buildShellWrappedAgentArgs(buildExportAgentArgs(options));

  return [
    {
      id: "toml",
      title: "TOML",
      format: "toml",
      fileHint: "~/.codex/config.toml",
      content: [
        `[mcp_servers.${JSON.stringify(options.serverName)}]`,
        `command = ${JSON.stringify(CLIENT_SHELL_COMMAND)}`,
        `args = ${JSON.stringify(shellWrappedArgs)}`,
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
            [options.serverName]: {
              command: CLIENT_SHELL_COMMAND,
              args: shellWrappedArgs,
            },
          },
        },
        null,
        2,
      ),
    },
  ];
}
