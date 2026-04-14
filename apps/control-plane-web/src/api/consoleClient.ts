/**
 * 新三层模型（Sources / Tools / Hosted）的 API 客户端。
 * 对接 consoleRoutes 提供的 /admin/sources、/admin/tools、/admin/hosted 端点。
 */

const BASE = "";

type ApiResponse<T> = { data: T; error: null } | { data: null; error: { code: string; message: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init?.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${url}`, { ...init, headers });
  const json = (await res.json()) as ApiResponse<T>;
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

// ── Source 相关类型 ─────────────────────────────────────────────────

export type SourceKind = "remote-http" | "local-stdio" | "hosted-npm" | "hosted-single-file";

export type SourceStatus = "unknown" | "ready" | "error" | "offline" | "disabled";

export type SourceListItem = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  status: SourceStatus;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  isHosted: boolean;
  lastRefreshedAt: string | null;
  lastError: string | null;
};

export type SystemSummary = {
  sourceCount: number;
  enabledSourceCount: number;
  exposedToolCount: number;
  hiddenToolCount: number;
  conflictToolCount: number;
  hostedRunningCount: number;
  hostedErrorCount: number;
};

export type SourceConfig =
  | { endpoint: string; headers?: Record<string, string>; timeoutMs?: number }
  | { command: string[]; cwd?: string | null; env?: Record<string, string>; timeoutMs?: number }
  | {
      packageName: string;
      packageVersion?: string;
      binName: string;
      args?: string[];
      cwd?: string | null;
      env?: Record<string, string>;
      timeoutMs?: number;
      autoStart?: boolean;
    }
  | {
      fileName: string;
      runtime?: "node" | "tsx" | "python" | "bash";
      source: string;
      args?: string[];
      cwd?: string | null;
      env?: Record<string, string>;
      timeoutMs?: number;
      autoStart?: boolean;
    };

export type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  status: SourceStatus;
  lastError: string | null;
  seedDiscovery?: ImportedSourceDiscovery | null;
  config: SourceConfig;
};

export type SourceDiscovery = {
  sourceId: string;
  generatedAt: string;
  status: "ready" | "error";
  error: string | null;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
};

export type ImportedSourceDiscovery = {
  sourceId?: string;
  generatedAt: string;
  status: "ready" | "error";
  error: string | null;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }>;
};

export type HostedRuntimeState = {
  sourceId: string;
  status: "stopped" | "starting" | "running" | "error";
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  restartCount: number;
  autoStart: boolean;
  lastExitCode: number | null;
  lastError: string | null;
};

export type CreateSourceInput = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled?: boolean;
  config: SourceConfig;
  seedDiscovery?: ImportedSourceDiscovery;
};

export type UpdateSourceInput = {
  name?: string;
  enabled?: boolean;
  config?: Partial<SourceConfig>;
  seedDiscovery?: ImportedSourceDiscovery;
};

// ── Tool 相关类型 ──────────────────────────────────────────────────

export type ToolConflictStatus = "none" | "name-conflict";

export type ToolListItem = {
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  originalName: string;
  exposedName: string;
  enabled: boolean;
  strategy: "default" | "renamed" | "hidden";
  description?: string;
  conflictStatus: ToolConflictStatus;
};

// ── Hosted 相关类型 ────────────────────────────────────────────────

export type HostedRuntimeStatus = "stopped" | "starting" | "running" | "error";

export type HostedListItem = {
  sourceId: string;
  name: string;
  kind: "hosted-npm" | "hosted-single-file";
  enabled: boolean;
  runtimeStatus: HostedRuntimeStatus;
  autoStart: boolean;
  startedAt: string | null;
  restartCount: number;
  lastError: string | null;
};

export type LogEntry = {
  id: string;
  sourceId: string;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
};

// ── API ────────────────────────────────────────────────────────────

export const consoleApi = {
  // ── Sources ──────────────────────────────────────────────────────

  listSources: () =>
    request<{ items: SourceListItem[]; summary: SystemSummary }>("/admin/sources"),

  getSource: (sourceId: string) =>
    request<{ source: Source; discovery: SourceDiscovery | null; hostedState: HostedRuntimeState | null }>(
      `/admin/sources/${sourceId}`,
    ),

  createSource: (input: CreateSourceInput) =>
    request<Source>("/admin/sources", { method: "POST", body: JSON.stringify(input) }),

  updateSource: (sourceId: string, input: UpdateSourceInput) =>
    request<Source>(`/admin/sources/${sourceId}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteSource: (sourceId: string) =>
    request<{ deleted: true }>(`/admin/sources/${sourceId}`, { method: "DELETE" }),

  toggleSource: (sourceId: string, enabled: boolean) =>
    request<Source>(`/admin/sources/${sourceId}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),

  refreshSource: (sourceId: string) =>
    request<{ source: Source; discovery: SourceDiscovery; exposureChanges: { created: number; updated: number } }>(
      `/admin/sources/${sourceId}/refresh`,
      { method: "POST" },
    ),

  getSourceSnapshot: (sourceId: string) =>
    request<SourceDiscovery>(`/admin/sources/${sourceId}/snapshot`, { method: "POST" }),

  refreshAllSources: () =>
    request<{
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{ sourceId: string; status: "ok" | "error"; toolCount: number; error?: string }>;
    }>("/admin/sources/refresh-all", { method: "POST" }),

  // ── Tools ────────────────────────────────────────────────────────

  listTools: (params?: { sourceId?: string; enabled?: string; conflictOnly?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.sourceId) search.set("sourceId", params.sourceId);
    if (params?.enabled) search.set("enabled", params.enabled);
    if (params?.conflictOnly) search.set("conflictOnly", params.conflictOnly);
    if (params?.q) search.set("q", params.q);
    const qs = search.toString();
    return request<{
      items: ToolListItem[];
      summary: { exposedToolCount: number; hiddenToolCount: number; conflictToolCount: number; sourceCount: number };
    }>(`/admin/tools${qs ? `?${qs}` : ""}`);
  },

  updateTool: (sourceId: string, toolName: string, input: { exposedName?: string; enabled?: boolean }) =>
    request<unknown>(`/admin/tools/${sourceId}/${encodeURIComponent(toolName)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  batchUpdateTools: (items: Array<{ sourceId: string; originalName: string; exposedName?: string; enabled?: boolean }>) =>
    request<{ updated: number }>("/admin/tools/batch", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  rebuildTools: () =>
    request<{ sourceCount: number; toolCount: number; createdExposureCount: number }>("/admin/tools/rebuild", {
      method: "POST",
    }),

  // ── Hosted ───────────────────────────────────────────────────────

  listHosted: () =>
    request<{
      items: HostedListItem[];
      summary: { total: number; running: number; stopped: number; error: number };
    }>("/admin/hosted"),

  startHosted: (sourceId: string) =>
    request<{ state: HostedRuntimeState }>(`/admin/hosted/${sourceId}/start`, { method: "POST" }),

  stopHosted: (sourceId: string) =>
    request<{ state: HostedRuntimeState }>(`/admin/hosted/${sourceId}/stop`, { method: "POST" }),

  restartHosted: (sourceId: string) =>
    request<{ state: HostedRuntimeState }>(`/admin/hosted/${sourceId}/restart`, { method: "POST" }),

  getHostedLogs: (sourceId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return request<{ items: LogEntry[] }>(`/admin/hosted/${sourceId}/logs${qs}`);
  },

  // ── 迁移 ─────────────────────────────────────────────────────────

  migrateHostedNpmToLocalStdio: () =>
    request<{
      migrated: number;
      failed: number;
      results: Array<{ sourceId: string; status: "ok" | "error"; error?: string }>;
    }>("/admin/migrate/hosted-npm-to-local-stdio", { method: "POST" }),
};
