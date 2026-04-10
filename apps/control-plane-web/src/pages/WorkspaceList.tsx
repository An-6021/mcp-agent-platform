import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type WorkspaceSummary } from "../api/client";
import { MetricStrip, PageHeader, SectionCard, StatusBadge, type BadgeTone } from "../components/ConsolePrimitives";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { buildAgentCommand } from "../utils/clientConfigs";
import { formatWorkspaceStatusLabel } from "../utils/labels";

function getServiceSetupTone(workspace: WorkspaceSummary): BadgeTone {
  if (workspace.upstreamCount === 0) {
    return "warning";
  }

  return "success";
}

function getServiceSetupLabel(workspace: WorkspaceSummary): string {
  if (workspace.upstreamCount === 0) {
    return "待配置";
  }

  return `${workspace.upstreamCount} 个来源`;
}

export function WorkspaceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCacheTtl, setNewCacheTtl] = useState(300);
  const [search, setSearch] = useState("");
  const [tokenFilter, setTokenFilter] = useState<"all" | "with-token" | "without-token">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: workspaces, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: api.listWorkspaces,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createWorkspace({
        id: newId.trim(),
        displayName: newName.trim(),
        description: newDescription.trim() || undefined,
        cacheTtlSeconds: newCacheTtl,
      }),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setShowCreate(false);
      setNewId("");
      setNewName("");
      setNewDescription("");
      setNewCacheTtl(300);
      navigate(`/services/${workspace.id}`);
    },
  });

  async function copyCommand(workspace: WorkspaceSummary) {
    if (workspace.hasToken) {
      navigate(`/services/${workspace.id}`);
      return;
    }

    const command = buildAgentCommand({ workspaceId: workspace.id, hasToken: workspace.hasToken });

    try {
      await navigator.clipboard.writeText(command);
      setCopiedId(workspace.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === workspace.id ? null : current));
      }, 1500);
    } catch {
      setCopiedId(null);
    }
  }

  if (isLoading) {
    return <p className="text-gray-500">加载中...</p>;
  }

  const filteredWorkspaces = (workspaces ?? []).filter((workspace) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      workspace.id.toLowerCase().includes(query) ||
      workspace.displayName.toLowerCase().includes(query);

    const matchesToken =
      tokenFilter === "all" ||
      (tokenFilter === "with-token" && workspace.hasToken) ||
      (tokenFilter === "without-token" && !workspace.hasToken);

    return matchesSearch && matchesToken;
  });

  const totalWorkspaces = workspaces?.length ?? 0;
  const configuredCount = workspaces?.filter((workspace) => workspace.upstreamCount > 0).length ?? 0;
  const tokenCount = workspaces?.filter((workspace) => workspace.hasToken).length ?? 0;
  const pendingCount = workspaces?.filter((workspace) => workspace.upstreamCount === 0).length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="服务接入"
        description="先建一个服务名，再选一种接入方式，就能给客户端直接复制配置。"
        actions={
          <button onClick={() => setShowCreate(true)} className="button-primary">
            新建接入
          </button>
        }
      />

      <MetricStrip
        items={[
          { label: "服务总数", value: `${totalWorkspaces}` },
          { label: "已配置服务", value: `${configuredCount}`, tone: configuredCount > 0 ? "success" : "default" },
          { label: "受保护服务", value: `${tokenCount}`, tone: tokenCount > 0 ? "warning" : "default" },
          { label: "待完善服务", value: `${pendingCount}`, tone: pendingCount > 0 ? "accent" : "default" },
        ]}
      />

      <SectionCard title="服务列表" description="保留最少操作，只在需要时进入修改。">
        <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_120px]">
          <label className="block">
            <span className="field-label">搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="field-input"
              placeholder="搜索服务 ID 或名称"
            />
          </label>

          <label className="block">
            <span className="field-label">访问保护</span>
            <Select
              value={tokenFilter}
              onValueChange={(val) => setTokenFilter(val as "all" | "with-token" | "without-token")}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="访问保护" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="with-token">仅看已启用</SelectItem>
                <SelectItem value="without-token">仅看未启用</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="flex items-end">
            <div className="flex h-[50px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-600">
              共 <span className="mx-1 font-semibold text-slate-950">{filteredWorkspaces.length}</span> 项
            </div>
          </div>
        </div>

        {filteredWorkspaces.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
            还没有符合条件的服务。
          </div>
        ) : (
          <div className="space-y-3">
            {filteredWorkspaces.map((workspace) => (
              <article key={workspace.id} className="surface-card px-4 py-4 sm:px-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold text-slate-950">{workspace.displayName}</p>
                      <StatusBadge tone={workspace.status === "active" ? "success" : "neutral"}>
                        {formatWorkspaceStatusLabel(workspace.status)}
                      </StatusBadge>
                      <StatusBadge tone={getServiceSetupTone(workspace)}>{getServiceSetupLabel(workspace)}</StatusBadge>
                      <StatusBadge tone={workspace.hasToken ? "warning" : "neutral"}>
                        {workspace.hasToken ? "已保护" : "未保护"}
                      </StatusBadge>
                    </div>
                    <p className="mt-2 font-mono text-xs text-slate-500">{workspace.id}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Link to={`/services/${workspace.id}`} className="button-secondary px-3 py-1.5 text-xs">
                      查看接入
                    </Link>
                    <Link to={`/services/${workspace.id}/edit`} className="button-ghost px-3 py-1.5 text-xs">
                      修改接入
                    </Link>
                    <button onClick={() => copyCommand(workspace)} className="button-ghost px-3 py-1.5 text-xs">
                      {workspace.hasToken ? "前往详情" : copiedId === workspace.id ? "已复制" : "复制配置"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      {showCreate ? (
        <div className="fixed inset-x-0 bottom-0 top-[-24px] z-50">
          <div className="absolute inset-0 bg-slate-950/25 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <aside className="drawer-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">新建接入</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">先填两个最关键的信息，创建后再继续选择接入方式。</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="button-ghost">
                关闭
              </button>
            </div>

            <form
              className="mt-8 flex flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                createMutation.mutate();
              }}
            >
              <div className="space-y-5">
                <label className="block">
                  <span className="field-label">服务 ID</span>
                  <input
                    value={newId}
                    onChange={(event) => setNewId(event.target.value)}
                    className="field-input font-mono text-xs sm:text-sm"
                    placeholder="customer-support"
                  />
                  <p className="field-help">会用于配置地址与客户端接入名，建议用简单英文短词。</p>
                </label>

                <label className="block">
                  <span className="field-label">显示名称</span>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    className="field-input"
                    placeholder="例如：客服支持"
                  />
                  <p className="field-help">这个名字会直接展示给使用者看。</p>
                </label>

                <details className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">高级设置（可选）</summary>
                  <div className="mt-4 space-y-5">
                    <label className="block">
                      <span className="field-label">说明</span>
                      <textarea
                        value={newDescription}
                        onChange={(event) => setNewDescription(event.target.value)}
                        className="field-textarea"
                        placeholder="可选，用来区分这个服务的用途。"
                      />
                    </label>

                    <label className="block">
                      <span className="field-label">缓存时长（秒）</span>
                      <input
                        type="number"
                        min={60}
                        value={newCacheTtl}
                        onChange={(event) => setNewCacheTtl(Number(event.target.value))}
                        className="field-input"
                      />
                      <p className="field-help">默认 300 秒，一般不用改。</p>
                    </label>
                  </div>
                </details>
              </div>

              <div className="mt-auto pt-6">
                {createMutation.isError ? (
                  <p className="mb-4 text-sm text-rose-600">{(createMutation.error as Error).message}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={!newId.trim() || !newName.trim() || createMutation.isPending}
                    className="button-primary"
                  >
                    {createMutation.isPending ? "创建中..." : "创建并继续"}
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)} className="button-secondary">
                    取消
                  </button>
                </div>
              </div>
            </form>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
