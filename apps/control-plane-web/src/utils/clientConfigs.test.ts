import { describe, expect, it, vi } from "vitest";
import {
  buildClientConfigSnippets,
  buildExportClientConfigSnippets,
  findClientConfigSnippet,
  getExportConfigUrl,
  getWorkspaceConfigUrl,
} from "./clientConfigs";

function setupOrigin(origin: string) {
  vi.stubGlobal("window", {
    location: { origin },
  });
}

function expectNoHttpMcpConfig(content: string) {
  expect(content).not.toMatch(/\/v1\/workspaces\/[^"'\s\]]+\/(?:exports\/[^"'\s\]]+\/)?mcp(?=["'\s\]])/);
  expect(content).not.toContain("127.0.0.1:17890");
  expect(content).not.toMatch(/(^|\n)\s*url\s*=/);
  expect(content).not.toContain('"url"');
  expect(content).not.toContain('"type": "http"');
}

describe("clientConfigs", () => {
  it("工作区 TOML 和 JSON 都复制本地 stdio agent 配置", () => {
    setupOrigin("https://mcp.example.com");
    const snippets = buildClientConfigSnippets({
      workspaceId: "mcp-hub",
      token: "token-123",
    });

    const toml = findClientConfigSnippet(snippets, "toml", "npx");
    const json = findClientConfigSnippet(snippets, "json", "npx");

    expect(toml?.content).toContain('[mcp_servers."mcp-hub"]');
    expect(toml?.content).toContain('type = "stdio"');
    expect(toml?.content).toContain('command = "npx"');
    expect(toml?.content).toContain('"@a1ua/mcp-hub"');
    expect(toml?.content).toContain('"--base-url"');
    expect(toml?.content).toContain('"https://mcp.example.com"');
    expect(toml?.content).toContain('"--token"');
    expectNoHttpMcpConfig(toml?.content ?? "");

    const parsedJson = JSON.parse(json?.content ?? "{}");
    const server = parsedJson.mcpServers["mcp-hub"];
    expect(server.command).toBe("npx");
    expect(server.args).toEqual([
      "-y",
      "@a1ua/mcp-hub",
      "--base-url",
      "https://mcp.example.com",
      "--workspace",
      "mcp-hub",
      "--token",
      "token-123",
    ]);
    expectNoHttpMcpConfig(json?.content ?? "");
  });

  it("出口 TOML 和 JSON 使用 config-url，不复制远程 MCP HTTP 入口", () => {
    setupOrigin("https://mcp.example.com");
    const snippets = buildExportClientConfigSnippets({
      workspaceId: "mcp-hub",
      exportId: "ida-only",
      serverName: "ida-pro-mcp",
      token: "export-token",
    });

    const toml = findClientConfigSnippet(snippets, "toml", "shell");
    const json = findClientConfigSnippet(snippets, "json", "npx");

    expect(toml?.content).toContain('[mcp_servers."ida-pro-mcp"]');
    expect(toml?.content).toContain('type = "stdio"');
    expect(toml?.content).toContain('command = "/bin/sh"');
    expect(toml?.content).toContain("--config-url");
    expect(toml?.content).toContain("https://mcp.example.com/v1/workspaces/mcp-hub/exports/ida-only/config");
    expectNoHttpMcpConfig(toml?.content ?? "");

    const parsedJson = JSON.parse(json?.content ?? "{}");
    const server = parsedJson.mcpServers["ida-pro-mcp"];
    expect(server.command).toBe("npx");
    expect(server.args).toEqual([
      "-y",
      "@a1ua/mcp-hub",
      "--config-url",
      "https://mcp.example.com/v1/workspaces/mcp-hub/exports/ida-only/config",
      "--workspace",
      "ida-pro-mcp",
      "--token",
      "export-token",
    ]);
    expectNoHttpMcpConfig(json?.content ?? "");
  });

  it("只保留配置读取 URL，避免复制入口误用 /mcp 地址", () => {
    setupOrigin("https://mcp.example.com");

    expect(getWorkspaceConfigUrl("mcp-hub")).toBe("https://mcp.example.com/v1/workspaces/mcp-hub/config");
    expect(getExportConfigUrl("mcp-hub", "ida-only")).toBe(
      "https://mcp.example.com/v1/workspaces/mcp-hub/exports/ida-only/config",
    );
  });
});
