import type {
  CallToolResult,
  ListResourcesResult,
  ListResourceTemplatesResult,
  ListToolsResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { encodeResourceUri, prefixName, type UpstreamConfig, type WorkspaceCapabilities, type WorkspaceConfig } from "@mcp-agent-platform/shared";
import type { WorkspaceUpstreamCapabilities } from "@mcp-agent-platform/shared";
import { UpstreamManager } from "./upstreamManager";

const META_URI_SCHEME = "mcp-agent-meta:";
const ACTION_MANUAL_URI = "mcp-agent-meta://workspace/action-manual";
const WORKSPACE_SUMMARY_URI = "mcp-agent-meta://workspace/summary";
const SERVICES_INDEX_URI = "mcp-agent-meta://services/index";
const SERVICES_CAPABILITIES_TEMPLATE_URI = "mcp-agent-meta://services/{serviceId}/capabilities";
const SERVICES_CONFIG_TEMPLATE_URI = "mcp-agent-meta://services/{serviceId}/config-redacted";
const META_TOOL_NAME = "mcp_agent_platform.describe_services";

type MetaReadTarget =
  | { kind: "action-manual" }
  | { kind: "workspace-summary" }
  | { kind: "services-index" }
  | { kind: "service-capabilities"; serviceId: string }
  | { kind: "service-config"; serviceId: string };

type DiscoverySnapshot = {
  workspaceId: string;
  displayName: string;
  generatedAt: string;
  stale: boolean;
  staleReason?: string;
  serviceCount: number;
  readyCount: number;
  errorCount: number;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  services: ServiceDiscoveryEntry[];
};

type ServiceDiscoverySummary = {
  id: string;
  label: string;
  kind: UpstreamConfig["kind"];
  status: "ready" | "error";
  error?: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  preferredEntry: "tool" | "resource" | "prompt" | "none";
  toolPrefix: string;
  detailUri: string;
  configUri: string;
  qualifiedToolExamples: string[];
};

type ServiceToolDiscovery = {
  name: string;
  qualifiedName: string;
  description?: string;
  inputSchema?: unknown;
};

type ServiceResourceDiscovery = {
  name: string;
  runtimeUri: string;
  upstreamUri: string;
  description?: string;
  mimeType?: string;
};

type ServicePromptDiscovery = {
  name: string;
  qualifiedName: string;
  description?: string;
  arguments?: WorkspaceUpstreamCapabilities["prompts"][number]["arguments"];
};

type RedactedUpstreamConfig = {
  kind: UpstreamConfig["kind"];
  enabled: boolean;
  summary: Record<string, unknown>;
};

type ServiceDiscoveryEntry = ServiceDiscoverySummary & {
  tools: ServiceToolDiscovery[];
  resources: ServiceResourceDiscovery[];
  prompts: ServicePromptDiscovery[];
  configRedacted: RedactedUpstreamConfig | null;
  recommendedUsage: {
    firstChoice: "tool" | "resource" | "prompt" | "none";
    notes: string[];
  };
};

export class DiscoveryCatalog {
  constructor(
    private readonly config: WorkspaceConfig,
    private readonly upstreams: UpstreamManager,
  ) {}

  getMetaToolDefinition(): ListToolsResult["tools"][number] {
    return {
      name: META_TOOL_NAME,
      description: "Describe configured services, their status, and the qualified tool names to call.",
      inputSchema: {
        type: "object",
        properties: {
          serviceId: {
            type: "string",
            description: "Optional service ID. When provided, only describe that one service.",
          },
          includeDetails: {
            type: "boolean",
            description: "Include full tool/resource/prompt details. Defaults to false.",
          },
          includeConfig: {
            type: "boolean",
            description: "Include the redacted service config summary. Defaults to false.",
          },
        },
      },
    };
  }

  isMetaTool(name: string): boolean {
    return name === META_TOOL_NAME;
  }

  async callMetaTool(args: Record<string, unknown> | undefined): Promise<CallToolResult> {
    const serviceId = typeof args?.serviceId === "string" ? args.serviceId.trim() : "";
    const includeDetails = args?.includeDetails === true;
    const includeConfig = args?.includeConfig === true;
    const snapshot = await this.getSnapshot();

    if (serviceId) {
      const service = snapshot.services.find((item) => item.id === serviceId);
      if (!service) {
        return {
          isError: true,
          content: [{ type: "text", text: `未知服务：${serviceId}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                workspaceId: snapshot.workspaceId,
                generatedAt: snapshot.generatedAt,
                stale: snapshot.stale,
                service: includeDetails ? toDetailedServicePayload(service, includeConfig) : toSummaryServicePayload(service),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              workspaceId: snapshot.workspaceId,
              displayName: snapshot.displayName,
              generatedAt: snapshot.generatedAt,
              stale: snapshot.stale,
              serviceCount: snapshot.serviceCount,
              readyCount: snapshot.readyCount,
              errorCount: snapshot.errorCount,
              toolCount: snapshot.toolCount,
              resourceCount: snapshot.resourceCount,
              promptCount: snapshot.promptCount,
              services: includeDetails
                ? snapshot.services.map((service) => toDetailedServicePayload(service, includeConfig))
                : snapshot.services.map((service) => toSummaryServicePayload(service)),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async listMetaResources(): Promise<ListResourcesResult["resources"]> {
    const snapshot = await this.getSnapshot();
    return [
      {
        uri: ACTION_MANUAL_URI,
        name: "Workspace Action Manual",
        description: "Preferred entrypoint for models: use callTool with the listed tool names and avoid probing upstream internals.",
        mimeType: "text/markdown",
      },
      {
        uri: WORKSPACE_SUMMARY_URI,
        name: "Workspace Summary",
        description: "High-level summary of this workspace and the current service health.",
        mimeType: "application/json",
      },
      {
        uri: SERVICES_INDEX_URI,
        name: "Service Index",
        description: "List all configured services, their status, and how to access them.",
        mimeType: "application/json",
      },
      ...snapshot.services.flatMap((service) => [
        {
          uri: service.detailUri,
          name: `${service.label} Capabilities`,
          description: `Detailed tools/resources/prompts for service ${service.id}.`,
          mimeType: "application/json",
        },
        {
          uri: service.configUri,
          name: `${service.label} Config (Redacted)`,
          description: `Safe configuration summary for service ${service.id}.`,
          mimeType: "application/json",
        },
      ]),
    ];
  }

  listMetaResourceTemplates(): ListResourceTemplatesResult["resourceTemplates"] {
    return [
      {
        uriTemplate: SERVICES_CAPABILITIES_TEMPLATE_URI,
        name: "Service Capabilities by ID",
        description: "Read the detailed capabilities for a service by service ID.",
        mimeType: "application/json",
      },
      {
        uriTemplate: SERVICES_CONFIG_TEMPLATE_URI,
        name: "Service Config by ID (Redacted)",
        description: "Read the redacted configuration summary for a service by service ID.",
        mimeType: "application/json",
      },
    ];
  }

  isMetaResourceUri(uri: string): boolean {
    try {
      return new URL(uri).protocol === META_URI_SCHEME;
    } catch {
      return false;
    }
  }

  async readMetaResource(uri: string): Promise<ReadResourceResult> {
    const target = parseMetaTarget(uri);
    if (!target) {
      throw new Error(`未知 discovery 资源：${uri}`);
    }

    const snapshot = await this.getSnapshot();

    switch (target.kind) {
      case "action-manual":
        return markdownResource(uri, renderActionManual(snapshot));
      case "workspace-summary":
        return jsonResource(uri, {
          workspaceId: snapshot.workspaceId,
          displayName: snapshot.displayName,
          generatedAt: snapshot.generatedAt,
          stale: snapshot.stale,
          staleReason: snapshot.staleReason,
          serviceCount: snapshot.serviceCount,
          readyCount: snapshot.readyCount,
          errorCount: snapshot.errorCount,
          toolCount: snapshot.toolCount,
          resourceCount: snapshot.resourceCount,
          promptCount: snapshot.promptCount,
        });
      case "services-index":
        return jsonResource(uri, {
          workspaceId: snapshot.workspaceId,
          displayName: snapshot.displayName,
          generatedAt: snapshot.generatedAt,
          stale: snapshot.stale,
          staleReason: snapshot.staleReason,
          services: snapshot.services.map((service) => toSummaryServicePayload(service)),
        });
      case "service-capabilities": {
        const service = snapshot.services.find((item) => item.id === target.serviceId);
        if (!service) throw new Error(`未知服务：${target.serviceId}`);
        return jsonResource(uri, {
          workspaceId: snapshot.workspaceId,
          generatedAt: snapshot.generatedAt,
          stale: snapshot.stale,
          staleReason: snapshot.staleReason,
          service: toDetailedServicePayload(service, false),
        });
      }
      case "service-config": {
        const service = snapshot.services.find((item) => item.id === target.serviceId);
        if (!service) throw new Error(`未知服务：${target.serviceId}`);
        return jsonResource(uri, {
          workspaceId: snapshot.workspaceId,
          generatedAt: snapshot.generatedAt,
          stale: snapshot.stale,
          staleReason: snapshot.staleReason,
          serviceId: service.id,
          config: service.configRedacted,
        });
      }
    }
  }

  private async getSnapshot(force = false): Promise<DiscoverySnapshot> {
    void force;
    return buildDiscoverySnapshot(this.config, {
      ...this.upstreams.getCachedWorkspaceCapabilities(),
      workspaceId: this.config.workspaceId,
    });
  }
}

function buildDiscoverySnapshot(config: WorkspaceConfig, capabilities: WorkspaceCapabilities): DiscoverySnapshot {
  const configMap = new Map(config.upstreams.filter((upstream) => upstream.enabled).map((upstream) => [upstream.id, upstream]));
  const services = capabilities.upstreams.map((service) => buildServiceEntry(service, configMap.get(service.upstreamId) ?? null));

  return {
    workspaceId: config.workspaceId,
    displayName: config.displayName,
    generatedAt: capabilities.generatedAt,
    stale: false,
    serviceCount: services.length,
    readyCount: services.filter((service) => service.status === "ready").length,
    errorCount: services.filter((service) => service.status === "error").length,
    toolCount: services.reduce((sum, service) => sum + service.toolCount, 0),
    resourceCount: services.reduce((sum, service) => sum + service.resourceCount, 0),
    promptCount: services.reduce((sum, service) => sum + service.promptCount, 0),
    services,
  };
}

function buildServiceEntry(service: WorkspaceUpstreamCapabilities, config: UpstreamConfig | null): ServiceDiscoveryEntry {
  const detailUri = buildServiceCapabilitiesUri(service.upstreamId);
  const configUri = buildServiceConfigUri(service.upstreamId);
  const tools = buildServiceToolEntries(service, config);
  const resources = service.resources.map((resource) => ({
    name: resource.name,
    runtimeUri: encodeResourceUri(service.upstreamId, resource.uri),
    upstreamUri: resource.uri,
    description: resource.description,
    mimeType: resource.mimeType,
  }));
  const prompts = service.prompts.map((prompt) => ({
    name: prompt.name,
    qualifiedName: prefixName(service.upstreamId, prompt.name),
    description: prompt.description,
    arguments: prompt.arguments,
  }));
  const preferredEntry = pickPreferredEntry(tools.length, resources.length, prompts.length);
  const toolPrefix = config?.cachedCapabilities?.toolExposures.length ? "" : `${service.upstreamId}.`;

  return {
    id: service.upstreamId,
    label: service.upstreamLabel,
    kind: service.upstreamKind,
    status: service.status,
    error: service.error,
    toolCount: tools.length,
    resourceCount: resources.length,
    promptCount: prompts.length,
    preferredEntry,
    toolPrefix,
    detailUri,
    configUri,
    qualifiedToolExamples: tools.slice(0, 3).map((tool) => tool.qualifiedName),
    tools,
    resources,
    prompts,
    configRedacted: config ? redactUpstreamConfig(config) : null,
    recommendedUsage: {
      firstChoice: preferredEntry,
      notes: buildRecommendedUsageNotes(service.upstreamId, preferredEntry, service.status),
    },
  };
}

function toSummaryServicePayload(service: ServiceDiscoveryEntry) {
  return {
    id: service.id,
    label: service.label,
    kind: service.kind,
    status: service.status,
    error: service.error,
    toolCount: service.toolCount,
    resourceCount: service.resourceCount,
    promptCount: service.promptCount,
    preferredEntry: service.preferredEntry,
    toolPrefix: service.toolPrefix,
    qualifiedToolExamples: service.qualifiedToolExamples,
    detailUri: service.detailUri,
    configUri: service.configUri,
  };
}

function toDetailedServicePayload(service: ServiceDiscoveryEntry, includeConfig: boolean) {
  return {
    ...toSummaryServicePayload(service),
    tools: service.tools,
    resources: service.resources,
    prompts: service.prompts,
    recommendedUsage: service.recommendedUsage,
    ...(includeConfig ? { configRedacted: service.configRedacted } : {}),
  };
}

function buildRecommendedUsageNotes(serviceId: string, preferredEntry: ServiceDiscoveryEntry["preferredEntry"], status: ServiceDiscoveryEntry["status"]): string[] {
  const notes = ["Use the listed tool names directly when calling tools."];
  if (preferredEntry === "resource") {
    notes.push("This service currently exposes resources but no tools.");
  }
  if (preferredEntry === "prompt") {
    notes.push("This service currently exposes prompts but no tools or resources.");
  }
  if (preferredEntry === "none") {
    notes.push("This service is connected but does not currently expose tools/resources/prompts.");
  }
  if (status === "error") {
    notes.push("Check the error field before relying on this service.");
  }
  return notes;
}

function buildServiceToolEntries(service: WorkspaceUpstreamCapabilities, config: UpstreamConfig | null): ServiceToolDiscovery[] {
  const toolsByName = new Map(service.tools.map((tool) => [tool.name, tool]));
  const exposures = config?.cachedCapabilities?.toolExposures ?? [];

  if (exposures.length > 0) {
    return exposures
      .filter((exposure) => exposure.enabled)
      .sort((left, right) => left.order - right.order || left.exposedName.localeCompare(right.exposedName))
      .flatMap((exposure) => {
        const tool = toolsByName.get(exposure.originalName);
        if (!tool) return [];
        return [
          {
            name: tool.name,
            qualifiedName: exposure.exposedName,
            description: tool.description,
            inputSchema: tool.inputSchema,
          },
        ];
      });
  }

  return service.tools.map((tool) => ({
    name: tool.name,
    qualifiedName: prefixName(service.upstreamId, tool.name),
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

function renderActionManual(snapshot: DiscoverySnapshot): string {
  const lines = [
    "# Workspace Action Manual",
    "",
    "请使用原生 callTool 调用以上工具，勿探测底层。",
    "",
  ];

  const servicesWithTools = snapshot.services.filter((service) => service.tools.length > 0);
  if (servicesWithTools.length === 0) {
    lines.push("当前缓存中没有可调用工具。");
    return lines.join("\n");
  }

  lines.push("## Cached Tools", "");
  for (const service of servicesWithTools) {
    lines.push(`### ${service.label} (${service.id})`);
    for (const tool of service.tools) {
      const description = tool.description?.trim() ? `: ${tool.description.trim()}` : "";
      lines.push(`- \`${tool.qualifiedName}\`${description}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function redactUpstreamConfig(config: UpstreamConfig): RedactedUpstreamConfig {
  switch (config.kind) {
    case "direct-http":
      return {
        kind: config.kind,
        enabled: config.enabled,
        summary: {
          url: config.url,
          headerNames: Object.keys(config.headers),
          headerCount: Object.keys(config.headers).length,
        },
      };
    case "local-stdio":
      return {
        kind: config.kind,
        enabled: config.enabled,
        summary: {
          command: config.command,
          cwd: config.cwd,
          envKeys: Object.keys(config.env),
          timeoutMs: config.timeoutMs,
          autoStart: config.autoStart,
        },
      };
    case "hosted-npm":
      return {
        kind: config.kind,
        enabled: config.enabled,
        summary: {
          packageName: config.packageName,
          packageVersion: config.packageVersion ?? null,
          binName: config.binName,
          args: config.args,
          cwd: config.cwd,
          envKeys: Object.keys(config.env),
          timeoutMs: config.timeoutMs,
          autoStart: config.autoStart,
        },
      };
    case "hosted-single-file":
      return {
        kind: config.kind,
        enabled: config.enabled,
        summary: {
          fileName: config.fileName,
          runtime: config.runtime,
          args: config.args,
          cwd: config.cwd,
          envKeys: Object.keys(config.env),
          timeoutMs: config.timeoutMs,
          autoStart: config.autoStart,
          sourceLineCount: config.source.split("\n").length,
        },
      };
  }
}

function pickPreferredEntry(toolCount: number, resourceCount: number, promptCount: number): ServiceDiscoverySummary["preferredEntry"] {
  if (toolCount > 0) return "tool";
  if (resourceCount > 0) return "resource";
  if (promptCount > 0) return "prompt";
  return "none";
}

function buildServiceCapabilitiesUri(serviceId: string): string {
  return `mcp-agent-meta://services/${encodeURIComponent(serviceId)}/capabilities`;
}

function buildServiceConfigUri(serviceId: string): string {
  return `mcp-agent-meta://services/${encodeURIComponent(serviceId)}/config-redacted`;
}

function parseMetaTarget(uri: string): MetaReadTarget | null {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== META_URI_SCHEME) return null;

    if (parsed.hostname === "workspace" && parsed.pathname === "/action-manual") {
      return { kind: "action-manual" };
    }

    if (parsed.hostname === "workspace" && parsed.pathname === "/summary") {
      return { kind: "workspace-summary" };
    }

    if (parsed.hostname !== "services") return null;
    if (parsed.pathname === "/index") {
      return { kind: "services-index" };
    }

    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    if (segments.length !== 2) return null;
    if (segments[1] === "capabilities") {
      return { kind: "service-capabilities", serviceId: segments[0] };
    }
    if (segments[1] === "config-redacted") {
      return { kind: "service-config", serviceId: segments[0] };
    }

    return null;
  } catch {
    return null;
  }
}

function jsonResource(uri: string, data: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function markdownResource(uri: string, text: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "text/markdown",
        text,
      },
    ],
  };
}
