import { describe, expect, it } from "vitest";
import { parseAgentCliArgs } from "./cliOptions";

describe("parseAgentCliArgs", () => {
  it("支持完整 config-url 和 token-env", () => {
    const parsed = parseAgentCliArgs(
      ["--config-url", "https://api.example.com/v1/workspaces/demo/config", "--workspace", "demo", "--token-env", "AGENT_TOKEN"],
      { AGENT_TOKEN: "secret" },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.options).toMatchObject({
      configUrl: "https://api.example.com/v1/workspaces/demo/config",
      workspaceId: "demo",
      token: "secret",
    });
  });

  it("支持基础地址模式和旧参数别名", () => {
    const parsed = parseAgentCliArgs(
      ["--config-base-url", "http://127.0.0.1:3100", "--workspace", "demo"],
      {},
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.options).toMatchObject({
      configBaseUrl: "http://127.0.0.1:3100",
      workspaceId: "demo",
    });
  });

  it("缺少配置来源时返回明确错误", () => {
    const parsed = parseAgentCliArgs(["--workspace", "demo"], {});

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;

    expect(parsed.exitCode).toBe(2);
    expect(parsed.message).toContain("必须提供 --config-url 或 --base-url");
  });
});

