import type { ReactNode } from "react";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "status-badge-neutral",
  info: "status-badge-info",
  success: "status-badge-success",
  warning: "status-badge-warning",
  danger: "status-badge-danger",
};

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="mb-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
      <div className="space-y-3">
        {eyebrow ? <p className="panel-kicker">{eyebrow}</p> : null}
        <div className="space-y-2">
          <h1 className="page-title">{title}</h1>
          {description ? <p className="page-description">{description}</p> : null}
        </div>
        {meta ? <div className="flex flex-wrap gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3 xl:justify-end">{actions}</div> : null}
    </header>
  );
}

type SectionCardProps = {
  title: string;
  description?: string;
  actions?: ReactNode;
  tone?: "default" | "muted" | "code";
  className?: string;
  children: ReactNode;
};

export function SectionCard({
  title,
  description,
  actions,
  tone = "default",
  className,
  children,
}: SectionCardProps) {
  const toneClass =
    tone === "muted" ? "surface-card-muted" : tone === "code" ? "surface-card-code" : "surface-card";

  return (
    <section className={joinClasses(toneClass, "p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className={joinClasses("text-lg font-semibold tracking-tight", tone === "code" ? "text-white" : "text-slate-950")}>
            {title}
          </h2>
          {description ? (
            <p className={joinClasses("mt-2 text-sm leading-6", tone === "code" ? "text-slate-300" : "text-slate-600")}>
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "success" | "warning";
};

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  const toneClass =
    tone === "accent"
      ? "border-slate-900 bg-slate-950 text-white"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-slate-950"
        : tone === "warning"
          ? "border-amber-200 bg-amber-50 text-slate-950"
          : "surface-card";

  return (
    <article className={joinClasses(tone === "default" ? "surface-card" : "", tone !== "default" ? "rounded-3xl border p-5" : "p-5", toneClass)}>
      <p className={joinClasses("text-xs font-semibold uppercase tracking-[0.22em]", tone === "accent" ? "text-slate-300" : "text-slate-500")}>
        {label}
      </p>
      <p className={joinClasses("mt-4 text-3xl font-semibold tracking-tight", tone === "accent" ? "text-white" : "text-slate-950")}>
        {value}
      </p>
      {hint ? (
        <p className={joinClasses("mt-3 text-sm leading-6", tone === "accent" ? "text-slate-300" : "text-slate-600")}>
          {hint}
        </p>
      ) : null}
    </article>
  );
}

type MetricStripItem = {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "success" | "warning";
};

type MetricStripProps = {
  items: MetricStripItem[];
};

export function MetricStrip({ items }: MetricStripProps) {
  return (
    <section className="surface-card overflow-hidden">
      <div className="grid divide-y divide-slate-200/80 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
        {items.map((item) => {
          const toneClass =
            item.tone === "accent"
              ? "bg-slate-950 text-white"
              : item.tone === "success"
                ? "bg-emerald-50/80"
                : item.tone === "warning"
                  ? "bg-amber-50/80"
                  : "";

          return (
            <div key={`${item.label}-${item.value}`} className={joinClasses("px-4 py-4 sm:px-5", toneClass)}>
              <p
                className={joinClasses(
                  "text-[11px] font-semibold uppercase tracking-[0.2em]",
                  item.tone === "accent" ? "text-slate-300" : "text-slate-500",
                )}
              >
                {item.label}
              </p>
              <p
                className={joinClasses(
                  "mt-3 text-2xl font-semibold tracking-tight",
                  item.tone === "accent" ? "text-white" : "text-slate-950",
                )}
              >
                {item.value}
              </p>
              {item.hint ? (
                <p className={joinClasses("mt-2 text-sm leading-6", item.tone === "accent" ? "text-slate-300" : "text-slate-600")}>
                  {item.hint}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type StatusBadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={joinClasses(
        "status-badge",
        badgeToneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
