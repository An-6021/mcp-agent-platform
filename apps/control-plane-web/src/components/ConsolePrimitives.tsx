import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "status-badge-neutral",
  info: "status-badge-info",
  success: "status-badge-success",
  warning: "status-badge-warning",
  danger: "status-badge-danger",
};

type StatusBadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span className={`status-badge ${badgeToneClasses[tone]}`}>
      {children}
    </span>
  );
}

// ── 统计条 ──────────────────────────────────────────────────────────

type MetricStripItem = {
  label: string;
  value: string;
  tone?: "default" | "accent" | "success" | "warning";
};

type MetricStripProps = {
  items: MetricStripItem[];
};

export function MetricStrip({ items }: MetricStripProps) {
  return (
    <div className="flex gap-6">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-[#111]">
            {item.value}
          </span>
          <span className="text-[13px] text-[#666]">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── 页面标题 ────────────────────────────────────────────────────────

type PageHeaderProps = {
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, description, meta, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-[#111]">{title}</h1>
        {description ? <p className="mt-1 text-[13px] text-[#666]">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ── 分区卡片 ────────────────────────────────────────────────────────

type SectionCardProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function SectionCard({ title, description, actions, children }: SectionCardProps) {
  return (
    <section className="surface-card px-5 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#111]">{title}</h2>
          {description ? <p className="mt-1 text-[13px] text-[#666]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
