import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { decodeResourceUri, type WorkspaceConfig } from "@mcp-agent-platform/shared";
import { launchAgentRuntime, type AgentRuntimeHandle } from "./startAgentRuntime";

type HttpUpstreamHandle = {
  url: string;
  close: () => Promise<void>;
};

const META_TOOL_NAME = "mcp_agent_platform_describe_services";
const ACTION_MANUAL_URI = "mcp-agent-meta://workspace/action-manual";
const SERVICE_INDEX_URI = "mcp-agent-meta://services/index";
const SERVICE_TEMPLATE_URI = "mcp-agent-meta://services/{serviceId}/capabilities";

let runtimeHandle: AgentRuntimeHandle | null = null;
let upstreamClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  if (runtimeHandle) {
    await runtimeHandle.close();
    runtimeHandle = null;
  }
  const closers = upstreamClosers;
  upstreamClosers = [];
  await Promise.allSettled(closers.map((close) => close()));
});

describe("launchAgentRuntime", () => {
  it("聚合多个 upstream 的工具并正确路由调用", async () => {
    const fullUpstream = await launchHttpUpstream(createFullFeaturedUpstream("a"));
    const toolsOnlyUpstream = await launchHttpUpstream(createToolsOnlyUpstream("b"));
    upstreamClosers.push(fullUpstream.close, toolsOnlyUpstream.close);

    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "mcp-hub",
      displayName: "mcp-hub",
      generatedAt: "2026-03-17T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "a",
          label: "A",
          kind: "direct-http",
          url: fullUpstream.url,
          headers: {},
          enabled: true,
          cachedCapabilities: createFullCachedCapabilities("a"),
        },
        {
          id: "b",
          label: "B",
          kind: "direct-http",
          url: toolsOnlyUpstream.url,
          headers: {},
          enabled: true,
          cachedCapabilities: createToolsOnlyCachedCapabilities("b"),
        },
      ],
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    runtimeHandle = await launchAgentRuntime(config, serverTransport);

    const client = new Client({ name: "runtime-test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const capabilities = client.getServerCapabilities();
      expect(capabilities?.tools).toBeTruthy();
      expect(capabilities?.resources).toBeTruthy();
      expect(capabilities?.prompts).toBeTruthy();

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["a_echo", "a_sum", "b_echo", META_TOOL_NAME]);

      const echoA = await client.callTool({ name: "a_echo", arguments: { text: "hi" } });
      const echoAText = echoA.content.find((item) => item.type === "text");
      expect(echoAText && "text" in echoAText ? echoAText.text : "").toBe("a:echo:hi");

      const echoAResource = echoA.content.find((item) => item.type === "resource");
      expect(echoAResource && "resource" in echoAResource ? echoAResource.resource.uri : "").toMatch(/^mcp-agent:\/\/a\//);

      const echoB = await client.callTool({ name: "b_echo", arguments: { text: "world" } });
      const echoBText = echoB.content.find((item) => item.type === "text");
      expect(echoBText && "text" in echoBText ? echoBText.text : "").toBe("b:echo:world");

      const sumA = await client.callTool({ name: "a_sum", arguments: { a: 1, b: 2 } });
      const sumAText = sumA.content.find((item) => item.type === "text");
      expect(sumAText && "text" in sumAText ? sumAText.text : "").toBe("3");

      const resources = await client.listResources();
      expect(resources.resources.some((resource) => resource.uri === ACTION_MANUAL_URI)).toBe(true);
      expect(resources.resources.some((resource) => resource.uri === SERVICE_INDEX_URI)).toBe(true);
      const upstreamResource = resources.resources.find((resource) => decodeResourceUri(resource.uri)?.upstreamId === "a");
      expect(upstreamResource).toBeTruthy();

      const read = await client.readResource({ uri: upstreamResource!.uri });
      expect(read.contents[0]?.text).toBe("resource content from a");
      expect(decodeResourceUri(read.contents[0]!.uri)?.upstreamId).toBe("a");

      const serviceIndex = await client.readResource({ uri: SERVICE_INDEX_URI });
      const serviceIndexPayload = parseReadResourceJson(serviceIndex);
      expect(serviceIndexPayload.services.map((service: { id: string }) => service.id)).toEqual(["a", "b"]);

      const actionManual = await client.readResource({ uri: ACTION_MANUAL_URI });
      const actionManualText = actionManual.contents.find((item) => "text" in item && typeof item.text === "string")?.text ?? "";
      expect(actionManualText).toContain("请使用原生 callTool 调用以上工具，勿探测底层。");
      expect(actionManualText).toContain("`a_echo`");

      const serviceTemplates = await client.listResourceTemplates();
      expect(serviceTemplates.resourceTemplates.map((item) => item.uriTemplate)).toContain(SERVICE_TEMPLATE_URI);

      const serviceOverview = await client.callTool({ name: META_TOOL_NAME, arguments: { includeDetails: true } });
      const overviewPayload = parseCallToolJson(serviceOverview);
      expect(overviewPayload.services).toHaveLength(2);
      expect(overviewPayload.services[0].tools[0].qualifiedName).toBe("a_echo");

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(["a.hello"]);

      const prompt = await client.getPrompt({ name: "a.hello", arguments: {} });
      const promptResource = prompt.messages.find((message) => message.content.type === "resource");
      expect(promptResource && "resource" in promptResource.content ? promptResource.content.resource.uri : "").toMatch(/^mcp-agent:\/\/a\//);
    } finally {
      await client.close();
    }
  });

  it("当所有 upstream 都只有 tools 时，仍提供 discovery resources", async () => {
    const toolsOnlyUpstream = await launchHttpUpstream(createToolsOnlyUpstream("solo"));
    upstreamClosers.push(toolsOnlyUpstream.close);

    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "tools-only",
      displayName: "Tools Only",
      generatedAt: "2026-03-17T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "solo",
          label: "Solo",
          kind: "direct-http",
          url: toolsOnlyUpstream.url,
          headers: {},
          enabled: true,
          cachedCapabilities: createToolsOnlyCachedCapabilities("solo"),
        },
      ],
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    runtimeHandle = await launchAgentRuntime(config, serverTransport);

    const client = new Client({ name: "runtime-tools-only-client", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const capabilities = client.getServerCapabilities();
      expect(capabilities?.tools).toBeTruthy();
      expect(capabilities?.resources).toBeTruthy();
      expect(capabilities?.prompts).toBeTruthy();

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([META_TOOL_NAME, "solo_echo"].sort());

      const resources = await client.listResources();
      expect(resources.resources.some((resource) => resource.uri === SERVICE_INDEX_URI)).toBe(true);

      const prompts = await client.listPrompts();
      expect(prompts.prompts).toEqual([]);

      const serviceDetail = await client.readResource({ uri: "mcp-agent-meta://services/solo/capabilities" });
      const serviceDetailPayload = parseReadResourceJson(serviceDetail);
      expect(serviceDetailPayload.service.tools.map((tool: { qualifiedName: string }) => tool.qualifiedName)).toEqual(["solo_echo"]);
    } finally {
      await client.close();
    }
  });

  it("兼容遗留 /sse 配置并自动回退到 /mcp", async () => {
    const fullUpstream = await launchHttpUpstream(createFullFeaturedUpstream("legacy"));
    upstreamClosers.push(fullUpstream.close);

    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "legacy-sse",
      displayName: "Legacy SSE",
      generatedAt: "2026-04-15T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "legacy",
          label: "Legacy",
          kind: "direct-http",
          url: fullUpstream.url.replace(/\/mcp$/, "/sse"),
          headers: {},
          enabled: true,
          cachedCapabilities: createFullCachedCapabilities("legacy"),
        },
      ],
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    runtimeHandle = await launchAgentRuntime(config, serverTransport);

    const client = new Client({ name: "runtime-legacy-sse-client", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["legacy_echo", "legacy_sum", META_TOOL_NAME].sort());

      const echo = await client.callTool({ name: "legacy_echo", arguments: { text: "fallback" } });
      const echoText = echo.content.find((item) => item.type === "text");
      expect(echoText && "text" in echoText ? echoText.text : "").toBe("legacy:echo:fallback");
    } finally {
      await client.close();
    }
  });

  it("支持单文件托管 upstream", async () => {
    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "hosted-file",
      displayName: "Hosted File",
      generatedAt: "2026-03-30T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "file",
          label: "File",
          kind: "hosted-single-file",
          fileName: "echo-server.mjs",
          runtime: "node",
          source: createHostedSingleFileSource(),
          args: [],
          cwd: null,
          env: {},
          timeoutMs: 30_000,
          autoStart: true,
          enabled: true,
          cachedCapabilities: createHostedFileCachedCapabilities(),
        },
      ],
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    runtimeHandle = await launchAgentRuntime(config, serverTransport);

    const client = new Client({ name: "runtime-hosted-file-client", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["file_echo", META_TOOL_NAME]);

      const echo = await client.callTool({ name: "file_echo", arguments: { text: "hello" } });
      const echoText = echo.content.find((item) => item.type === "text");
      expect(echoText && "text" in echoText ? echoText.text : "").toBe("hosted-file:hello");
    } finally {
      await client.close();
    }
  });

  it("上游离线时仍返回缓存能力，直到真实调用才触发连接", async () => {
    const config: WorkspaceConfig = {
      schemaVersion: 1,
      workspaceId: "offline-cache",
      displayName: "Offline Cache",
      generatedAt: "2026-04-13T00:00:00.000Z",
      cacheTtlSeconds: 300,
      upstreams: [
        {
          id: "offline",
          label: "Offline",
          kind: "direct-http",
          url: "http://127.0.0.1:9/mcp",
          headers: {},
          enabled: true,
          cachedCapabilities: {
            generatedAt: "2026-04-13T00:00:00.000Z",
            status: "ready",
            error: null,
            tools: [
              {
                name: "echo",
                description: "Echo from cache",
                inputSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
              },
            ],
            resources: [
              {
                uri: "resource://cached",
                name: "cached",
                description: "cached resource",
                mimeType: "text/plain",
              },
            ],
            prompts: [],
            toolExposures: [
              {
                originalName: "echo",
                exposedName: "offline_echo",
                enabled: true,
                order: 0,
                strategy: "default",
              },
            ],
          },
        },
      ],
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    runtimeHandle = await launchAgentRuntime(config, serverTransport);

    const client = new Client({ name: "runtime-offline-cache-client", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([META_TOOL_NAME, "offline_echo"].sort());

      const resources = await client.listResources();
      const upstreamResource = resources.resources.find((resource) => decodeResourceUri(resource.uri)?.upstreamId === "offline");
      expect(upstreamResource).toBeTruthy();

      const echo = await client.callTool({ name: "offline_echo", arguments: { text: "hi" } });
      expect(echo.isError).toBe(true);

      await expect(client.readResource({ uri: upstreamResource!.uri })).rejects.toThrow();
    } finally {
      await client.close();
    }
  });
});

