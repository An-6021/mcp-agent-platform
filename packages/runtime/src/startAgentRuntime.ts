import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type GetPromptRequest,
  type ReadResourceRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { WorkspaceConfig } from "@mcp-agent-platform/shared";
import { DiscoveryCatalog } from "./discoveryCatalog";
import { UpstreamManager } from "./upstreamManager";

export type AgentRuntimeHandle = {
  close: () => Promise<void>;
};

export async function launchAgentRuntime(config: WorkspaceConfig, transport: Transport): Promise<AgentRuntimeHandle> {
  const upstreams = new UpstreamManager(config.upstreams);
  await upstreams.initialize();
  const discoveryCatalog = new DiscoveryCatalog(config, upstreams);
  const capabilities = {
    ...upstreams.getRuntimeCapabilities(),
    resources: { listChanged: true as const },
  };

  const server = new Server(
    { name: `mcp-agent-${config.workspaceId}`, version: "0.1.0" },
    {
      capabilities,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [discoveryCatalog.getMetaToolDefinition(), ...(await upstreams.listTools())],
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...(await discoveryCatalog.listMetaResources()), ...(await upstreams.listResources())],
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: discoveryCatalog.listMetaResourceTemplates(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request: ReadResourceRequest) => {
    if (discoveryCatalog.isMetaResourceUri(request.params.uri)) {
      return await discoveryCatalog.readMetaResource(request.params.uri);
    }
    return await upstreams.readResource(request.params.uri);
  });

  if (capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: await upstreams.listPrompts(),
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (request: GetPromptRequest) => {
      return await upstreams.getPrompt(request.params.name, request.params.arguments);
    });
  }

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    if (discoveryCatalog.isMetaTool(request.params.name)) {
      return await discoveryCatalog.callMetaTool(request.params.arguments);
    }
    return await upstreams.callTool(request.params.name, request.params.arguments);
  });

  await server.connect(transport);

  return {
    close: async () => {
      await upstreams.closeAll();
      await server.close();
    },
  };
}

export async function startAgentRuntime(config: WorkspaceConfig): Promise<AgentRuntimeHandle> {
  return await launchAgentRuntime(config, new StdioServerTransport());
}

export async function runAgentRuntime(config: WorkspaceConfig): Promise<void> {
  const handle = await startAgentRuntime(config);
  await waitForSignals();
  await handle.close();
}

function waitForSignals(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}
