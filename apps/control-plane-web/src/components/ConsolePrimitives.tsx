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
