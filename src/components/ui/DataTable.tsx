import type { ReactNode } from "react";
import { cn } from "./utils";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { CenteredSpinner } from "./feedback";

/**
 * Table primitives sharing one visual system. Compose them, or use <DataTable>
 * for the common "header + rows + loading + empty" case.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-fg-subtle">{children}</tr>
    </thead>
  );
}

export function TH({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th
      className={cn(
        "font-medium px-4 py-2.5",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TR({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <tr
      onClick={onClick}
      className={cn("transition-colors", onClick ? "cursor-pointer hover:bg-surface-hover" : "hover:bg-surface-hover/60", className)}
    >
      {children}
    </tr>
  );
}

export function TD({ children, className, align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <td
      className={cn(
        "px-4 py-3 text-fg-muted align-middle",
        align === "right" && "text-right tabular-nums",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function TableCard({
  children,
  loading = false,
  empty,
  title,
  action,
  footer,
}: {
  children: ReactNode;
  loading?: boolean;
  /** Rendered instead of the table body area when there are no rows. */
  empty?: ReactNode;
  title?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 h-12 border-b border-border">
          {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
          {action}
        </div>
      )}
      {loading ? <CenteredSpinner /> : empty ? empty : children}
      {footer && <div className="px-4 py-3 border-t border-border text-xs text-fg-muted">{footer}</div>}
    </Card>
  );
}

/** Search + filter chips + reset, collapsible on mobile. */
export function FilterBar({
  search,
  onSearch,
  placeholder = "Search…",
  children,
  onReset,
  showReset = false,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  children?: ReactNode;
  onReset?: () => void;
  showReset?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-4">
      {onSearch && (
        <div className="relative flex-1 min-w-0">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-subtle pointer-events-none" />
          <input
            type="search"
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full h-9 pl-9 pr-3 text-sm rounded-lg bg-surface border border-border-strong text-fg placeholder:text-fg-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
          />
        </div>
      )}
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
      {showReset && onReset && (
        <button onClick={onReset} className="text-xs font-medium text-fg-muted hover:text-fg px-2 self-center cursor-pointer">
          Reset
        </button>
      )}
    </div>
  );
}

/** Segmented filter control (e.g. status tabs). */
export function SegmentedFilter<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-2 border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 h-7 rounded-md text-xs font-medium transition-colors cursor-pointer capitalize",
            value === o.value ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
