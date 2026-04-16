import { z } from "zod";
import {
  HostedSingleFileRuntimeSchema,
  WORKSPACE_CONFIG_SCHEMA_VERSION,
  type CachedUpstreamCapabilities,
  type HostedSingleFileRuntime,
  type WorkspaceConfig,
  type UpstreamConfig,
} from "./config";

export const SourceKindSchema = z.enum([
  "remote-http",
  "local-stdio",
  "hosted-npm",
  "hosted-single-file",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceStatusSchema = z.enum(["unknown", "ready", "error", "offline", "disabled"]);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const HostedRuntimeStatusSchema = z.enum(["stopped", "starting", "running", "error"]);
export type HostedRuntimeStatus = z.infer<typeof HostedRuntimeStatusSchema>;

export const DiscoveredToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});
export type DiscoveredTool = z.infer<typeof DiscoveredToolSchema>;

export const DiscoveredResourceSchema = z.object({
  uri: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type DiscoveredResource = z.infer<typeof DiscoveredResourceSchema>;

export const DiscoveredPromptArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
});
export type DiscoveredPromptArgument = z.infer<typeof DiscoveredPromptArgumentSchema>;

export const DiscoveredPromptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  arguments: z.array(DiscoveredPromptArgumentSchema).optional(),
});
export type DiscoveredPrompt = z.infer<typeof DiscoveredPromptSchema>;

const SourceDiscoveryFields = {
  generatedAt: z.iso.datetime(),
  status: z.enum(["ready", "error"]),
  error: z.string().nullable(),
  tools: z.array(DiscoveredToolSchema).default([]),
  resources: z.array(DiscoveredResourceSchema).default([]),
  prompts: z.array(DiscoveredPromptSchema).default([]),
} satisfies z.ZodRawShape;

export const SourceDiscoverySeedSchema = z.object(SourceDiscoveryFields);
export type SourceDiscoverySeed = z.infer<typeof SourceDiscoverySeedSchema>;

export const ImportedSourceDiscoverySchema = z.object({
  sourceId: z.string().min(1).optional(),
  ...SourceDiscoveryFields,
});
export type ImportedSourceDiscovery = z.infer<typeof ImportedSourceDiscoverySchema>;

const BaseSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  lastRefreshedAt: z.iso.datetime().nullable().default(null),
  status: SourceStatusSchema.default("unknown"),
  lastError: z.string().nullable().default(null),
  seedDiscovery: SourceDiscoverySeedSchema.nullable().default(null),
});

export const RemoteHttpSourceConfigSchema = z.object({
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(30_000),
});
export type RemoteHttpSourceConfig = z.infer<typeof RemoteHttpSourceConfigSchema>;

export const LocalStdioSourceConfigSchema = z.object({
  command: z.array(z.string()).min(1),
  cwd: z.string().nullable().default(null),
  env: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(30_000),
});
export type LocalStdioSourceConfig = z.infer<typeof LocalStdioSourceConfigSchema>;

export const HostedNpmSourceConfigSchema = z.object({
  packageName: z.string().min(1),
  packageVersion: z.string().min(1).optional(),
  binName: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().nullable().default(null),
  env: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(30_000),
  autoStart: z.boolean().default(false),
});
export type HostedNpmSourceConfig = z.infer<typeof HostedNpmSourceConfigSchema>;

export const HostedSingleFileSourceConfigSchema = z.object({
  fileName: z.string().min(1),
  runtime: HostedSingleFileRuntimeSchema.default("node"),
  source: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().nullable().default(null),
  env: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(30_000),
  autoStart: z.boolean().default(false),
});
export type HostedSingleFileSourceConfig = z.infer<typeof HostedSingleFileSourceConfigSchema>;

export const SourceSchema = z.discriminatedUnion("kind", [
  BaseSourceSchema.extend({
    kind: z.literal("remote-http"),
    config: RemoteHttpSourceConfigSchema,
  }),
  BaseSourceSchema.extend({
    kind: z.literal("local-stdio"),
    config: LocalStdioSourceConfigSchema,
  }),
  BaseSourceSchema.extend({
    kind: z.literal("hosted-npm"),
    config: HostedNpmSourceConfigSchema,
  }),
  BaseSourceSchema.extend({
    kind: z.literal("hosted-single-file"),
    config: HostedSingleFileSourceConfigSchema,
  }),
]);
export type Source = z.infer<typeof SourceSchema>;

