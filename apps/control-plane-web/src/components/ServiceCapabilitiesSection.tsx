import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type WorkspaceUpstreamCapabilities } from "../api/client";
import { formatDateTime } from "../utils/format";
import { formatUpstreamKindLabel } from "../utils/labels";
import { SectionCard, StatusBadge } from "./ConsolePrimitives";

type Props = {
  workspaceId: string;
};

type CapabilityView = "tools" | "resources" | "prompts";

function getSchemaHint(inputSchema: unknown): string | null {
  if (!inputSchema || typeof inputSchema !== "object") {
    return null;
  }

  const schema = inputSchema as {
    properties?: Record<string, unknown>;
    required?: unknown;
  };
  const propertyCount = schema.properties ? Object.keys(schema.properties).length : 0;
  const requiredCount = Array.isArray(schema.required) ? schema.required.length : 0;

  if (propertyCount === 0) {
    return "无参数";
  }

  if (requiredCount > 0) {
    return `${propertyCount} 个参数 / ${requiredCount} 个必填`;
  }

  return `${propertyCount} 个参数`;
}

function CapabilityPanel({
  title,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  count: number;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="surface-card-muted px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-950">{title}</p>
        <span className="text-xs font-medium text-slate-400">{count}</span>
      </div>
      {count === 0 ? <p className="mt-3 text-sm text-slate-400">{emptyLabel}</p> : <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

function getDefaultView(upstream: WorkspaceUpstreamCapabilities): CapabilityView {
  if (upstream.toolCount > 0) return "tools";
  if (upstream.resourceCount > 0) return "resources";
  return "prompts";
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 shrink-0 text-slate-400 transition ${expanded ? "rotate-180 text-slate-700" : ""}`}
      aria-hidden="true"
    >
      <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CapabilityRow({
  title,
  meta,
  secondary,
  children,
  defaultExpanded = false,
}: {
  title: string;
  meta?: ReactNode;
  secondary?: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setExpanded((current) => !current)} className="flex w-full items-start gap-3 px-3 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-950">{title}</p>
            {meta}
          </div>
          {secondary ? <div className="mt-1 min-w-0">{secondary}</div> : null}
        </div>
        <Chevron expanded={expanded} />
      </button>

      {expanded ? <div className="border-t border-slate-100 px-3 pb-3 pt-3">{children}</div> : null}
    </div>
  );
}

function UpstreamCapabilityPanel({
  upstream,
  defaultExpanded = false,
}: {
  upstream: WorkspaceUpstreamCapabilities;
  defaultExpanded?: boolean;
}) {
  const [panelExpanded, setPanelExpanded] = useState(defaultExpanded);
  const [activeView, setActiveView] = useState<CapabilityView>(() => getDefaultView(upstream));

  function renderTools() {
    return (
      <CapabilityPanel title="工具" count={upstream.toolCount} emptyLabel="未暴露工具">
        {upstream.tools.map((tool) => {
          const description = tool.description || "暂无说明";
          const hint = getSchemaHint(tool.inputSchema);

          return (
            <CapabilityRow
              key={tool.name}
              title={tool.name}
              meta={hint ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{hint}</span> : null}
              secondary={<p className="truncate text-xs text-slate-400">{description}</p>}
            >
              <div className="space-y-3">
                <p className="text-sm leading-6 text-slate-500">{description}</p>
                {hint ? (
                  <div className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">参数概览</span>
                    <span className="ml-2">{hint}</span>
                  </div>
                ) : null}
              </div>
            </CapabilityRow>
          );
        })}
      </CapabilityPanel>
    );
  }

  function renderResources() {
    return (
      <CapabilityPanel title="资源" count={upstream.resourceCount} emptyLabel="未暴露资源">
        {upstream.resources.map((resource) => {
          const description = resource.description || "暂无说明";

          return (
            <CapabilityRow
              key={`${resource.name}-${resource.uri}`}
              title={resource.name}
              meta={
                resource.mimeType ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{resource.mimeType}</span> : null
              }
              secondary={<p className="truncate font-mono text-[11px] text-slate-400">{resource.uri}</p>}
            >
              <div className="space-y-3">
                <p className="text-sm leading-6 text-slate-500">{description}</p>
                <div className="rounded-2xl bg-slate-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">资源地址</p>
                  <p className="mt-2 break-all font-mono text-xs leading-6 text-slate-600">{resource.uri}</p>
                </div>
              </div>
            </CapabilityRow>
          );
        })}
      </CapabilityPanel>
    );
  }

  function renderPrompts() {
    return (
      <CapabilityPanel title="提示词" count={upstream.promptCount} emptyLabel="未暴露提示词">
        {upstream.prompts.map((prompt) => {
          const description = prompt.description || "暂无说明";

          return (
            <CapabilityRow
              key={prompt.name}
              title={prompt.name}
              meta={
                prompt.arguments?.length ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{prompt.arguments.length} 个参数</span>
                ) : null
              }
              secondary={<p className="truncate text-xs text-slate-400">{description}</p>}
            >
              <div className="space-y-3">
                <p className="text-sm leading-6 text-slate-500">{description}</p>
                {prompt.arguments?.length ? (
                  <div className="rounded-2xl bg-slate-50 px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">参数</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {prompt.arguments.map((argument) => (
                        <span key={`${prompt.name}-${argument.name}`} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                          {argument.name}
                          {argument.required ? " 必填" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </CapabilityRow>
          );
        })}
      </CapabilityPanel>
    );
  }

  function renderActivePanel() {
    switch (activeView) {
      case "resources":
        return renderResources();
      case "prompts":
        return renderPrompts();
      case "tools":
      default:
        return renderTools();
    }
  }

  const tabs: Array<{ id: CapabilityView; label: string; count: number }> = [
    { id: "tools", label: "工具", count: upstream.toolCount },
    { id: "resources", label: "资源", count: upstream.resourceCount },
    { id: "prompts", label: "提示词", count: upstream.promptCount },
  ];

  return (
    <div className="surface-card overflow-hidden">
      <button
        type="button"
        onClick={() => setPanelExpanded((current) => !current)}
        className="flex w-full items-start gap-4 px-4 py-4 text-left sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-semibold text-slate-950">{upstream.upstreamLabel}</p>
            <StatusBadge tone={upstream.status === "ready" ? "success" : "danger"}>
              {upstream.status === "ready" ? "已连接" : "连接失败"}
            </StatusBadge>
            <StatusBadge tone="info">{formatUpstreamKindLabel(upstream.upstreamKind)}</StatusBadge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <code className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-500">{upstream.upstreamId}</code>
            <span>{upstream.toolCount} 工具</span>
            <span>{upstream.resourceCount} 资源</span>
            <span>{upstream.promptCount} 提示词</span>
          </div>
        </div>
        <Chevron expanded={panelExpanded} />
      </button>

      {panelExpanded ? (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3 sm:px-5">
          {upstream.status === "error" ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {upstream.error || "探测失败。"}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {tabs.map((tab) => {
                  const active = activeView === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveView(tab.id)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950"
                      }`}
                    >
                      <span>{tab.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {tab.count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {renderActivePanel()}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function ServiceCapabilitiesSection({ workspaceId }: Props) {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["workspaceCapabilities", workspaceId],
    queryFn: () => api.getCapabilities(workspaceId),
    enabled: Boolean(workspaceId),
    refetchOnWindowFocus: false,
  });

  const upstreams = data?.upstreams ?? [];
  const totalTools = upstreams.reduce((sum, item) => sum + item.toolCount, 0);
  const totalResources = upstreams.reduce((sum, item) => sum + item.resourceCount, 0);
  const totalPrompts = upstreams.reduce((sum, item) => sum + item.promptCount, 0);

  return (
    <SectionCard
      title="工具能力"
      description="按来源查看能力。"
      actions={
        <>
          {data ? <StatusBadge tone="neutral">{formatDateTime(data.generatedAt, "刚刚")}</StatusBadge> : null}
          <button onClick={() => void refetch()} className="button-ghost px-3 py-1.5 text-xs">
            {isFetching ? "刷新中..." : "刷新"}
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <StatusBadge tone="info">{upstreams.length} 个来源</StatusBadge>
        <StatusBadge tone="neutral">{totalTools} 工具</StatusBadge>
        <StatusBadge tone="neutral">{totalResources} 资源</StatusBadge>
        <StatusBadge tone="neutral">{totalPrompts} 提示词</StatusBadge>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          正在探测能力...
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-10 text-center text-sm text-rose-700">
          {(error as Error).message || "能力探测失败。"}
        </div>
      ) : upstreams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
          先添加服务来源。
        </div>
      ) : (
        <div className="space-y-3">
          {upstreams.map((upstream, index) => (
            <UpstreamCapabilityPanel
              key={upstream.upstreamId}
              upstream={upstream}
              defaultExpanded={upstream.status === "error" || (upstreams.length === 1 && index === 0)}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
