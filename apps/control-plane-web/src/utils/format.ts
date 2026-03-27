export function formatDateTime(value: string | null | undefined, fallback = "暂无"): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString();
}