function parseReadResourceJson(result: Awaited<ReturnType<Client["readResource"]>>) {
  const text = result.contents.find((content) => "text" in content && typeof content.text === "string")?.text;
  if (!text) {
    throw new Error("resource result does not contain JSON text");
  }
  return JSON.parse(text) as Record<string, any>;
}

function parseCallToolJson(result: Awaited<ReturnType<Client["callTool"]>>) {
  const text = result.content.find((content) => content.type === "text" && "text" in content)?.text;
  if (!text) {
    throw new Error("tool result does not contain JSON text");
  }
  return JSON.parse(text) as Record<string, any>;
}

function createFullCachedCapabilities(serverId: string) {
  return {
    generatedAt: "2026-03-17T00:00:00.000Z",
    status: "ready" as const,
    error: null,
    tools: [
      {
        name: "echo",
        description: "Echo back input text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      {
        name: "sum",
        description: "Sum two numbers",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
      },
    ],
    resources: [
      {
        uri: "resource://foo",
        name: "foo",
        description: `resource foo from ${serverId}`,
        mimeType: "text/plain",
      },
    ],
    prompts: [
      {
        name: "hello",
        description: `prompt hello from ${serverId}`,
      },
    ],
    toolExposures: [
      {
        originalName: "echo",
        exposedName: `${serverId}_echo`,
        enabled: true,
        order: 0,
        strategy: "default" as const,
      },
      {
        originalName: "sum",
        exposedName: `${serverId}_sum`,
        enabled: true,
        order: 1,
        strategy: "default" as const,
      },
    ],
  };
}

