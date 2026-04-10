import { z } from "zod";

export const WORKSPACE_CONFIG_SCHEMA_VERSION = 1 as const;

const BaseUpstreamSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  enabled: z.boolean().default(true),
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
