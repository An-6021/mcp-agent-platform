# mcp-hub agent

一个面向 AI 编码工具的本地 MCP agent。

它通过 `stdio` 暴露给 Codex / Claude Code / OpenCode，同时从远程控制面拉取个性化配置，并在本地直连上游 MCP 服务。

当前发布内容只有本地 npm agent。

- 已有：
  - 本地 CLI agent
  - 仓库内配套的 control-plane API
  - 仓库内 Web 控制面板原型
- 还没有：
  - 完整后台管理系统
  - 面向生产的权限与审计能力

## 安装

```bash
npm install -g @sudau/mcp-hub
```

或直接使用：

```bash
npx -y @sudau/mcp-hub --base-url https://mcp.a1yu.com --workspace mcp-hub --token your-token
```

如果是给 Codex 接入，推荐直接使用 Codex 官方支持的 `stdio` 配置：

```bash
codex mcp add mcp-hub -- npx -y @sudau/mcp-hub --base-url https://mcp.a1yu.com --workspace mcp-hub --token your-token
```

或写入 `~/.codex/config.toml`：

```toml
[mcp_servers."mcp-hub"]
command = "npx"
args = ["-y", "@sudau/mcp-hub", "--base-url", "https://mcp.a1yu.com", "--workspace", "mcp-hub", "--token", "your-token"]
```

## 用法

推荐方式一：

```bash
mcp-hub --base-url https://mcp.a1yu.com --workspace mcp-hub --token your-token
```

推荐方式二：

```bash
mcp-hub --config-url https://mcp.a1yu.com/v1/workspaces/mcp-hub/config --workspace mcp-hub --token your-token
```

## 参数

- `--base-url`
  - 控制面基础地址，例如 `https://mcp.a1yu.com`
  - agent 会自动拼成 `https://mcp.a1yu.com/v1/workspaces/<workspace>/config`
- `--config-url`
  - 完整配置地址，优先级高于基础地址模式
- `--workspace`
  - 工作区 ID，同时作为本地缓存键
- `--token`
  - 直接传入 Bearer Token
- `--token-env`
  - 从指定环境变量读取 Bearer Token
- `--cache-dir`
  - 自定义缓存目录

## 环境变量

- `MCP_AGENT_BASE_URL`
- `MCP_AGENT_CONFIG_URL`
- `MCP_AGENT_WORKSPACE`
- `MCP_AGENT_TOKEN`
- `MCP_AGENT_TOKEN_ENV`
- `MCP_AGENT_CACHE_DIR`

## 行为说明

- 远程控制面可用时，优先拉取最新配置并刷新本地缓存
- 控制面暂时不可用时，会尝试回退到本地缓存
- agent 本身不承担统一中心中转流量，默认由本地直接连接上游 MCP 服务

## 当前范围

这个 npm 包只解决“本地接入层”。

如果你现在直接拿它来用，需要你自己提供一个控制面配置接口。最小接口只要返回工作区配置 JSON 即可。

如果你使用的是本仓库，建议先在项目根目录执行：

```bash
pnpm go
```

这会进入一个数字菜单，你可以按编号执行环境检测、本地运行或打包。

## License

MIT
