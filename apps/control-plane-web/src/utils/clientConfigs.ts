export type ClientConfigFormat = "toml" | "json";
export type ClientConfigVariantId = "npx" | "shell";

export type ClientConfigSnippet = {
  id: ClientConfigFormat;
  variantId: ClientConfigVariantId;
  title: string;
  variantTitle: string;
  variantDescription: string;
  recommended?: boolean;
  format: ClientConfigFormat;
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
const VITE_ENV = import.meta.env ?? {};
const LOCAL_API_BASE_URL = VITE_ENV.VITE_LOCAL_API_BASE_URL ?? "http://127.0.0.1:3100";
const PUBLIC_CONTROL_PLANE_BASE_URL = (typeof __MCP_AGENT_PUBLIC_CONTROL_PLANE_BASE_URL__ === "string"
  ? __MCP_AGENT_PUBLIC_CONTROL_PLANE_BASE_URL__
  : "").trim();
const CLIENT_NPX_COMMAND = "npx";
const CLIENT_SHELL_COMMAND = "/bin/sh";
export const DEFAULT_CLIENT_CONFIG_VARIANT: ClientConfigVariantId = "npx";

const CLIENT_CONFIG_VARIANT_META: Record<
  ClientConfigVariantId,
  Pick<ClientConfigSnippet, "variantTitle" | "variantDescription" | "recommended">
> = {
  npx: {
    variantTitle: "简洁 npx",
    variantDescription: "短配置，推荐优先用",
    recommended: true,
  },
  shell: {
    variantTitle: "兼容 shell",
    variantDescription: "客户端找不到 Node 时用",
  },
};

export function getControlPlaneBaseUrl(origin = window.location.origin): string {
  if (PUBLIC_CONTROL_PLANE_BASE_URL) {
    return PUBLIC_CONTROL_PLANE_BASE_URL.replace(/\/+$/g, "");
  }

  try {
    const current = new URL(origin);
    const isLocalHost = current.hostname === "127.0.0.1" || current.hostname === "localhost";
    if (VITE_ENV.DEV && isLocalHost) {
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

const PUBLIC_PACKAGE_NAME = "@a1ua/mcp-hub";

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
  const command = [CLIENT_NPX_COMMAND, ...agentArgs].map(shellQuote).join(" ");
  const script = [
    'PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"',
    'if [ -d "$HOME/.nvm/versions/node" ]; then for dir in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$dir" ] && PATH="$dir:$PATH"; done; fi',
    'cd "$HOME"',
    `exec ${command}`,
  ].join("; ");

  return ["-lc", script];
}

function buildTomlSnippet(
  serverName: string,
  variantId: ClientConfigVariantId,
  command: string,
  args: string[],
): ClientConfigSnippet {
  return {
    id: "toml",
    variantId,
    title: "TOML",
    ...CLIENT_CONFIG_VARIANT_META[variantId],
    format: "toml",
    fileHint: "~/.codex/config.toml",
    content: [
      `[mcp_servers.${JSON.stringify(serverName)}]`,
      `type = "stdio"`,
      `command = ${JSON.stringify(command)}`,
      `args = ${JSON.stringify(args)}`,
    ].join("\n"),
  };
}

function buildJsonSnippet(
  serverName: string,
  variantId: ClientConfigVariantId,
  command: string,
  args: string[],
): ClientConfigSnippet {
  return {
    id: "json",
    variantId,
    title: "JSON",
    ...CLIENT_CONFIG_VARIANT_META[variantId],
    format: "json",
    fileHint: ".mcp.json / .cursor/mcp.json",
    content: JSON.stringify(
      {
        mcpServers: {
          [serverName]: {
            command,
            args,
          },
        },
      },
      null,
      2,
    ),
  };
}

function buildClientConfigSnippetSet(serverName: string, npxArgs: string[]): ClientConfigSnippet[] {
  const shellWrappedArgs = buildShellWrappedAgentArgs(npxArgs);

  return [
    buildTomlSnippet(serverName, "npx", CLIENT_NPX_COMMAND, npxArgs),
    buildTomlSnippet(serverName, "shell", CLIENT_SHELL_COMMAND, shellWrappedArgs),
    buildJsonSnippet(serverName, "npx", CLIENT_NPX_COMMAND, npxArgs),
    buildJsonSnippet(serverName, "shell", CLIENT_SHELL_COMMAND, shellWrappedArgs),
  ];
}

export function findClientConfigSnippet(
  snippets: ClientConfigSnippet[],
  format: ClientConfigFormat,
  variantId: ClientConfigVariantId = DEFAULT_CLIENT_CONFIG_VARIANT,
): ClientConfigSnippet | undefined {
  return snippets.find((item) => item.id === format && item.variantId === variantId);
}

export function getClientConfigVariants(
  snippets: ClientConfigSnippet[],
  format: ClientConfigFormat,
): ClientConfigSnippet[] {
  return (Object.keys(CLIENT_CONFIG_VARIANT_META) as ClientConfigVariantId[])
    .map((variantId) => findClientConfigSnippet(snippets, format, variantId))
    .filter((item): item is ClientConfigSnippet => Boolean(item));
}

export function buildAgentCommand(options: ClientConfigOptions): string {
  const serverName = options.workspaceId;
  return ["codex", "mcp", "add", serverName, "--", CLIENT_NPX_COMMAND, ...buildWorkspaceAgentArgs(options.workspaceId, options.token)].join(" ");
}

export function buildClientConfigSnippets(options: ClientConfigOptions): ClientConfigSnippet[] {
  const serverName = options.workspaceId;
  return buildClientConfigSnippetSet(serverName, buildWorkspaceAgentArgs(options.workspaceId, options.token));
}

export function buildExportClientConfigSnippets(options: ExportClientConfigOptions): ClientConfigSnippet[] {
  return buildClientConfigSnippetSet(options.serverName, buildExportAgentArgs(options));
}
