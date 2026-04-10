# Architecture

## 1. 目标

当前项目的核心目标已经收敛为两层：

- 本地 `stdio agent`
  - 作为 AI 工具唯一连接入口
- 远程控制面
  - 提供 MCP 来源聚合配置
  - 不承担统一 MCP 调用中转

在控制面方向上，当前更适合按“自用 MCP 聚合控制台”理解，而不是按企业后台或多租户平台理解。

## 2. 当前产品定位

项目当前最重要的三类能力是：

1. MCP 来源聚合
   - 接入多个 MCP 来源
   - 支持远程 HTTP、本地 stdio、托管 npm、托管单文件
2. 工具暴露层
   - 对探测到的工具做统一命名、筛选和对外暴露
3. 部分来源托管运行
   - 对 hosted 类型来源进行启动、停止、重启和日志查看

因此，控制面文档和后续实现都应围绕三层模型展开：

- `Sources`
- `Tools`
- `Hosted`

## 3. 核心模块

### `packages/agent`

职责：

- 以 `stdio` 方式启动
- 成为 AI 工具侧唯一 MCP 入口
- 拉取远程配置或读取本地缓存
- 调用 `runtime` 暴露聚合后的 MCP 能力

### `packages/runtime`

职责：

- 连接多个上游 MCP 来源
- 聚合 tools/resources/prompts
- 处理名称前缀、能力探测和调用路由
- 承接部分 hosted 来源的本地运行接入

### `apps/control-plane-api`

职责：

- 提供配置下发接口
- 提供自用控制台所需的管理接口
- 维护来源配置、能力探测缓存、工具暴露映射、托管运行状态

### `apps/control-plane-web`

职责：

- 提供一个轻量自用控制台
- 主要页面收敛为：Sources / Tools / Hosted

### `packages/shared`

职责：

- 共享 schema、类型和映射逻辑
- 为 agent / runtime / api / web 提供统一数据契约

## 4. 数据流

### 配置下发主链路

1. AI 工具启动本地 `mcp-agent-platform`
2. agent 读取远程控制面配置或本地缓存
3. agent 将配置交给 runtime
4. runtime 连接上游 MCP 来源并对外暴露一个统一入口

### 控制台主链路

1. 在 Sources 中维护 MCP 来源
2. 控制面刷新并缓存来源能力
3. 在 Tools 中决定哪些工具被最终暴露
4. 对 hosted 来源在 Hosted 页面中执行启动、停止、重启和日志查看

## 5. 当前明确不做

当前阶段不做：

- 多租户后台体系
- 组织、团队、计费
- 重型权限系统
- 统一 HTTP MCP 流量中转平台
- 大而全的审计与运维平台
- 复杂版本快照体系作为主设计中心

## 6. 推荐阅读

- `docs/product.md`
  - 控制台产品设计
- `docs/data-api.md`
  - 前后端数据模型与 API 设计稿
- `docs/todo.md`
  - 当前实现待办
