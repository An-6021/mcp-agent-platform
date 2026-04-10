const BASE = "";

type ApiResponse<T> = { data: T; error: null } | { data: null; error: { code: string; message: string } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && init?.body !== null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${url}`, {
    ...init,
    headers,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (json.error) throw new Error(json.error.message);
  return json.data;
}

// ── Types (mirrors server) ──────────────────────────────────────────────

export type WorkspaceSummary = {
  id: string;
  displayName: string;
  status: string;
  upstreamCount: number;
  hasToken: boolean;
  lastPublishedAt: string | null;
};

export type Workspace = {
  id: string;
  displayName: string;
  description: string;
  status: string;
  cacheTtlSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type UpstreamConfig = {
  id: string;
  label: string;
  kind: "direct-http" | "local-stdio" | "hosted-npm" | "hosted-single-file";
  enabled: boolean;
  url?: string;
  headers?: Record<string, string>;
  command?: string[];
  cwd?: string | null;
  env?: Record<string, string>;
  timeoutMs?: number;
  autoStart?: boolean;
  packageName?: string;
  packageVersion?: string;
  binName?: string;
  args?: string[];
  fileName?: string;
  runtime?: "node" | "tsx" | "python" | "bash";
  source?: string;
};

export type WorkspaceDraft = {
  workspaceId: string;
  displayName: string;
  cacheTtlSeconds: number;
  upstreams: UpstreamConfig[];
  updatedAt: string;
  updatedBy: string;
};

export type TokenMeta = {
  id: string;
  workspaceId: string;
  label: string;
  tokenPreview: string;
  createdAt: string;
  revokedAt: string | null;
};

export type PublishedConfigSnapshot = {
  workspaceId: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  config: unknown;
  note: string;
};

export type WorkspaceDetail = {
  workspace: Workspace;
  draft: WorkspaceDraft | null;
  tokens: TokenMeta[];
};

export type PublishedWorkspaceConfig = {
  schemaVersion: number;
  workspaceId: string;
  displayName: string;
  generatedAt: string;
  cacheTtlSeconds: number;
  upstreams: UpstreamConfig[];
};

export type WorkspaceCapabilityTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type WorkspaceCapabilityResource = {
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
};

export type WorkspaceCapabilityPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

export type WorkspaceCapabilityPrompt = {
  name: string;
  description?: string;
  arguments?: WorkspaceCapabilityPromptArgument[];
};

export type WorkspaceUpstreamCapabilities = {
  upstreamId: string;
  upstreamLabel: string;
  upstreamKind: UpstreamConfig["kind"];
  status: "ready" | "error";
  error?: string;
  tools: WorkspaceCapabilityTool[];
  resources: WorkspaceCapabilityResource[];
  prompts: WorkspaceCapabilityPrompt[];
  toolCount: number;
  resourceCount: number;
  promptCount: number;
};

export type WorkspaceCapabilities = {
  workspaceId: string;
  generatedAt: string;
  upstreams: WorkspaceUpstreamCapabilities[];
};

// ── API functions ───────────────────────────────────────────────────────

export const api = {
  listWorkspaces: () => request<WorkspaceSummary[]>("/admin/workspaces"),

  createWorkspace: (input: { id: string; displayName: string; description?: string; cacheTtlSeconds?: number }) =>
    request<Workspace>("/admin/workspaces", { method: "POST", body: JSON.stringify(input) }),

  getWorkspace: (id: string) => request<WorkspaceDetail>(`/admin/workspaces/${id}`),

  saveDraft: (id: string, draft: Partial<WorkspaceDraft>) =>
    request<WorkspaceDraft>(`/admin/workspaces/${id}/draft`, {
      method: "PUT",
      body: JSON.stringify(draft),
    }),

  publish: (id: string, input?: { publishedBy?: string; note?: string }) =>
    request<PublishedConfigSnapshot>(`/admin/workspaces/${id}/publish`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  listSnapshots: (id: string) => request<PublishedConfigSnapshot[]>(`/admin/workspaces/${id}/snapshots`),

  rollback: (id: string, version: number) =>
    request<PublishedConfigSnapshot>(`/admin/workspaces/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ version }),
    }),

  createToken: (id: string, input?: { label?: string }) =>
    request<{ token: string; meta: TokenMeta }>(`/admin/workspaces/${id}/tokens`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  revokeToken: (id: string, tokenId: string) =>
    request<{ meta: TokenMeta }>(`/admin/workspaces/${id}/tokens/${tokenId}/revoke`, {
      method: "POST",
    }),

  getCapabilities: (id: string) => request<WorkspaceCapabilities>(`/admin/workspaces/${id}/capabilities`),

  getPublishedConfig: (id: string) =>
    fetch(`/v1/workspaces/${id}/config`).then((r) => (r.ok ? (r.json() as Promise<PublishedWorkspaceConfig>) : null)),
};