export const SourceDiscoverySchema = z.object({
  sourceId: z.string().min(1),
  ...SourceDiscoveryFields,
});
export type SourceDiscovery = z.infer<typeof SourceDiscoverySchema>;

export const ToolExposureSchema = z.object({
  sourceId: z.string().min(1),
  originalName: z.string().min(1),
  exposedName: z.string().min(1),
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  strategy: z.enum(["default", "renamed", "hidden"]).default("default"),
});
export type ToolExposure = z.infer<typeof ToolExposureSchema>;

export const HostedRuntimeStateSchema = z.object({
  sourceId: z.string().min(1),
  status: HostedRuntimeStatusSchema,
  pid: z.number().int().nullable().default(null),
  startedAt: z.iso.datetime().nullable().default(null),
  stoppedAt: z.iso.datetime().nullable().default(null),
  restartCount: z.number().int().nonnegative().default(0),
  autoStart: z.boolean().default(false),
  lastExitCode: z.number().int().nullable().default(null),
  lastError: z.string().nullable().default(null),
});
export type HostedRuntimeState = z.infer<typeof HostedRuntimeStateSchema>;

export const LogEntrySchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  timestamp: z.iso.datetime(),
  stream: z.enum(["stdout", "stderr", "system"]),
  message: z.string(),
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

export const SystemSummarySchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  enabledSourceCount: z.number().int().nonnegative(),
  exposedToolCount: z.number().int().nonnegative(),
  hiddenToolCount: z.number().int().nonnegative(),
  conflictToolCount: z.number().int().nonnegative(),
  hostedRunningCount: z.number().int().nonnegative(),
  hostedErrorCount: z.number().int().nonnegative(),
});
export type SystemSummary = z.infer<typeof SystemSummarySchema>;

export const SourceListItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: SourceKindSchema,
  enabled: z.boolean(),
  status: SourceStatusSchema,
  toolCount: z.number().int().nonnegative(),
  resourceCount: z.number().int().nonnegative(),
  promptCount: z.number().int().nonnegative(),
  isHosted: z.boolean(),
  lastRefreshedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});
export type SourceListItem = z.infer<typeof SourceListItemSchema>;

export const ToolListItemSchema = z.object({
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  sourceKind: SourceKindSchema,
  originalName: z.string().min(1),
  exposedName: z.string().min(1),
  enabled: z.boolean(),
  strategy: z.enum(["default", "renamed", "hidden"]),
  description: z.string().optional(),
  conflictStatus: z.enum(["none", "name-conflict"]),
});
export type ToolListItem = z.infer<typeof ToolListItemSchema>;

export const HostedListItemSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["hosted-npm", "hosted-single-file"]),
  enabled: z.boolean(),
  runtimeStatus: HostedRuntimeStatusSchema,
  autoStart: z.boolean(),
  startedAt: z.iso.datetime().nullable(),
  restartCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export type HostedListItem = z.infer<typeof HostedListItemSchema>;

export const CreateSourceInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: SourceKindSchema,
  enabled: z.boolean().optional(),
  config: z.unknown(),
  seedDiscovery: ImportedSourceDiscoverySchema.optional(),
});
export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>;

export const UpdateSourceInputSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  config: z.unknown().optional(),
  seedDiscovery: ImportedSourceDiscoverySchema.optional(),
  status: SourceStatusSchema.optional(),
  lastRefreshedAt: z.iso.datetime().nullable().optional(),
  lastError: z.string().nullable().optional(),
});
export type UpdateSourceInput = z.infer<typeof UpdateSourceInputSchema>;

