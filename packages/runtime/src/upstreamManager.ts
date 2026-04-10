import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CallToolResult,
  GetPromptResult,
  ListPromptsResult,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import {
  decodeResourceUri,
  encodeResourceUri,
  prefixName,
  splitPrefixedName,
  type HostedNpmUpstreamConfig,
  type HostedSingleFileUpstreamConfig,
  type LocalStdioUpstreamConfig,
  type WorkspaceUpstreamCapabilities,
  type UpstreamConfig,
} from "@mcp-agent-platform/shared";

type OptionalCapability = "resources" | "prompts";
type RuntimeState = "disconnected" | "connecting" | "connected" | "failed";

type UpstreamRuntime = {
  config: UpstreamConfig;
  client?: Client;
  transport?: StdioClientTransport | StreamableHTTPClientTransport;
  capabilities?: ServerCapabilities;
  state: RuntimeState;
  lastError?: string;
  restartCount: number;
  backoffMs: number;
  reconnectTimer?: NodeJS.Timeout;
  connecting?: Promise<void>;
  closing: boolean;
  suppressReconnect: boolean;
};

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export class UpstreamManager {
  private readonly runtimes = new Map<string, UpstreamRuntime>();
  private readonly upstreamIds: string[];

  constructor(upstreams: UpstreamConfig[]) {
    this.upstreamIds = upstreams.filter((item) => item.enabled).map((item) => item.id);
    for (const upstream of upstreams) {
      if (!upstream.enabled) continue;
      this.runtimes.set(upstream.id, {
        config: upstream,
        state: "disconnected",
        restartCount: 0,
        backoffMs: INITIAL_BACKOFF_MS,
        closing: false,
        suppressReconnect: false,
      });
    }
  }

  async initialize(): Promise<void> {
    await Promise.all(
      [...this.runtimes.entries()].map(async ([upstreamId, runtime]) => {
        if (isStdioLikeUpstream(runtime.config) && !runtime.config.autoStart) return;
        await this.tryEnsureConnected(upstreamId);
      }),
    );
  }

  getRuntimeCapabilities(): {
    tools: { listChanged: true };
    resources?: { listChanged: true };
    prompts?: { listChanged: true };
  } {
    const capabilities: {
      tools: { listChanged: true };
      resources?: { listChanged: true };
      prompts?: { listChanged: true };
    } = {
      tools: { listChanged: true },
    };

    if ([...this.runtimes.values()].some((runtime) => this.supportsCapability(runtime, "resources"))) {
      capabilities.resources = { listChanged: true };
    }
    if ([...this.runtimes.values()].some((runtime) => this.supportsCapability(runtime, "prompts"))) {
      capabilities.prompts = { listChanged: true };
    }

    return capabilities;
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.runtimes.values()].map(async (runtime) => {
        runtime.closing = true;
        if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
        runtime.reconnectTimer = undefined;
        await this.disposeConnection(runtime, true);
        runtime.connecting = undefined;
        runtime.state = "disconnected";
      }),
    );
  }

  async listTools(): Promise<ListToolsResult["tools"]> {
    const tools: ListToolsResult["tools"] = [];
    for (const upstreamId of this.upstreamIds) {
      const runtime = this.runtimes.get(upstreamId);
      if (!runtime) continue;

      try {
        const result = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listTools());
        for (const tool of result.tools) {
          tools.push({ ...tool, name: prefixName(upstreamId, tool.name) });
        }
      } catch (error) {
        this.markFailed(runtime, error);
      }
    }
    return tools;
  }

  async callTool(prefixedToolName: string, args: Record<string, unknown> | undefined): Promise<CallToolResult> {
    const split = splitPrefixedName(prefixedToolName);
    if (!split) return toolError(`无效的工具名：${prefixedToolName}`);

    const runtime = this.runtimes.get(split.upstreamId);
    if (!runtime) return toolError(`未知上游：${split.upstreamId}`);

    try {
      const result = await this.executeWithConnectionRecovery(split.upstreamId, (client) =>
        client.callTool({
          name: split.name,
          arguments: args ?? {},
        }),
      );
      return mapToolResultUris(split.upstreamId, result);
    } catch (error) {
      this.markFailed(runtime, error);
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }

  async listResources(): Promise<ListResourcesResult["resources"]> {
    const resources: ListResourcesResult["resources"] = [];
    for (const upstreamId of this.upstreamIds) {
      const runtime = this.runtimes.get(upstreamId);
      if (!runtime) continue;
      if (this.hasKnownMissingCapability(runtime, "resources")) continue;

      try {
        await this.ensureConnected(upstreamId);
        if (!this.supportsCapability(runtime, "resources")) continue;
        const result = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listResources());
        for (const resource of result.resources) {
          resources.push({ ...resource, uri: encodeResourceUri(upstreamId, resource.uri) });
        }
      } catch (error) {
        if (this.handleOptionalCapabilityError(runtime, "resources", error)) continue;
        this.markFailed(runtime, error);
      }
    }
    return resources;
  }

  async readResource(hubUri: string): Promise<ReadResourceResult> {
    const decoded = decodeResourceUri(hubUri);
    if (!decoded) throw new Error(`无效的资源 URI：${hubUri}`);

    const runtime = this.runtimes.get(decoded.upstreamId);
    if (!runtime) throw new Error(`未知上游：${decoded.upstreamId}`);
    if (this.hasKnownMissingCapability(runtime, "resources")) {
      throw new Error(`上游不支持 resources：${decoded.upstreamId}`);
    }

    await this.ensureConnected(decoded.upstreamId);
    if (!this.supportsCapability(runtime, "resources")) {
      throw new Error(`上游不支持 resources：${decoded.upstreamId}`);
    }

    try {
      const result = await this.executeWithConnectionRecovery(decoded.upstreamId, (client) =>
        client.readResource({ uri: decoded.upstreamUri }),
      );
      return {
        ...result,
        contents: result.contents.map((item) => ({
          ...item,
          uri: encodeResourceUri(decoded.upstreamId, item.uri),
        })),
      };
    } catch (error) {
      if (this.handleOptionalCapabilityError(runtime, "resources", error)) {
        throw new Error(`上游不支持 resources：${decoded.upstreamId}`);
      }
      throw error;
    }
  }

  async listPrompts(): Promise<ListPromptsResult["prompts"]> {
    const prompts: ListPromptsResult["prompts"] = [];
    for (const upstreamId of this.upstreamIds) {
      const runtime = this.runtimes.get(upstreamId);
      if (!runtime) continue;
      if (this.hasKnownMissingCapability(runtime, "prompts")) continue;

      try {
        await this.ensureConnected(upstreamId);
        if (!this.supportsCapability(runtime, "prompts")) continue;
        const result = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listPrompts());
        for (const prompt of result.prompts) {
          prompts.push({ ...prompt, name: prefixName(upstreamId, prompt.name) });
        }
      } catch (error) {
        if (this.handleOptionalCapabilityError(runtime, "prompts", error)) continue;
        this.markFailed(runtime, error);
      }
    }
    return prompts;
  }

  async getPrompt(prefixedPromptName: string, args: Record<string, unknown> | undefined): Promise<GetPromptResult> {
    const split = splitPrefixedName(prefixedPromptName);
    if (!split) throw new Error(`无效的提示名：${prefixedPromptName}`);

    const runtime = this.runtimes.get(split.upstreamId);
    if (!runtime) throw new Error(`未知上游：${split.upstreamId}`);
    if (this.hasKnownMissingCapability(runtime, "prompts")) {
      throw new Error(`上游不支持 prompts：${split.upstreamId}`);
    }

    await this.ensureConnected(split.upstreamId);
    if (!this.supportsCapability(runtime, "prompts")) {
      throw new Error(`上游不支持 prompts：${split.upstreamId}`);
    }

    try {
      const result = await this.executeWithConnectionRecovery(split.upstreamId, (client) =>
        client.getPrompt({ name: split.name, arguments: args }),
      );
      return {
        ...result,
        messages: result.messages.map((message) => ({
          ...message,
          content: mapEmbeddedResourceUri(split.upstreamId, message.content),
        })),
      };
    } catch (error) {
      if (this.handleOptionalCapabilityError(runtime, "prompts", error)) {
        throw new Error(`上游不支持 prompts：${split.upstreamId}`);
      }
      throw error;
    }
  }

  async inspectCapabilities(): Promise<WorkspaceUpstreamCapabilities[]> {
    const snapshots: WorkspaceUpstreamCapabilities[] = [];

    for (const upstreamId of this.upstreamIds) {
      const runtime = this.runtimes.get(upstreamId);
      if (!runtime) continue;

      const snapshot: WorkspaceUpstreamCapabilities = {
        upstreamId,
        upstreamLabel: runtime.config.label,
        upstreamKind: runtime.config.kind,
        status: "ready",
        tools: [],
        resources: [],
        prompts: [],
        toolCount: 0,
        resourceCount: 0,
        promptCount: 0,
      };

      try {
        await this.ensureConnected(upstreamId);

        const toolResult = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listTools());
        snapshot.tools = toolResult.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: "inputSchema" in tool ? tool.inputSchema : undefined,
        }));

        if (this.supportsCapability(runtime, "resources")) {
          try {
            const resourceResult = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listResources());
            snapshot.resources = resourceResult.resources.map((resource) => ({
              name: resource.name,
              uri: resource.uri,
              description: resource.description,
              mimeType: resource.mimeType,
            }));
          } catch (error) {
            if (!this.handleOptionalCapabilityError(runtime, "resources", error)) {
              throw error;
            }
          }
        }

        if (this.supportsCapability(runtime, "prompts")) {
          try {
            const promptResult = await this.executeWithConnectionRecovery(upstreamId, (client) => client.listPrompts());
            snapshot.prompts = promptResult.prompts.map((prompt) => ({
              name: prompt.name,
              description: prompt.description,
              arguments: prompt.arguments?.map((item) => ({
                name: item.name,
                description: item.description,
                required: item.required,
              })),
            }));
          } catch (error) {
            if (!this.handleOptionalCapabilityError(runtime, "prompts", error)) {
              throw error;
            }
          }
        }
      } catch (error) {
        this.markFailed(runtime, error);
        snapshot.status = "error";
        snapshot.error = error instanceof Error ? error.message : String(error);
      }

      snapshot.toolCount = snapshot.tools.length;
      snapshot.resourceCount = snapshot.resources.length;
      snapshot.promptCount = snapshot.prompts.length;
      snapshots.push(snapshot);
    }

    return snapshots;
  }

  private async tryEnsureConnected(upstreamId: string): Promise<Client | null> {
    try {
      return await this.ensureConnected(upstreamId);
    } catch (error) {
      const runtime = this.runtimes.get(upstreamId);
      if (runtime) {
        this.markFailed(runtime, error);
        this.scheduleReconnect(runtime, upstreamId);
      }
      return null;
    }
  }

  private async ensureConnected(upstreamId: string): Promise<Client> {
    const runtime = this.runtimes.get(upstreamId);
    if (!runtime) throw new Error(`未知上游：${upstreamId}`);

    if (runtime.client && runtime.state === "connected") return runtime.client;
    if (runtime.connecting) {
      await runtime.connecting;
      if (runtime.client) return runtime.client;
    }

    await this.disposeConnection(runtime, true);
    runtime.connecting = this.connect(runtime, upstreamId);
    try {
      await runtime.connecting;
    } finally {
      runtime.connecting = undefined;
    }

    if (!runtime.client) throw new Error(`连接上游失败：${upstreamId}`);
    return runtime.client;
  }

  private async connect(runtime: UpstreamRuntime, upstreamId: string): Promise<void> {
    runtime.state = "connecting";
    runtime.lastError = undefined;

    const client = new Client({ name: `mcp-agent-upstream-${upstreamId}`, version: "0.1.0" });
    client.onclose = () => {
      if (runtime.closing) return;
      runtime.client = undefined;
      runtime.transport = undefined;
      runtime.state = "disconnected";
      if (runtime.suppressReconnect) return;
      this.scheduleReconnect(runtime, upstreamId);
    };
    client.onerror = (error) => {
      runtime.lastError = error.message;
    };

    const transport = await createClientTransport(runtime.config);
    runtime.transport = transport;

    try {
      await client.connect(transport);
      runtime.client = client;
      runtime.capabilities = client.getServerCapabilities() ?? {};
      runtime.state = "connected";
      runtime.backoffMs = INITIAL_BACKOFF_MS;
    } catch (error) {
      await this.disposeConnection(runtime, true);
      this.markFailed(runtime, error);
      throw error;
    }
  }

  private scheduleReconnect(runtime: UpstreamRuntime, upstreamId: string) {
    if (runtime.reconnectTimer) return;
    if (!isStdioLikeUpstream(runtime.config)) return;
    if (!runtime.config.autoStart) return;

    const delay = Math.min(runtime.backoffMs, MAX_BACKOFF_MS);
    runtime.backoffMs = Math.min(Math.round(runtime.backoffMs * 1.5), MAX_BACKOFF_MS);
    runtime.restartCount += 1;

    runtime.reconnectTimer = setTimeout(() => {
      runtime.reconnectTimer = undefined;
      if (runtime.closing) return;
      void this.tryEnsureConnected(upstreamId);
    }, delay);
  }

  private markFailed(runtime: UpstreamRuntime, error: unknown) {
    runtime.state = "failed";
    runtime.lastError = error instanceof Error ? error.message : String(error);
  }

  private async executeWithConnectionRecovery<T>(
    upstreamId: string,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const runtime = this.runtimes.get(upstreamId);
    if (!runtime) throw new Error(`未知上游：${upstreamId}`);

    const client = await this.ensureConnected(upstreamId);
    try {
      return await operation(client);
    } catch (error) {
      if (!this.shouldRetryAfterTransportError(runtime, error)) throw error;

      runtime.restartCount += 1;
      await this.disposeConnection(runtime, true);

      const retryClient = await this.ensureConnected(upstreamId);
      return await operation(retryClient);
    }
  }

  private shouldRetryAfterTransportError(runtime: UpstreamRuntime, error: unknown): boolean {
    return runtime.config.kind === "direct-http" && isRecoverableHttpTransportError(error);
  }

  private supportsCapability(runtime: UpstreamRuntime, capability: OptionalCapability): boolean {
    return Boolean(runtime.capabilities?.[capability]);
  }

  private hasKnownMissingCapability(runtime: UpstreamRuntime, capability: OptionalCapability): boolean {
    return runtime.capabilities !== undefined && !this.supportsCapability(runtime, capability);
  }

  private handleOptionalCapabilityError(
    runtime: UpstreamRuntime,
    capability: OptionalCapability,
    error: unknown,
  ): boolean {
    if (!isMethodNotFoundError(error)) return false;

    const nextCapabilities = { ...(runtime.capabilities ?? {}) };
    delete nextCapabilities[capability];
    runtime.capabilities = nextCapabilities;
    return true;
  }

  private async disposeConnection(runtime: UpstreamRuntime, suppressReconnect = false): Promise<void> {
    const previousSuppressReconnect = runtime.suppressReconnect;
    if (suppressReconnect) runtime.suppressReconnect = true;

    try {
      if (runtime.client) {
        try {
          await runtime.client.close();
        } catch {
          // ignore
        }
      } else if (runtime.transport) {
        try {
          await runtime.transport.close();
        } catch {
          // ignore
        }
      }
    } finally {
      runtime.client = undefined;
      runtime.transport = undefined;
      if (suppressReconnect) runtime.suppressReconnect = previousSuppressReconnect;
    }
  }
}

