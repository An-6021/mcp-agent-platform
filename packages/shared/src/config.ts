import { z } from "zod";

export const WORKSPACE_CONFIG_SCHEMA_VERSION = 1 as const;

export const CachedToolCapabilitySchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});
export type CachedToolCapability = z.infer<typeof CachedToolCapabilitySchema>;

export const CachedResourceCapabilitySchema = z.object({
  uri: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type CachedResourceCapability = z.infer<typeof CachedResourceCapabilitySchema>;

export const CachedPromptArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
});
export type CachedPromptArgument = z.infer<typeof CachedPromptArgumentSchema>;

export const CachedPromptCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  arguments: z.array(CachedPromptArgumentSchema).optional(),
});
export type CachedPromptCapability = z.infer<typeof CachedPromptCapabilitySchema>;

export const CachedToolExposureSchema = z.object({
  originalName: z.string().min(1),
  exposedName: z.string().min(1),
  enabled: z.boolean().default(true),
  order: z.number().int().nonnegative().default(0),
  strategy: z.enum(["default", "renamed", "hidden"]).default("default"),
});
export type CachedToolExposure = z.infer<typeof CachedToolExposureSchema>;

export const CachedUpstreamCapabilitiesSchema = z.object({
  generatedAt: z.iso.datetime(),
  status: z.enum(["ready", "error"]),
  error: z.string().nullable().default(null),
  tools: z.array(CachedToolCapabilitySchema).default([]),
  resources: z.array(CachedResourceCapabilitySchema).default([]),
  prompts: z.array(CachedPromptCapabilitySchema).default([]),
  toolExposures: z.array(CachedToolExposureSchema).default([]),
});
export type CachedUpstreamCapabilities = z.infer<typeof CachedUpstreamCapabilitiesSchema>;

const BaseUpstreamSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
  cachedCapabilities: CachedUpstreamCapabilitiesSchema.nullable().optional().default(null),
});

const BaseLocalProcessUpstreamSchema = BaseUpstreamSchema.extend({
  cwd: z.string().nullable().optional().default(null),
  env: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(30_000),
  autoStart: z.boolean().default(true),
});

export const DirectHttpUpstreamSchema = BaseUpstreamSchema.extend({
  kind: z.literal("direct-http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).default({}),
});
export type DirectHttpUpstreamConfig = z.infer<typeof DirectHttpUpstreamSchema>;

export const LocalStdioUpstreamSchema = BaseLocalProcessUpstreamSchema.extend({
  kind: z.literal("local-stdio"),
  command: z.array(z.string()).min(1),
});
export type LocalStdioUpstreamConfig = z.infer<typeof LocalStdioUpstreamSchema>;

export const HostedNpmUpstreamSchema = BaseLocalProcessUpstreamSchema.extend({
  kind: z.literal("hosted-npm"),
  packageName: z.string().min(1),
  packageVersion: z.string().min(1).optional(),
  binName: z.string().min(1),
  args: z.array(z.string()).default([]),
});
export type HostedNpmUpstreamConfig = z.infer<typeof HostedNpmUpstreamSchema>;

export const HostedSingleFileRuntimeSchema = z.enum(["node", "tsx", "python", "bash"]);
export type HostedSingleFileRuntime = z.infer<typeof HostedSingleFileRuntimeSchema>;

export const HostedSingleFileUpstreamSchema = BaseLocalProcessUpstreamSchema.extend({
  kind: z.literal("hosted-single-file"),
  fileName: z.string().min(1),
  runtime: HostedSingleFileRuntimeSchema.default("node"),
  source: z.string().min(1),
  args: z.array(z.string()).default([]),
});
export type HostedSingleFileUpstreamConfig = z.infer<typeof HostedSingleFileUpstreamSchema>;

export const UpstreamSchema = z.union([
  DirectHttpUpstreamSchema,
  LocalStdioUpstreamSchema,
  HostedNpmUpstreamSchema,
  HostedSingleFileUpstreamSchema,
]);
export type UpstreamConfig = z.infer<typeof UpstreamSchema>;

export const WorkspaceConfigSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_CONFIG_SCHEMA_VERSION),
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  generatedAt: z.iso.datetime(),
  cacheTtlSeconds: z.number().int().positive().default(300),
  upstreams: z.array(UpstreamSchema).default([]),
});
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const CachedWorkspaceConfigSchema = z.object({
  savedAtMs: z.number().int().nonnegative(),
  config: WorkspaceConfigSchema,
});
export type CachedWorkspaceConfig = z.infer<typeof CachedWorkspaceConfigSchema>;

export function parseWorkspaceConfig(raw: unknown): WorkspaceConfig {
  return WorkspaceConfigSchema.parse(raw);
}

export function parseCachedWorkspaceConfig(raw: unknown): CachedWorkspaceConfig {
  return CachedWorkspaceConfigSchema.parse(raw);
}
