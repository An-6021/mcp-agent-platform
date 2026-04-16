import type { UpstreamConfig, WorkspaceConfig } from "./config";

// ── Admin entity types (not exposed to agent) ──────────────────────────

export type WorkspaceStatus = "active" | "archived";

export type Workspace = {
  id: string;
  displayName: string;
  description: string;
  status: WorkspaceStatus;
  cacheTtlSeconds: number;
  createdAt: string; // ISO 8601
  updatedAt: string;
};

export type WorkspaceDraft = {
  workspaceId: string;
  displayName: string;
  cacheTtlSeconds: number;
  upstreams: UpstreamConfig[];
  updatedAt: string;
  updatedBy: string;
};

export type PublishedConfigSnapshot = {
  workspaceId: string;
  version: number;
  publishedAt: string;
  publishedBy: string;
  config: WorkspaceConfig;
  note: string;
};

export type WorkspaceTokenMeta = {
  id: string;
  workspaceId: string;
  exportId: string | null;
  label: string;
  tokenHash: string;
  tokenPreview: string;
  createdAt: string;
  revokedAt: string | null;
};

export type WorkspaceExportProfile = {
  id: string;
  workspaceId: string;
  name: string;
  serverName: string;
  enabledSourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

// ── Input types ─────────────────────────────────────────────────────────

export type CreateWorkspaceInput = {
  id: string;
  displayName: string;
  description?: string;
  cacheTtlSeconds?: number;
};

export type PublishInput = {
  publishedBy: string;
  note?: string;
};

export type CreateWorkspaceTokenInput = {
  label?: string;
};

export type CreateWorkspaceExportInput = {
  name: string;
  serverName: string;
  enabledSourceIds: string[];
};

export type UpdateWorkspaceExportInput = {
  name?: string;
  serverName?: string;
  enabledSourceIds?: string[];
};

// ── Summary type for list endpoint ──────────────────────────────────────

export type WorkspaceSummary = {
  id: string;
  displayName: string;
  status: WorkspaceStatus;
  upstreamCount: number;
  hasToken: boolean;
  lastPublishedAt: string | null;
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

// ── Repository interface ────────────────────────────────────────────────

export type WorkspaceRepository = {
  list(): Promise<WorkspaceSummary[]>;
  getWorkspace(id: string): Promise<Workspace | null>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getDraft(id: string): Promise<WorkspaceDraft | null>;
  saveDraft(draft: WorkspaceDraft): Promise<void>;
  getPublishedConfig(id: string): Promise<WorkspaceConfig | null>;
  publish(id: string, input: PublishInput): Promise<PublishedConfigSnapshot>;
  listSnapshots(id: string): Promise<PublishedConfigSnapshot[]>;
  rollback(id: string, version: number): Promise<PublishedConfigSnapshot>;
  listTokens(id: string): Promise<WorkspaceTokenMeta[]>;
  createToken(id: string, input?: CreateWorkspaceTokenInput): Promise<{ token: string; meta: WorkspaceTokenMeta }>;
  revokeToken(id: string, tokenId: string): Promise<WorkspaceTokenMeta>;
  verifyToken(id: string, token: string): Promise<boolean>;
  listExports(id: string): Promise<WorkspaceExportProfile[]>;
  createExport(id: string, input: CreateWorkspaceExportInput): Promise<WorkspaceExportProfile>;
  updateExport(id: string, exportId: string, input: UpdateWorkspaceExportInput): Promise<WorkspaceExportProfile>;
  deleteExport(id: string, exportId: string): Promise<void>;
  getExport(id: string, exportId: string): Promise<WorkspaceExportProfile | null>;
  createExportToken(id: string, exportId: string, input?: CreateWorkspaceTokenInput): Promise<{ token: string; meta: WorkspaceTokenMeta }>;
  verifyExportToken(id: string, exportId: string, token: string): Promise<boolean>;
};
