import { describe, expect, it } from "vitest";
import { parseAgentCliArgs } from "./cliOptions";

describe("parseAgentCliArgs", () => {
  it("支持完整 config-url 和 token-env", () => {
    const parsed = parseAgentCliArgs(
      ["--config-url", "https://mcp.a1yu.com/v1/workspaces/mcp-hub/config", "--workspace", "mcp-hub", "--token-env", "AGENT_TOKEN"],
      { AGENT_TOKEN: "secret" },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.options).toMatchObject({
      configUrl: "https://mcp.a1yu.com/v1/workspaces/mcp-hub/config",
      workspaceId: "mcp-hub",
      token: "secret",
    });
  });

  it("支持基础地址模式和旧参数别名", () => {
    const parsed = parseAgentCliArgs(
      ["--config-base-url", "https://mcp.a1yu.com", "--workspace", "mcp-hub"],
      {},
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.options).toMatchObject({
      configBaseUrl: "https://mcp.a1yu.com",
      workspaceId: "mcp-hub",
    });
  });

  it("缺少配置来源时返回明确错误", () => {
    const parsed = parseAgentCliArgs(["--workspace", "mcp-hub"], {});

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.exitCode).toBe(2);
    expect(parsed.message).toContain("必须提供 --config-url 或 --base-url");
  });
});