export const UpdateToolExposureInputSchema = z.object({
  exposedName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateToolExposureInput = z.infer<typeof UpdateToolExposureInputSchema>;

export type ConsoleRepository = {
  listSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  createSource(input: CreateSourceInput): Promise<Source>;
  updateSource(id: string, patch: UpdateSourceInput): Promise<Source>;
  deleteSource(id: string): Promise<void>;
  saveDiscovery(discovery: SourceDiscovery): Promise<void>;
  getDiscovery(sourceId: string): Promise<SourceDiscovery | null>;
  listExposures(): Promise<ToolExposure[]>;
  saveExposure(exposure: ToolExposure): Promise<ToolExposure>;
  saveExposures(exposures: ToolExposure[]): Promise<void>;
  getHostedState(sourceId: string): Promise<HostedRuntimeState | null>;
  saveHostedState(state: HostedRuntimeState): Promise<void>;
  listHostedStates(): Promise<HostedRuntimeState[]>;
  appendLog(entry: LogEntry): Promise<void>;
  listLogs(sourceId: string, limit?: number): Promise<LogEntry[]>;
};

export function sourceToUpstreamConfig(source: Source): UpstreamConfig {
  switch (source.kind) {
    case "remote-http":
      return {
        id: source.id,
        label: source.name,
        kind: "direct-http",
        enabled: source.enabled,
        cachedCapabilities: null,
        url: source.config.endpoint,
        headers: source.config.headers,
      };
    case "local-stdio":
      return {
        id: source.id,
        label: source.name,
        kind: "local-stdio",
        enabled: source.enabled,
        cachedCapabilities: null,
        command: source.config.command,
        cwd: source.config.cwd,
        env: source.config.env,
        timeoutMs: source.config.timeoutMs,
        autoStart: true,
      };
    case "hosted-npm":
      return {
        id: source.id,
        label: source.name,
        kind: "hosted-npm",
        enabled: source.enabled,
        cachedCapabilities: null,
        packageName: source.config.packageName,
        packageVersion: source.config.packageVersion,
        binName: source.config.binName,
        args: source.config.args,
        cwd: source.config.cwd,
        env: source.config.env,
        timeoutMs: source.config.timeoutMs,
        autoStart: source.config.autoStart,
      };
    case "hosted-single-file":
      return {
        id: source.id,
        label: source.name,
        kind: "hosted-single-file",
        enabled: source.enabled,
        cachedCapabilities: null,
        fileName: source.config.fileName,
        runtime: source.config.runtime,
        source: source.config.source,
        args: source.config.args,
        cwd: source.config.cwd,
        env: source.config.env,
        timeoutMs: source.config.timeoutMs,
        autoStart: source.config.autoStart,
      };
  }
}

export function buildWorkspaceConfigFromSources(input: {
  workspaceId?: string;
  displayName?: string;
  sources: Source[];
}): WorkspaceConfig {
  return {
    schemaVersion: WORKSPACE_CONFIG_SCHEMA_VERSION,
    workspaceId: input.workspaceId ?? "mcp-hub",
    displayName: input.displayName ?? "mcp-hub",
    generatedAt: new Date().toISOString(),
    cacheTtlSeconds: 300,
    upstreams: input.sources.filter((source) => source.enabled).map(sourceToUpstreamConfig),
  };
}

export function buildCachedCapabilities(
  discovery: SourceDiscovery | null,
  exposures: ToolExposure[],
  sourceName?: string,
): CachedUpstreamCapabilities | null {
  if (!discovery) return null;

  const matchedExposures = exposures
    .filter((item) => item.sourceId === discovery.sourceId)
    .sort((left, right) => left.order - right.order || left.exposedName.localeCompare(right.exposedName));

  const effectiveExposures = matchedExposures.length > 0
    ? matchedExposures
    : discovery.tools.map((tool, index) => ({
        sourceId: discovery.sourceId,
        originalName: tool.name,
        exposedName: defaultExposedName(sourceName ?? discovery.sourceId, tool.name),
        enabled: true,
        order: index,
        strategy: "default" as const,
      }));

  return {
    generatedAt: discovery.generatedAt,
    status: discovery.status,
    error: discovery.error,
    tools: discovery.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    resources: discovery.resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
    prompts: discovery.prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments?.map((argument) => ({
        name: argument.name,
        description: argument.description,
        required: argument.required,
      })),
    })),
    toolExposures: effectiveExposures.map((item) => ({
        originalName: item.originalName,
        exposedName: item.exposedName,
        enabled: item.enabled,
        order: item.order,
        strategy: item.strategy,
      })),
  };
}

export function isHostedSourceKind(kind: SourceKind): kind is "hosted-npm" | "hosted-single-file" {
  return kind === "hosted-npm" || kind === "hosted-single-file";
}

export function isHostedSource(source: Source): boolean {
  return isHostedSourceKind(source.kind);
}

export function getHostedRuntimeAutoStart(source: Source): boolean {
  switch (source.kind) {
    case "hosted-npm":
    case "hosted-single-file":
      return source.config.autoStart;
    default:
      return false;
  }
}

export function defaultExposedName(sourceName: string, toolName: string): string {
  return `${sourceName}_${toolName}`
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export type ConsoleSourceConfig =
  | RemoteHttpSourceConfig
  | LocalStdioSourceConfig
  | HostedNpmSourceConfig
  | HostedSingleFileSourceConfig;

export type ConsoleHostedSingleFileRuntime = HostedSingleFileRuntime;
