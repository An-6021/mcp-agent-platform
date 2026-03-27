export function formatWorkspaceStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "启用中";
    case "archived":
      return "已归档";
    default:
      return status;
  }
}

export function formatUpstreamKindLabel(kind: string): string {
  switch (kind) {
    case "direct-http":
      return "远程 HTTP";
    case "local-stdio":
      return "命令启动";
    default:
      return kind;
  }
}
