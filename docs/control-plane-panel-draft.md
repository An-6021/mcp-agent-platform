# 控制面板草案

## 1. 文档目的

这份文档不是产品终稿，而是交给继任者的实现草案。

目标只有一个：

- 在不改变当前项目主路线的前提下，为 `control plane` 补一套最小可用的 Web 配置面板与后台管理接口。

这里的“主路线”指：

- 用户侧仍然只配置本地 `npm agent`
- 远程服务仍然只负责下发工作区配置
- 不做统一 HTTP MCP 中转
- 不做“同步到工具”写本机配置

## 2. 本草案基于哪些现状

这份草案在编写前，已经对当前代码做了最小必要检索，检索方式包括：

- `fast-context.fast_context_search`
- `rg`
- `sed`

重点对照了下面这些文件：

- `README.md`
- `docs/architecture.md`
- `packages/shared/src/config.ts`
- `apps/control-plane-api/src/server.ts`
- `apps/control-plane-api/data/demo.json`

因此，下面的设计会严格对齐当前真实能力，而不是假设项目已经有完整后台。

## 3. 当前实现事实基线

### 3.1 已经有的东西

- 一个本地 `stdio` agent，已发布 npm 包 `mcp-agent-platform`
- 一个最小 `control-plane-api`
- 一个共享配置模型 `WorkspaceConfig`
- 一个对外配置下发接口：
  - `GET /v1/workspaces/:workspaceId/config`

### 3.2 当前接口的真实行为

当前 `control-plane-api` 的行为非常简单：

- 从 `apps/control-plane-api/data/<workspaceId>.json` 读取配置
- 用 `packages/shared/src/config.ts` 里的 `WorkspaceConfigSchema` 校验
- 如果设置了 `workspaceTokens`，就校验 Bearer Token
- 返回配置 JSON

### 3.3 当前配置模型

当前公开配置只关心这几个字段：

- `schemaVersion`
- `workspaceId`
- `displayName`
- `generatedAt`
- `cacheTtlSeconds`
- `upstreams`

当前上游只支持两类：

- `direct-http`
- `local-stdio`

### 3.4 当前明确还没有

- Web 配置面板
- 完整后台管理 API
- 数据库存储
- 配置草稿与发布历史
- 内建后台登录鉴权
- Token 的持久化管理界面

其中有一个很重要的现实约束：

- 当前工作区 Token 只来自进程启动时传入的 `MCP_CONTROL_PLANE_TOKENS`

这意味着：

- 就算先把 Web 面板做出来，如果后端不先补“Token 持久化能力”，Token 管理也无法真正闭环。

## 4. 控制面板要解决什么问题

首版控制面板建议只解决下面四件事：

1. 让内部管理员能创建和维护工作区。
2. 让管理员能配置这个工作区要下发哪些上游 MCP。
3. 让管理员能预览最终下发给 agent 的 JSON。
4. 让管理员能显式“发布”配置，而不是每次修改都直接影响线上读取。

换句话说，面板的本质不是“运营系统”，而是：

- 一个围绕 `workspace config` 的编辑器和发布器。

## 5. 明确不做

为了避免首版膨胀，建议明确不做下面这些：

- 不做统一 MCP 流量中继
- 不做用户本机工具配置自动写入
- 不做复杂 RBAC
- 不做团队、组织、计费
- 不做审计日志大而全方案
- 不做配置 diff 可视化高级能力
- 不做实时协同编辑

如果要加，也应放到二阶段以后。

## 6. 目标用户与使用场景

### 6.1 首版目标用户

- 平台管理员
- 内部运维或实施人员

首版不建议一开始就面向终端普通用户开放。

### 6.2 典型使用场景

场景 A：新建工作区

- 管理员创建 `workspace`
- 配置展示名、缓存时间、上游列表
- 生成或录入访问 Token
- 发布后，把 `workspaceId` 和 Token 交给用户
- 用户本机只需要配置 `npx mcp-agent-platform --base-url ... --workspace ...`

场景 B：调整某个工作区的上游服务

- 管理员进入工作区详情页
- 修改 `upstreams`
- 先预览最终 JSON
- 确认后发布
- 新启动的 agent 拉到新配置

场景 C：排查连接问题

- 管理员查看该工作区当前发布版本
- 查看 Token 是否存在
- 查看配置 JSON 是否符合 Schema
- 必要时回滚到上一版发布快照

## 7. 信息架构草案

首版不需要复杂首页，建议直接以“工作区列表”作为主入口。

### 7.1 页面结构

- `/workspaces`
  - 工作区列表页
- `/workspaces/:workspaceId`
  - 工作区详情页
- `/workspaces/:workspaceId/edit`
  - 工作区编辑页
- `/workspaces/:workspaceId/snapshots`
  - 发布快照页

### 7.2 列表页应展示的关键信息

- `workspaceId`
- `displayName`
- 最近发布时间
- 上游数量
- Token 状态
- 最近一次发布结果

