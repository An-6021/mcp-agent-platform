# Data API

## 1. 目标

这份文档定义自用 MCP 聚合控制台的前后端数据模型与 API。

核心围绕四条链路：

- Source 管理
- Discovery 缓存
- Tool 暴露管理
- Hosted 运行管理

## 2. 后端数据模型

### 2.1 Source

```ts
type SourceKind =
  | "remote-http"
  | "local-stdio"
  | "hosted-npm"
  | "hosted-single-file";

type Source = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  lastRefreshedAt: string | null;
  status: "unknown" | "ready" | "error" | "disabled";
  lastError: string | null;
  config: SourceConfig;
};
```

### 2.2 SourceConfig

```ts
type RemoteHttpSourceConfig = {
  endpoint: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

type LocalStdioSourceConfig = {
  command: string[];
  cwd: string | null;
  env: Record<string, string>;
  timeoutMs: number;
};

type HostedNpmSourceConfig = {
  packageName: string;
  packageVersion?: string;
  binName: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  timeoutMs: number;
  autoStart: boolean;
};

type HostedSingleFileRuntime = "node" | "tsx" | "python" | "bash";

type HostedSingleFileSourceConfig = {
  fileName: string;
  runtime: HostedSingleFileRuntime;
  source: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  timeoutMs: number;
  autoStart: boolean;
};

type SourceConfig =
  | RemoteHttpSourceConfig
  | LocalStdioSourceConfig
  | HostedNpmSourceConfig
  | HostedSingleFileSourceConfig;
```

### 2.3 SourceDiscovery

```ts
type DiscoveredTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
};

type DiscoveredResource = {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
};

type DiscoveredPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

type DiscoveredPrompt = {
  name: string;
  description?: string;
  arguments?: DiscoveredPromptArgument[];
};

type SourceDiscovery = {
  sourceId: string;
  generatedAt: string;
  status: "ready" | "error";
  error: string | null;
  tools: DiscoveredTool[];
  resources: DiscoveredResource[];
  prompts: DiscoveredPrompt[];
};
```

### 2.4 ToolExposure

```ts
type ToolExposure = {
  sourceId: string;
  originalName: string;
  exposedName: string;
  enabled: boolean;
  order: number;
  strategy: "default" | "renamed" | "hidden";
};
```

### 2.5 HostedRuntimeState

```ts
type HostedRuntimeStatus = "stopped" | "starting" | "running" | "error";

type HostedRuntimeState = {
  sourceId: string;
  status: HostedRuntimeStatus;
  pid: number | null;
  startedAt: string | null;
  stoppedAt: string | null;
  restartCount: number;
  autoStart: boolean;
  lastExitCode: number | null;
  lastError: string | null;
};
```

### 2.6 LogEntry

```ts
type LogStream = "stdout" | "stderr" | "system";

type LogEntry = {
  id: string;
  sourceId: string;
  timestamp: string;
  stream: LogStream;
  message: string;
};
```

### 2.7 SystemSummary

```ts
type SystemSummary = {
  sourceCount: number;
  enabledSourceCount: number;
  exposedToolCount: number;
  hiddenToolCount: number;
  conflictToolCount: number;
  hostedRunningCount: number;
  hostedErrorCount: number;
};
```

## 3. 前端视图模型

### 3.1 SourceListItem

```ts
type SourceListItem = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled: boolean;
  status: "unknown" | "ready" | "error" | "disabled";
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  isHosted: boolean;
  lastRefreshedAt: string | null;
  lastError: string | null;
};
```

### 3.2 ToolListItem

```ts
type ToolConflictStatus = "none" | "name-conflict";

type ToolListItem = {
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  originalName: string;
  exposedName: string;
  enabled: boolean;
  strategy: "default" | "renamed" | "hidden";
  description?: string;
  conflictStatus: ToolConflictStatus;
};
```

### 3.3 HostedListItem

```ts
type HostedListItem = {
  sourceId: string;
  name: string;
  kind: "hosted-npm" | "hosted-single-file";
  enabled: boolean;
  runtimeStatus: HostedRuntimeStatus;
  autoStart: boolean;
  startedAt: string | null;
  restartCount: number;
  lastError: string | null;
};
```

## 4. 存储结构

```text
data/
  sources/
    <sourceId>.json
  discoveries/
    <sourceId>.json
  exposures.json
  hosted-state.json
  logs/
    <sourceId>.log
```

## 5. Repository 接口草案

