import type { ReactNode } from "react";
import { cn } from "./utils";
import { Icon, type IconName } from "./Icon";

export function Card({ children, className, interactive = false }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-xl shadow-xs",
        interactive && "transition-colors hover:border-border-strong hover:shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card with a standard header row (title, optional description, optional action). */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={className}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
            {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  /** Only pass when the delta is real data. */
  trend?: { value: string; direction: "up" | "down" | "flat" };
  accent?: "primary" | "success" | "warning" | "danger";
}) {
  const accentClass =
    accent === "success"
      ? "text-success bg-success-soft"
      : accent === "warning"
        ? "text-warning bg-warning-soft"
        : accent === "danger"
          ? "text-danger bg-danger-soft"
          : "text-primary bg-primary-soft";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        {icon && (
          <span className={cn("inline-flex items-center justify-center w-7 h-7 rounded-lg", accentClass)}>
            <Icon name={icon} className="w-4 h-4" />
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-fg mt-1.5 tabular-nums tracking-tight">{value}</p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        {trend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              trend.direction === "up" ? "text-success" : trend.direction === "down" ? "text-danger" : "text-fg-subtle",
            )}
          >
            {trend.direction !== "flat" && <Icon name={trend.direction === "up" ? "arrow-up-right" : "arrow-down-right"} className="w-3.5 h-3.5" />}
            {trend.value}
          </span>
        )}
        {hint && <span className="text-fg-subtle">{hint}</span>}
      </div>
    </Card>
  );
}
