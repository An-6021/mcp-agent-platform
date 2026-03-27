import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type UpstreamConfig } from "../api/client";
import { MetricStrip, PageHeader, SectionCard, StatusBadge } from "../components/ConsolePrimitives";
import { UpstreamEditor } from "../components/UpstreamEditor";
import { JsonPreview } from "../components/JsonPreview";
import { getWorkspaceConfigUrl } from "../utils/clientConfigs";
import { formatWorkspaceStatusLabel } from "../utils/labels";

export function WorkspaceEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => api.getWorkspace(id!),
    enabled: !!id,
  });

  const [displayName, setDisplayName] = useState("");
  const [cacheTtl, setCacheTtl] = useState(300);
  const [upstreams, setUpstreams] = useState<UpstreamConfig[]>([]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const draft = data.draft;
    const workspace = data.workspace;
    setDisplayName(draft?.displayName ?? workspace.displayName);
    setCacheTtl(draft?.cacheTtlSeconds ?? workspace.cacheTtlSeconds);
    setUpstreams(draft?.upstreams ?? []);
  }, [data]);

  const applyMutation = useMutation({
    mutationFn: async () => {
      await api.saveDraft(id!, {
        displayName,
        cacheTtlSeconds: cacheTtl,
        upstreams,
      });

      return api.publish(id!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", id] });
      queryClient.invalidateQueries({ queryKey: ["publishedConfig", id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const previewConfig = {
    schemaVersion: 1,
    workspaceId: id,
    displayName,
    cacheTtlSeconds: cacheTtl,
    upstreams,
  };

  if (isLoading) {
    return <p className="text-gray-500">加载中...</p>;
  }

  if (!data) {
    return <p className="text-red-500">未找到服务。</p>;
  }

  const enabledUpstreams = upstreams.filter((upstream) => upstream.enabled).length;
  const totalUpstreams = upstreams.length;
  const actionError = applyMutation.error as Error | null;
  const actionTone = actionError ? "danger" : applyMutation.isSuccess ? "success" : "info";
  const actionLabel = actionError ? "保存失败" : applyMutation.isSuccess ? "已生效" : "配置中";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`配置 ${displayName || data.workspace.displayName}`}
        description="修改服务来源并立即生效。"
        meta={
          <>
            <StatusBadge tone="info">{data.workspace.id}</StatusBadge>
            <StatusBadge tone={data.workspace.status === "active" ? "success" : "neutral"}>
              {formatWorkspaceStatusLabel(data.workspace.status)}
            </StatusBadge>
          </>
        }
        actions={
          <button onClick={() => navigate(`/services/${id}`)} className="button-ghost">
            返回详情
          </button>
        }
      />

      <MetricStrip
        items={[
          { label: "来源数量", value: `${totalUpstreams}`, tone: totalUpstreams > 0 ? "success" : "default" },
          { label: "已启用", value: `${enabledUpstreams}` },
          { label: "缓存时长", value: `${cacheTtl}s` },
          {
            label: "访问保护",
            value: data.tokens.some((token) => !token.revokedAt) ? "已启用" : "未启用",
            tone: data.tokens.some((token) => !token.revokedAt) ? "warning" : "default",
          },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <div className="space-y-6">
          <SectionCard title="基本信息">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="field-label">显示名称</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="field-input"
                />
              </label>

              <label className="block">
                <span className="field-label">缓存时长（秒）</span>
                <input
                  type="number"
                  min={60}
                  value={cacheTtl}
                  onChange={(event) => setCacheTtl(Number(event.target.value))}
                  className="field-input"
                />
              </label>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="surface-card-muted p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">服务 ID</p>
                <p className="mt-3 font-mono text-sm text-slate-950">{data.workspace.id}</p>
              </div>
              <div className="surface-card-muted p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">配置地址</p>
                <code className="mt-3 block break-all text-xs leading-6 text-slate-950">
                  {getWorkspaceConfigUrl(data.workspace.id)}
                </code>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="服务来源" description="按优先级从上到下匹配。">
            <UpstreamEditor upstreams={upstreams} onChange={setUpstreams} />
          </SectionCard>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:h-fit">
          <SectionCard title="当前配置预览">
            <JsonPreview data={previewConfig} />
          </SectionCard>
        </div>
      </div>

      <div className="sticky bottom-4 z-20">
        <div className="surface-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={actionTone}>{actionLabel}</StatusBadge>
              {applyMutation.isPending ? <span className="text-sm text-slate-500">正在同步配置，请稍候。</span> : null}
            </div>
            {actionError ? (
              <p className="mt-2 text-sm text-rose-600">{actionError.message}</p>
            ) : (
              <p className="mt-2 text-sm text-slate-600">保存后会立即更新对外配置。</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => navigate(`/services/${id}`)} className="button-ghost">
              取消
            </button>
            <button
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
              className="button-primary"
            >
              {applyMutation.isPending ? "保存中..." : "保存并生效"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