```ts
type SourceRepository = {
  listSources(): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  createSource(input: CreateSourceInput): Promise<Source>;
  updateSource(id: string, patch: UpdateSourceInput): Promise<Source>;
  deleteSource(id: string): Promise<void>;
  saveDiscovery(discovery: SourceDiscovery): Promise<void>;
  getDiscovery(sourceId: string): Promise<SourceDiscovery | null>;
  listExposures(): Promise<ToolExposure[]>;
  saveExposure(exposure: ToolExposure): Promise<ToolExposure>;
  saveExposures(exposures: ToolExposure[]): Promise<void>;
  getHostedState(sourceId: string): Promise<HostedRuntimeState | null>;
  saveHostedState(state: HostedRuntimeState): Promise<void>;
  listHostedStates(): Promise<HostedRuntimeState[]>;
  appendLog(entry: LogEntry): Promise<void>;
  listLogs(sourceId: string, limit?: number): Promise<LogEntry[]>;
};
```

## 6. 输入模型

```ts
type CreateSourceInput = {
  id: string;
  name: string;
  kind: SourceKind;
  enabled?: boolean;
  config: SourceConfig;
};

type UpdateSourceInput = {
  name?: string;
  enabled?: boolean;
  config?: Partial<SourceConfig>;
};

type UpdateToolExposureInput = {
  exposedName?: string;
  enabled?: boolean;
};
```

## 7. API 返回约定

成功：

```json
{
  "data": {},
  "error": null
}
```

失败：

```json
{
  "data": null,
  "error": {
    "code": "source_not_found",
    "message": "Source \"github\" not found"
  }
}
```

## 8. Sources API

### `GET /admin/sources`

```ts
type GetSourcesResponse = {
  items: SourceListItem[];
  summary: SystemSummary;
};
```

### `POST /admin/sources`

请求体：`CreateSourceInput`

返回：`Source`

### `GET /admin/sources/:sourceId`

```ts
type SourceDetailResponse = {
  source: Source;
  discovery: SourceDiscovery | null;
  hostedState: HostedRuntimeState | null;
};
```

### `PUT /admin/sources/:sourceId`

请求体：`UpdateSourceInput`

### `DELETE /admin/sources/:sourceId`

```ts
type DeleteSourceResponse = {
  deleted: true;
};
```

### `POST /admin/sources/:sourceId/toggle`

```ts
type ToggleSourceInput = {
  enabled: boolean;
};
```

### `POST /admin/sources/:sourceId/refresh`

```ts
type RefreshSourceResponse = {
  source: Source;
  discovery: SourceDiscovery;
  exposureChanges: {
    created: number;
    updated: number;
  };
};
```

## 9. Tools API

### `GET /admin/tools`

查询参数建议支持：

- `sourceId?`
- `enabled?`
- `conflictOnly?`
- `q?`

```ts
type GetToolsResponse = {
  items: ToolListItem[];
  summary: {
    exposedToolCount: number;
    hiddenToolCount: number;
    conflictToolCount: number;
    sourceCount: number;
  };
};
```

### `PUT /admin/tools/:sourceId/:toolName`

请求体：`UpdateToolExposureInput`

返回：`ToolExposure`

### `POST /admin/tools/batch`

```ts
type BatchUpdateToolExposureInput = {
  items: Array<{
    sourceId: string;
    originalName: string;
    exposedName?: string;
    enabled?: boolean;
  }>;
};
```

### `POST /admin/tools/rebuild`

```ts
type RebuildToolsResponse = {
  sourceCount: number;
  toolCount: number;
  createdExposureCount: number;
};
```

## 10. Hosted API

### `GET /admin/hosted`

```ts
type GetHostedResponse = {
  items: HostedListItem[];
  summary: {
    total: number;
    running: number;
    stopped: number;
    error: number;
  };
};
```

### `POST /admin/hosted/:sourceId/start`

返回：`{ state: HostedRuntimeState }`

### `POST /admin/hosted/:sourceId/stop`

返回：`{ state: HostedRuntimeState }`

### `POST /admin/hosted/:sourceId/restart`

返回：`{ state: HostedRuntimeState }`

### `GET /admin/hosted/:sourceId/logs`

查询参数：

- `limit?`

返回：`{ items: LogEntry[] }`

## 11. 可选调试 API

### `POST /admin/debug/sources/:sourceId/check`

```ts
type DebugCheckSourceResponse = {
  ok: boolean;
  message: string;
};
```

### `GET /admin/debug/exposure-preview`

```ts
type ExposurePreviewItem = {
  sourceId: string;
  originalName: string;
  exposedName: string;
  enabled: boolean;
};

type ExposurePreviewResponse = {
  items: ExposurePreviewItem[];
};
```

## 12. 落地顺序

### 第一步

先打通：

- Source CRUD
- Source refresh
- Discovery 存储
- Tools 汇总页
- Tool exposure 编辑

### 第二步

再补：

- hosted source 启动器
- runtime state 管理
- 日志读取
- Hosted 页面
