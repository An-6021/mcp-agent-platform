import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type UpstreamConfig } from "../api/client";
import { PageHeader, SectionCard, StatusBadge } from "../components/ConsolePrimitives";
import { JsonPreview } from "../components/JsonPreview";
import { ClientConfigSection } from "../components/ClientConfigSection";
import { ServiceCapabilitiesSection } from "../components/ServiceCapabilitiesSection";
import { buildClientConfigSnippets } from "../utils/clientConfigs";
import { formatUpstreamKindLabel, formatWorkspaceStatusLabel } from "../utils/labels";

function getWorkspaceStatusTone(status: string) {
  return status === "active" ? "success" : "neutral";
}

function getUpstreamPreview(upstream: UpstreamConfig): string {
  if (upstream.kind === "direct-http") {
    return upstream.url || "未填写地址";
  }

  if (upstream.command?.length) {
    return upstream.command.join(" ");
  }

  return "未填写启动命令";
}

function UpstreamSummaryRow({ upstream, index }: { upstream: UpstreamConfig; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview = getUpstreamPreview(upstream);

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white">
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-start gap-4 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-950">{upstream.label || upstream.id || `来源 ${index + 1}`}</p>
            <StatusBadge tone={upstream.enabled ? "success" : "neutral"}>{upstream.enabled ? "启用中" : "已禁用"}</StatusBadge>
            <StatusBadge tone="info">{formatUpstreamKindLabel(upstream.kind)}</StatusBadge>
          </div>
          <p className="mt-1 truncate text-xs text-slate-400">{preview}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <code className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500">{upstream.id || "未填写来源 ID"}</code>
            <span>顺位 {index + 1}</span>
          </div>
        </div>

        <svg
          viewBox="0 0 20 20"
          fill="none"
          className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? "rotate-180 text-slate-700" : ""}`}
          aria-hidden="true"
        >
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          <div className="space-y-3">
            {upstream.kind === "direct-http" && upstream.url ? (
              <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">地址</p>
                <code className="mt-2 block break-all text-xs leading-6 text-slate-900">{upstream.url}</code>
              </div>
            ) : null}

            {upstream.kind === "local-stdio" && upstream.command?.length ? (
              <div className="space-y-3">
                <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">启动命令</p>
                  <code className="mt-2 block break-all text-xs leading-6 text-slate-900">{upstream.command.join(" ")}</code>
                </div>
                {upstream.cwd ? (
                  <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">工作目录</p>
                    <code className="mt-2 block break-all text-xs leading-6 text-slate-900">{upstream.cwd}</code>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!upstream.url && !upstream.command?.length ? (
              <div className="rounded-[1rem] border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                尚未填写完整配置。
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["workspace", id],
    queryFn: () => api.getWorkspace(id!),
    enabled: !!id,
  });

  const { data: publishedConfig } = useQuery({
    queryKey: ["publishedConfig", id],
    queryFn: () => api.getPublishedConfig(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return <p className="text-gray-500">加载中...</p>;
  }

  if (!data) {
    return <p className="text-red-500">未找到服务。</p>;
  }

  const { workspace, draft, tokens } = data;
  const hasActiveToken = tokens.some((token) => !token.revokedAt);
  const effectiveDisplayName = publishedConfig?.displayName ?? draft?.displayName ?? workspace.displayName;
  const effectiveCacheTtl = publishedConfig?.cacheTtlSeconds ?? draft?.cacheTtlSeconds ?? workspace.cacheTtlSeconds;
  const effectiveUpstreams = publishedConfig?.upstreams ?? draft?.upstreams ?? [];
  const primaryUpstream = effectiveUpstreams.find((upstream) => upstream.enabled) ?? effectiveUpstreams[0] ?? null;
  const previewConfig = {
    schemaVersion: 1,
    workspaceId: workspace.id,
    displayName: effectiveDisplayName,
    cacheTtlSeconds: effectiveCacheTtl,
    upstreams: effectiveUpstreams,
  };
  const clientSnippetCount = buildClientConfigSnippets({
    workspaceId: workspace.id,
    hasToken: hasActiveToken,
  }).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={effectiveDisplayName}
        description={workspace.description || "集中管理接入配置。"}
        meta={
          <>
            <StatusBadge tone="info">{workspace.id}</StatusBadge>
            <StatusBadge tone={getWorkspaceStatusTone(workspace.status)}>{formatWorkspaceStatusLabel(workspace.status)}</StatusBadge>
            <StatusBadge tone={hasActiveToken ? "warning" : "neutral"}>{hasActiveToken ? "已保护" : "未保护"}</StatusBadge>
          </>
        }
        actions={
          <>
            <Link to="/services" className="button-ghost">
              返回列表
            </Link>
            <Link to={`/services/${id}/edit`} className="button-primary">
              配置服务
            </Link>
          </>
        }
      />

      <ClientConfigSection workspaceId={workspace.id} tokens={tokens} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <div className="space-y-5">
          <ServiceCapabilitiesSection workspaceId={workspace.id} />
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 xl:h-fit">
          <SectionCard
            title="服务配置"
            description={`共 ${effectiveUpstreams.length} 个来源，${clientSnippetCount} 个接入模板，缓存 ${effectiveCacheTtl}s。`}
            actions={
              primaryUpstream ? (
                <StatusBadge tone={primaryUpstream.enabled ? "success" : "neutral"}>
                  主来源：{primaryUpstream.label || primaryUpstream.id || "未命名"}
                </StatusBadge>
              ) : null
            }
          >
            {effectiveUpstreams.length ? (
              <div className="space-y-2">
                {effectiveUpstreams.map((upstream, index) => (
                  <UpstreamSummaryRow key={`${upstream.id || index}-${upstream.kind}`} upstream={upstream} index={index} />
                ))}

                <details className="rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">查看原始配置</summary>
                  <div className="mt-4">
                    <JsonPreview data={previewConfig} />
                  </div>
                </details>
              </div>
            ) : (
              <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                还没有配置服务来源。
              </div>
            )}
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