async function createClientTransport(config: UpstreamConfig): Promise<StdioClientTransport | StreamableHTTPClientTransport> {
  if (config.kind === "direct-http") {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: {
        headers: config.headers,
      },
    });
  }

  const launch = await resolveStdioLaunchConfig(config);
  const [command, ...args] = launch.command;
  if (!command) throw new Error(`无效的 stdio 命令：${config.id}`);

  return new StdioClientTransport({
    command: resolveStdioCommand(command),
    args,
    env: inheritEnv(launch.env),
    cwd: launch.cwd,
    stderr: "inherit",
  });
}

type StdioLaunchConfig = {
  command: string[];
  env: Record<string, string>;
  cwd?: string;
};

function isStdioLikeUpstream(
  config: UpstreamConfig,
): config is LocalStdioUpstreamConfig | HostedNpmUpstreamConfig | HostedSingleFileUpstreamConfig {
  return config.kind === "local-stdio" || config.kind === "hosted-npm" || config.kind === "hosted-single-file";
}

async function resolveStdioLaunchConfig(
  config: LocalStdioUpstreamConfig | HostedNpmUpstreamConfig | HostedSingleFileUpstreamConfig,
): Promise<StdioLaunchConfig> {
  if (config.kind === "local-stdio") {
    return {
      command: config.command,
      env: config.env,
      cwd: config.cwd ?? undefined,
    };
  }

  if (config.kind === "hosted-npm") {
    const packageSpec = config.packageVersion ? `${config.packageName}@${config.packageVersion}` : config.packageName;
    return {
      command: ["npx", "-y", "--package", packageSpec, config.binName, ...config.args],
      env: config.env,
      cwd: config.cwd ?? undefined,
    };
  }

  const prepared = await materializeHostedSingleFile(config);
  return {
    command: buildHostedSingleFileCommand(config, prepared.filePath),
    env: config.env,
    cwd: config.cwd ?? prepared.workDir,
  };
}

