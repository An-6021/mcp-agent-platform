# Todo

## 当前结论

文档和实现方向已经收敛到三层：

- Sources
- Tools
- Hosted

旧的 workspace / 快照 / 后台化路线不再作为主方向。

## 当前优先级

### 1. 打通 Source -> Discovery -> Exposure 主链路

先完成：

- Source CRUD
- Source refresh
- Discovery 缓存
- Tool exposure 编辑
- 最终工具视图

### 2. 补齐 Hosted 主链路

继续完成：

- hosted-npm 启动/停止/重启
- hosted-single-file 启动/停止/重启
- Hosted 状态管理
- 简单日志读取

### 3. 收口控制面 UI

页面结构固定为：

- `/sources`
- `/tools`
- `/hosted`

不再扩展 workspace 列表、快照、回滚等后台心智。

## 实现提醒

- 对外仍然保持一个统一 MCP 入口
- 控制面重点是来源管理、工具暴露和托管运行，不是企业后台
- hosted 单文件运行仍然依赖运行机本地环境，例如 `node`、`python3`、`bash` 或 `npx tsx`
- 敏感配置如果继续落文件，前端展示要默认脱敏

## 建议阅读顺序

1. `docs/architecture.md`
2. `docs/product.md`
3. `docs/data-api.md`