### 7.3 详情页建议拆成 5 个区块

1. 基本信息
   - `workspaceId`
   - `displayName`
   - `cacheTtlSeconds`
2. Token 管理
   - 是否已设置
   - 最近轮转时间
   - 重新生成 Token
3. 上游列表
   - 上游名称
   - 类型
   - 启用状态
4. 配置预览
   - 当前草稿 JSON
   - 当前已发布 JSON
5. 发布区
   - 保存草稿
   - 校验
   - 发布
   - 回滚

### 7.4 一个足够简单的交互原则

首版建议采用下面的状态模型：

- 草稿可反复编辑
- 只有点击“发布”才会更新线上配置
- Agent 拉取的永远是“已发布配置”，不是草稿

这个原则非常重要，因为它能让面板的编辑体验和当前 `GET /config` 的读取逻辑自然衔接。

## 8. 页面草图文字版

### 8.1 工作区列表页

建议布局：

- 顶部：搜索框、新建工作区按钮
- 中部：工作区表格
- 右侧或行内操作：查看、编辑、复制启动命令

每一行建议有一个“快速复制”按钮，直接生成类似命令：

```bash
npx mcp-agent-platform --base-url https://api.example.com --workspace demo --token-env MCP_AGENT_TOKEN
```

### 8.2 工作区编辑页

建议分 3 段：

- 基本信息表单
- 上游编辑器
- JSON 预览与发布区

其中上游编辑器需要支持：

- 新增上游
- 删除上游
- 排序
- 启用/停用
- 按不同 `kind` 渲染不同字段

`direct-http` 字段：

- `id`
- `label`
- `url`
- `headers`
- `enabled`

`local-stdio` 字段：

- `id`
- `label`
- `command`
- `cwd`
- `env`
- `timeoutMs`
- `autoStart`
- `enabled`

### 8.3 Token 管理区

建议首版只做下面几件事：

- 展示“已设置 / 未设置”
- 支持生成新 Token
- 支持手动覆盖 Token
- 默认不回显明文旧 Token
- 生成后只展示一次，并提示管理员自行保存

## 9. 数据模型草案

这里建议明确区分“后台编辑对象”和“下发给 agent 的公开配置对象”。

### 9.1 为什么要分层

当前 `WorkspaceConfigSchema` 是 agent 侧消费契约。

不建议直接把后台草稿状态、发布人、备注、快照信息等字段硬塞进这个 Schema，因为那会污染 agent 侧协议。

更稳妥的做法是：

- 后台维护自己的管理模型
- 发布时把管理模型渲染成 `WorkspaceConfig`

### 9.2 建议的后台实体

#### `Workspace`

建议字段：

- `id`
- `displayName`
- `description`
- `status`
- `cacheTtlSeconds`
- `createdAt`
- `updatedAt`

#### `WorkspaceToken`

建议字段：

- `workspaceId`
- `tokenHash`
- `tokenPreview`
- `createdAt`
- `rotatedAt`

说明：

- 不建议明文持久化 Token
- 面板只展示前后缀预览，例如 `mcp_****9af`

#### `WorkspaceDraft`

建议字段：

- `workspaceId`
- `displayName`
- `cacheTtlSeconds`
- `upstreams`
- `updatedAt`
- `updatedBy`

#### `PublishedConfigSnapshot`

建议字段：

- `workspaceId`
- `version`
- `publishedAt`
- `publishedBy`
- `config`
- `note`

其中 `config` 必须严格符合当前 `WorkspaceConfigSchema`。

### 9.3 与当前文件存储的映射建议

为了兼容当前实现，首版可以继续基于文件存储，但不要把“直接读写文件”散落在路由里。

建议先抽一个存储层接口，例如：

```ts
type WorkspaceRepository = {
  list(): Promise<Workspace[]>;
  getWorkspace(id: string): Promise<Workspace | null>;
  getDraft(id: string): Promise<WorkspaceDraft | null>;
  saveDraft(draft: WorkspaceDraft): Promise<void>;
  getPublishedConfig(id: string): Promise<WorkspaceConfig | null>;
  publish(id: string, input: PublishInput): Promise<PublishedConfigSnapshot>;
  rotateToken(id: string, token: string): Promise<void>;
};
```

MVP 可以先用文件实现这个仓储层，后续换数据库时不动面板交互层。

### 9.4 文件存储建议目录

首版如果继续用文件，建议整理成类似结构：

```text
apps/control-plane-api/data/
  workspaces/
    demo/
      workspace.json
      draft.json
      published.json
      snapshots/
        2026-03-19T10-00-00.000Z.json
  tokens.json
```

说明：

- `published.json` 可直接作为 `GET /v1/workspaces/:workspaceId/config` 的读取目标
- `draft.json` 只给后台使用
- `tokens.json` 是过渡方案，后续可替换为数据库或密钥服务

如果继任者想保持现有兼容，也可以继续保留：