function buildHostedSingleFileCommand(config: HostedSingleFileUpstreamConfig, filePath: string): string[] {
  switch (config.runtime) {
    case "tsx":
      return ["npx", "-y", "tsx", filePath, ...config.args];
    case "python":
      return ["python3", filePath, ...config.args];
    case "bash":
      return ["bash", filePath, ...config.args];
    case "node":
    default:
      return ["node", filePath, ...config.args];
  }
}

async function materializeHostedSingleFile(config: HostedSingleFileUpstreamConfig): Promise<{ filePath: string; workDir: string }> {
  const fileName = normalizeHostedFileName(config.fileName, config.runtime);
  const contentHash = sha256(
    JSON.stringify({
      fileName,
      runtime: config.runtime,
      source: config.source,
    }),
  ).slice(0, 16);
  const workDir = path.join(tmpdir(), "mcp-agent-platform-hosted", sanitizePathSegment(config.id), contentHash);
  const filePath = path.join(workDir, fileName);

  await mkdir(workDir, { recursive: true });
  await writeFile(filePath, config.source.endsWith("\n") ? config.source : `${config.source}\n`, "utf8");

  if (config.runtime === "node" || config.runtime === "tsx") {
    const nodeModulesDir = findNearestNodeModulesDir(fileURLToPath(import.meta.url));
    if (nodeModulesDir) {
      await ensureNodeModulesLink(workDir, nodeModulesDir);
    }
  }

  return { filePath, workDir };
}