function createToolsOnlyCachedCapabilities(serverId: string) {
  return {
    generatedAt: "2026-03-17T00:00:00.000Z",
    status: "ready" as const,
    error: null,
    tools: [
      {
        name: "echo",
        description: "Echo back input text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ],
    resources: [],
    prompts: [],
    toolExposures: [
      {
        originalName: "echo",
        exposedName: `${serverId}_echo`,
        enabled: true,
        order: 0,
        strategy: "default" as const,
      },
    ],
  };
}

function createHostedFileCachedCapabilities() {
  return {
    generatedAt: "2026-03-30T00:00:00.000Z",
    status: "ready" as const,
    error: null,
    tools: [
      {
        name: "echo",
        description: "Echo text from hosted file",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ],
    resources: [],
    prompts: [],
    toolExposures: [
      {
        originalName: "echo",
        exposedName: "file_echo",
        enabled: true,
        order: 0,
        strategy: "default" as const,
      },
    ],
  };
}

function createFullFeaturedUpstream(serverId: string): Server {
  const server = new Server(
    { name: `full-upstream-${serverId}`, version: "0.0.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo back input text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      {
        name: "sum",
        description: "Sum two numbers",
        inputSchema: {
          type: "object",
          properties: { a: { type: "number" }, b: { type: "number" } },
          required: ["a", "b"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "echo") {
      const text = typeof request.params.arguments?.text === "string" ? request.params.arguments.text : "";
      return {
        content: [
          { type: "text", text: `${serverId}:echo:${text}` },
          {
            type: "resource",
            resource: {
              uri: "resource://foo",
              mimeType: "text/plain",
              text: `from ${serverId}`,
            },
          },
        ],
      };
    }

    if (request.params.name === "sum") {
      const a = typeof request.params.arguments?.a === "number" ? request.params.arguments.a : 0;
      const b = typeof request.params.arguments?.b === "number" ? request.params.arguments.b : 0;
      return {
        content: [{ type: "text", text: String(a + b) }],
      };
    }

    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${request.params.name}` }],
    };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "resource://foo",
        name: "foo",
        description: `resource foo from ${serverId}`,
        mimeType: "text/plain",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: `resource content from ${serverId}`,
      },
    ],
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: "hello", description: `prompt hello from ${serverId}` }],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async () => ({
    description: `hello from ${serverId}`,
    messages: [
      {
        role: "assistant",
        content: { type: "text", text: `${serverId}:prompt:hello` },
      },
      {
        role: "assistant",
        content: {
          type: "resource",
          resource: {
            uri: "resource://foo",
            mimeType: "text/plain",
            text: `from ${serverId}`,
          },
        },
      },
    ],
  }));

  return server;
}

function createToolsOnlyUpstream(serverId: string): Server {
  const server = new Server(
    { name: `tools-only-upstream-${serverId}`, version: "0.0.0" },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echo back input text",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const text = typeof request.params.arguments?.text === "string" ? request.params.arguments.text : "";
    return {
      content: [{ type: "text", text: `${serverId}:echo:${text}` }],
    };
  });

  return server;
}

function createHostedSingleFileSource(): string {
  return `
import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "hosted-file-upstream", version: "0.0.0" },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: "Echo text from hosted file",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const text = typeof request.params.arguments?.text === "string" ? request.params.arguments.text : "";
  return {
    content: [{ type: "text", text: \`hosted-file:\${text}\` }],
  };
});

await server.connect(new StdioServerTransport());
`;
}

async function launchHttpUpstream(server: Server): Promise<HttpUpstreamHandle> {
  const port = await getFreePort();
  const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

  const httpServer = createHttpServer(async (request, response) => {
    try {
      if (request.url !== "/mcp") {
        response.statusCode = 404;
        response.end();
        return;
      }

      const parsedBody = request.method === "POST" ? await readRequestBody(request) : undefined;
      const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;

      if (!sessionId) {
        if (
          request.method === "POST" &&
          parsedBody &&
          typeof parsedBody === "object" &&
          (parsedBody as { method?: unknown }).method === "initialize"
        ) {
          const transport = new StreamableHTTPServerTransport({
            enableJsonResponse: true,
            sessionIdGenerator: () => randomUUID(),
          });
          await server.connect(transport);
          await transport.handleRequest(request, response, parsedBody);
          if (transport.sessionId) {
            sessions.set(transport.sessionId, { server, transport });
          }
          return;
        }

        writeJsonRpcError(response, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
        return;
      }

      const session = sessions.get(sessionId);
      if (!session) {
        writeJsonRpcError(response, 404, -32001, "Session not found");
        return;
      }

      await session.transport.handleRequest(request, response, parsedBody);
      if (request.method === "DELETE") {
        sessions.delete(sessionId);
      }
    } catch (error) {
      response.statusCode = 500;
      response.end(String(error instanceof Error ? error.message : error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await Promise.allSettled([...sessions.values()].map(({ transport }) => transport.close()));
      await server.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJsonRpcError(response: ServerResponse, status: number, code: number, message: string) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("unexpected address"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