```text
apps/control-plane-api/data/<workspaceId>.json
```

但建议只把它当作“发布产物”，不要同时承载后台草稿。

## 10. 后台 API 草案

建议把后台接口和 agent 拉配置接口分开。

### 10.1 保持不变的公开接口

继续保留：

- `GET /v1/workspaces/:workspaceId/config`

这是 agent 的消费接口，尽量保持稳定。

### 10.2 新增后台接口

建议新增一组 `/admin` 或 `/internal` 前缀接口。

最小集合如下：

- `GET /admin/workspaces`
  - 返回工作区列表
- `POST /admin/workspaces`
  - 创建工作区
- `GET /admin/workspaces/:workspaceId`
  - 返回工作区详情
- `PUT /admin/workspaces/:workspaceId/draft`
  - 保存草稿
- `POST /admin/workspaces/:workspaceId/publish`
  - 发布草稿为线上配置
- `GET /admin/workspaces/:workspaceId/snapshots`
  - 返回发布历史
- `POST /admin/workspaces/:workspaceId/rollback`
  - 回滚到指定快照
- `POST /admin/workspaces/:workspaceId/token/rotate`
  - 生成或替换 Token

### 10.3 后台接口返回结构建议

首版不必设计过重，保持统一即可：

```json
{
  "data": {},
  "error": null
}
```

或失败时：

```json
{
  "data": null,
  "error": {
    "code": "workspace_not_found",
    "message": "工作区不存在"
  }
}
```

### 10.4 一个关键实现建议

后台“发布”动作应该做两件事：

1. 先把草稿转换成 `WorkspaceConfig`
2. 再用现有 `WorkspaceConfigSchema` 做一次最终校验

这样能保证面板不会发布出 agent 无法消费的配置。

## 11. 首版技术实现建议

### 11.1 项目结构建议

在当前 monorepo 下，建议新增：

- `apps/control-plane-web`

职责只做前端界面。

后台管理 API 继续放在：

- `apps/control-plane-api`

如果后续后台接口 DTO 变多，可以再考虑新增：

- `packages/control-plane-contracts`

但首版不必一上来就拆。

### 11.2 推荐技术取向

如果没有额外约束，建议：

- 前端：React + Vite
- 表单校验：Zod
- 请求层：TanStack Query 或等价简洁方案
- UI：先以内部工具风格为主，不要过早做复杂设计系统

### 11.3 后台鉴权建议

当前项目还没有后台登录系统。

所以首版建议采用最省事但边界清楚的方式：

- 面板只部署在内网，或
- 放在反向代理之后，用基础认证 / 单点登录 / 网关鉴权兜底

不建议首版就在应用内自己发明一套登录系统。

## 12. MVP 范围建议

### 12.1 一阶段必须完成

- 工作区列表
- 工作区详情
- 工作区草稿编辑
- 上游增删改
- JSON 预览
- 发布
- Token 生成或覆盖
- 公开配置接口继续可用

### 12.2 可以延后到二阶段

- 发布备注
- 快照 diff
- 配置导入导出
- 细粒度权限
- 团队维度管理
- 审计日志

## 13. 风险与待确认项

### 13.1 Token 存储怎么落

这是当前最大的落地缺口。

因为现在 Token 只在进程环境变量里，面板要想真正管理 Token，后端必须先补持久化方案。

建议优先级最高。

### 13.2 `local-stdio` 的配置边界

`local-stdio` 本质上运行在用户机器上，不在服务器上执行。

所以面板里必须明确提示：

- 这类上游依赖用户本机环境
- 服务器只能保存配置，不能替用户验证命令一定可运行

### 13.3 敏感字段展示

`direct-http.headers` 里可能包含密钥。

建议首版就定义规则：

- 展示时默认脱敏
- 编辑时区分“保留原值”和“替换为新值”

### 13.4 发布一致性

如果首版继续用文件存储，需要考虑：

- 并发写入
- 发布过程中断
- 快照和线上文件不同步

建议至少保证“先写快照，再原子替换发布文件”。

## 14. 给继任者的建议落地顺序

建议按下面顺序推进，不要一开始先做花哨 UI。

1. 先从 `apps/control-plane-api` 抽出一个仓储层，把“路由逻辑”和“文件存储逻辑”分开。
2. 先补后台读写接口，再保持现有 `GET /v1/workspaces/:workspaceId/config` 不变。
3. 先把 Token 持久化方案定下来，不然面板只有半闭环。
4. 再做最小 Web 面板，只做列表、详情、编辑、预览、发布。
5. 最后补快照、回滚、脱敏、发布提示这些增强能力。

## 15. 一句话结论

这个控制面板首版不应该被做成“大而全的 MCP 平台”，而应该被做成：

- 一个围绕 `workspace config` 的后台编辑器
- 一个把草稿发布成线上 JSON 的管理入口
- 一个为后续数据库化和权限化预留边界的薄控制面