function normalizeHostedFileName(fileName: string, runtime: HostedSingleFileUpstreamConfig["runtime"]): string {
  const trimmed = path.basename(fileName.trim());
  const fallback = getDefaultHostedFileName(runtime);
  if (!trimmed) return fallback;
  if (path.extname(trimmed)) return trimmed;
  return `${trimmed}${path.extname(fallback)}`;
}

function getDefaultHostedFileName(runtime: HostedSingleFileUpstreamConfig["runtime"]): string {
  switch (runtime) {
    case "tsx":
      return "index.ts";
    case "python":
      return "main.py";
    case "bash":
      return "main.sh";
    case "node":
    default:
      return "index.mjs";
  }
}

function sanitizePathSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || "upstream";
}

function findNearestNodeModulesDir(fromFilePath: string): string | null {
  let currentDir = path.dirname(fromFilePath);

  while (true) {
    const candidate = path.join(currentDir, "node_modules");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

async function ensureNodeModulesLink(workDir: string, targetNodeModulesDir: string): Promise<void> {
  const linkPath = path.join(workDir, "node_modules");
  if (existsSync(linkPath)) {
    return;
  }

  try {
    await symlink(targetNodeModulesDir, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
}

function resolveStdioCommand(command: string): string {
  if (command === "node" || command === "node.exe") {
    return process.execPath;
  }

  if (command === "npx" || command === "npx.cmd") {
    const nodeBinDir = path.dirname(process.execPath);
    const candidates =
      process.platform === "win32"
        ? [path.join(nodeBinDir, "npx.cmd"), path.join(nodeBinDir, "npx.exe"), path.join(nodeBinDir, "npx")]
        : [path.join(nodeBinDir, "npx")];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return command;
}

function inheritEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }
  ensureNodeBinInPath(env);
  return env;
}

function ensureNodeBinInPath(env: Record<string, string>) {
  const nodeBinDir = path.dirname(process.execPath);
  const pathKey = env.PATH !== undefined ? "PATH" : env.Path !== undefined ? "Path" : "PATH";
  const current = env[pathKey] ?? "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (parts.includes(nodeBinDir)) return;
  env[pathKey] = [nodeBinDir, ...parts].join(path.delimiter);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function isRecoverableHttpTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return [
    "session not found",
    "mcp-session-id header is required",
    "unexpected content type",
    "sse stream disconnected",
    "streamable http error",
  ].some((pattern) => message.includes(pattern));
}

function isMethodNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("MCP error -32601");
}

function mapToolResultUris(upstreamId: string, result: CallToolResult): CallToolResult {
  return {
    ...result,
    content: result.content.map((block) => mapContentBlockUri(upstreamId, block)),
  };
}

type ResultContentBlock = CallToolResult["content"][number];
type PromptContent = GetPromptResult["messages"][number]["content"];

function mapContentBlockUri(upstreamId: string, block: ResultContentBlock): ResultContentBlock {
  if (block.type === "resource") {
    return {
      ...block,
      resource: {
        ...block.resource,
        uri: encodeResourceUri(upstreamId, block.resource.uri),
      },
    };
  }

  if (block.type === "resource_link") {
    return {
      ...block,
      uri: encodeResourceUri(upstreamId, block.uri),
    };
  }

  return block;
}

function mapEmbeddedResourceUri(upstreamId: string, content: PromptContent): PromptContent {
  if (content.type !== "resource") return content;
  return {
    ...content,
    resource: {
      ...content.resource,
      uri: encodeResourceUri(upstreamId, content.resource.uri),
    },
  };
}
