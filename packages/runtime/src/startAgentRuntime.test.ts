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
      workspaceId: "demo",
      displayName: "演示工作区",
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
        },
        {
          id: "b",
          label: "B",
          kind: "direct-http",
          url: toolsOnlyUpstream.url,
          headers: {},
          enabled: true,
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
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(["a.echo", "a.sum", "b.echo"]);

      const echoA = await client.callTool({ name: "a.echo", arguments: { text: "hi" } });
      const echoAText = echoA.content.find((item) => item.type === "text");
      expect(echoAText && "text" in echoAText ? echoAText.text : "").toBe("a:echo:hi");

      const echoAResource = echoA.content.find((item) => item.type === "resource");
      expect(echoAResource && "resource" in echoAResource ? echoAResource.resource.uri : "").toMatch(/^mcp-agent:\/\/a\//);

      const echoB = await client.callTool({ name: "b.echo", arguments: { text: "world" } });
      const echoBText = echoB.content.find((item) => item.type === "text");
      expect(echoBText && "text" in echoBText ? echoBText.text : "").toBe("b:echo:world");

      const sumA = await client.callTool({ name: "a.sum", arguments: { a: 1, b: 2 } });
      const sumAText = sumA.content.find((item) => item.type === "text");
      expect(sumAText && "text" in sumAText ? sumAText.text : "").toBe("3");

      const resources = await client.listResources();
      expect(resources.resources).toHaveLength(1);
      expect(decodeResourceUri(resources.resources[0]!.uri)?.upstreamId).toBe("a");

      const read = await client.readResource({ uri: resources.resources[0]!.uri });
      expect(read.contents[0]?.text).toBe("resource content from a");
      expect(decodeResourceUri(read.contents[0]!.uri)?.upstreamId).toBe("a");

      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(["a.hello"]);

      const prompt = await client.getPrompt({ name: "a.hello", arguments: {} });
      const promptResource = prompt.messages.find((message) => message.content.type === "resource");
      expect(promptResource && "resource" in promptResource.content ? promptResource.content.resource.uri : "").toMatch(/^mcp-agent:\/\/a\//);
    } finally {
      await client.close();
    }
  });

  it("当所有 upstream 都只有 tools 时，不宣传 resources 和 prompts", async () => {
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
      expect(capabilities?.resources).toBeUndefined();
      expect(capabilities?.prompts).toBeUndefined();

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(["solo.echo"]);
    } finally {
      await client.close();
    }
  });
});

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
