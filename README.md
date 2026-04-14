# mcp-hub

一个从 0 开始的新项目，目标是把旧版桌面式控制台收敛成两层：

- 本地 `stdio agent`：只向 AI 工具暴露一个 MCP 入口
- 远程 `control plane`：负责 MCP 来源配置、工具暴露编排和部分托管能力

## 当前方向

当前项目更适合按“自用 MCP 聚合控制台”理解，而不是按企业后台理解。

控制面的核心目标已经收敛为三件事：

- 各个渠道的 MCP 来源聚合
- 工具暴露层编排
- 部分 MCP 来源托管运行

## 一阶段 MVP

只做下面几件事：

- 本地 agent 通过 `stdio` 对接 Codex / Claude Code / OpenCode
- agent 启动时从远程接口拉取聚合配置
- 配置支持四类上游：
  - `direct-http`
  - `local-stdio`
  - `hosted-npm`
  - `hosted-single-file`
- 远程接口失败时使用本地缓存兜底
- 控制面围绕 `Sources / Tools / Hosted` 三层收敛

## 明确不做

- 不做统一中心 HTTP 中转
- 不做“同步到工具”写配置
- 不做多租户复杂权限和计费
- 不做以 workspace 快照、回滚、后台审批为中心的重后台体系

## 目录

- `packages/shared`
  - 共享配置模型与映射工具
- `packages/runtime`
  - 聚合多个上游 MCP 的本地运行时
- `packages/agent`
  - 发布到 npm 的本地 CLI agent
- `apps/control-plane-api`
  - 控制面 API 与自用控制台后端
- `apps/control-plane-web`
  - 自用 MCP 聚合控制台前端

## 文档

- `docs/architecture.md`
  - 当前整体架构与主链路
- `docs/product.md`
  - 控制台产品设计
- `docs/data-api.md`
  - 前后端数据模型与 API 设计稿
- `docs/todo.md`
  - 当前实现待办

## 快速开始

```bash
pnpm go
```

如果你只想先做环境体检：

```bash
pnpm ok
```

如果你想直接本地运行：

```bash
pnpm dev
```

`pnpm go` 会进入数字菜单，你可以直接输入编号：

- `1` 环境检测
- `2` 本地运行
- `3` 执行打包

环境检测时如果缺少依赖，会自动执行安装，不再单独提供“安装依赖”或“全部执行”入口。

旧的 `pnpm bootstrap` 也还保留着，但现在更推荐 `pnpm go / pnpm ok / pnpm dev`。

启动控制面：

```bash
pnpm dev:api
```

启动 Web 控制面板：

```bash
pnpm dev:web
```

手动启动本地 agent：

```bash
pnpm --filter ./packages/agent exec mcp-hub \
  --base-url https://mcp.a1yu.com \
  --workspace mcp-hub \
  --token your-token
```

按 Codex 官方习惯接入，优先使用本地 `stdio` agent：

```bash
codex mcp add mcp-hub -- npx -y @sudau/mcp-hub --base-url https://mcp.a1yu.com --workspace mcp-hub --token your-token
```

对应的 `~/.codex/config.toml` 可写成：

```toml
[mcp_servers."mcp-hub"]
command = "npx"
args = ["-y", "@sudau/mcp-hub", "--base-url", "https://mcp.a1yu.com", "--workspace", "mcp-hub", "--token", "your-token"]
```

如果后续要发布成 npm 包，推荐优先使用这两种接入方式：

```bash
npx -y @sudau/mcp-hub --base-url https://mcp.a1yu.com --workspace mcp-hub --token your-token
```

```bash
npx -y @sudau/mcp-hub --config-url https://mcp.a1yu.com/v1/workspaces/mcp-hub/config --workspace mcp-hub --token your-token
```

这里的 `base-url` 指“控制面 API 的根地址”，不是某个 MCP 服务地址。

例如：

- `--base-url https://mcp.a1yu.com`
- `--workspace mcp-hub`

agent 最终会请求：

- `https://mcp.a1yu.com/v1/workspaces/mcp-hub/config`

## 当前已有能力

- 本地 npm agent
- 远程控制面 API
- 自用控制台原型
- 四类上游来源：
  - `direct-http`
  - `local-stdio`
  - `hosted-npm`
  - `hosted-single-file`
- 托管型来源的基础接入能力
- runtime 侧的聚合与统一暴露基础能力

## 当前待补能力

- `Sources / Tools / Hosted` 三层控制面的完整收口
- 更完善的自动化测试覆盖
- hosted 来源的更稳定状态管理与日志体验
- 最终工具暴露视图与冲突处理体验

## 首版验收

- 正常路径：本地 agent 能拉到远程配置，并向下游工具列出聚合后的工具
- 控制面路径：能维护来源、刷新能力、控制工具暴露、启动或停止托管来源
- 边界路径：远程配置接口不可用时，agent 能从缓存恢复，或给出明确错误
