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
    case "hosted-npm":
      return "npm 托管";
    case "hosted-single-file":
      return "单文件托管";
    default:
      return kind;
  }
}

// ── 新三层模型标签 ──────────────────────────────────────────────────

export function formatSourceKindLabel(kind: string): string {
  switch (kind) {
    case "remote-http":
      return "远程 HTTP";
    case "local-stdio":
      return "本地命令";
    case "hosted-npm":
      return "npm 托管";
    case "hosted-single-file":
      return "单文件托管";
    default:
      return kind;
  }
}

export function formatSourceStatusLabel(status: string): string {
  switch (status) {
    case "unknown":
      return "未探测";
    case "ready":
      return "就绪";
    case "error":
      return "异常";
    case "offline":
      return "离线";
    case "disabled":
      return "已停用";
    default:
      return status;
  }
}

export function formatHostedRuntimeStatusLabel(status: string): string {
  switch (status) {
    case "stopped":
      return "已停止";
    case "starting":
      return "启动中";
    case "running":
      return "运行中";
    case "error":
      return "异常";
    default:
      return status;
  }
}

export function formatToolStrategyLabel(strategy: string): string {
  switch (strategy) {
    case "default":
      return "默认";
    case "renamed":
      return "已重命名";
    case "hidden":
      return "已隐藏";
    default:
      return strategy;
  }
}

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - Date.parse(iso);
  if (diff < 0) return "刚刚";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
