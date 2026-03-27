# MCP Agent Platform

一个从 0 开始的新项目，目标是把旧版桌面式 MCP Hub 收敛成两层：

- 本地 `stdio agent`：只向 AI 工具暴露一个 MCP 入口
- 远程 `control plane`：只负责下发个性化配置，不承担全量 MCP 调用流量

## 一阶段 MVP

只做下面几件事：

- 本地 agent 通过 `stdio` 对接 Codex / Claude Code / OpenCode
- agent 启动时从远程接口拉取工作区配置
- 配置支持两类上游：
  - `direct-http`
  - `local-stdio`
- 远程接口失败时使用本地缓存兜底

## 明确不做

- 不做统一中心 HTTP 中转
- 不做“同步到工具”写配置
- 不做多租户复杂权限和计费

## 目录

- `packages/shared`
  - 共享配置模型与映射工具
- `packages/runtime`
  - 聚合多个上游 MCP 的本地运行时
- `packages/agent`
  - 发布到 npm 的本地 CLI agent
- `apps/control-plane-api`
  - 远程配置下发服务
- `apps/control-plane-web`
  - Web 控制面板原型

## 补充文档

- `docs/architecture.md`
  - 项目整体架构与数据流
- `docs/control-plane-panel-draft.md`
  - 交给继任者的控制面板草案

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
pnpm --filter @mcp-agent-platform/agent exec mcp-agent-platform \
  --base-url http://127.0.0.1:3100 \
  --workspace demo \
  --token demo-token
```

如果后续要发布成 npm 包，推荐优先使用这两种接入方式：

```bash
npx mcp-agent-platform --base-url https://api.example.com --workspace demo --token-env MCP_AGENT_TOKEN
```

```bash
npx mcp-agent-platform --config-url https://api.example.com/v1/workspaces/demo/config --workspace demo --token-env MCP_AGENT_TOKEN
```

这里的 `base-url` 指“控制面 API 的根地址”，不是某个 MCP 服务地址。

例如：

- `--base-url https://api.example.com`
- `--workspace demo`

agent 最终会请求：

- `https://api.example.com/v1/workspaces/demo/config`

当前项目现在已经有：

- 本地 npm agent
- 远程控制面 API
- Web 控制面板原型
- 工作区草稿、发布、回滚、Token 轮换等基础流程

当前还没有：

- 完整权限体系
- 面向生产的后台安全与审计能力
- 更完整的自动化测试覆盖

## 首版验收

- 正常路径：本地 agent 能拉到远程配置，并向下游工具列出聚合后的工具
- 边界路径：远程配置接口不可用时，agent 能从缓存恢复，或给出明确错误
