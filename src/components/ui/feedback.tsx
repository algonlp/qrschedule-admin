import type { ReactNode } from "react";
import { cn } from "./utils";
import { Icon, type IconName } from "./Icon";
import { Button } from "./Button";
import { Card } from "./Card";

export function Spinner({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <span
      className={cn("inline-block border-2 border-primary border-t-transparent rounded-full animate-spin", className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="w-7 h-7" />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-md bg-surface-2", className)}>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-black/[0.04] dark:via-white/[0.05] to-transparent [animation:qs-shimmer_1.4s_infinite]" />
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28 mt-3" />
          <Skeleton className="h-3 w-24 mt-2" />
        </Card>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <div className="px-5 py-3 border-b border-border">
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-5 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className={cn("h-4", c === 0 ? "w-40" : "flex-1 max-w-[8rem]")} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function EmptyState({
  icon = "sparkles",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-surface-2 text-fg-subtle mb-3">
        <Icon name={icon} className="w-5 h-5" />
      </span>
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="text-sm text-fg-muted mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-danger-soft text-danger mb-3">
        <Icon name="alert" className="w-5 h-5" />
      </span>
      <p className="text-sm font-semibold text-fg">Something went wrong</p>
      <p className="text-sm text-fg-muted mt-1 max-w-sm">{message || "We couldn't load this data."}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <Icon name="refresh" className="w-3.5 h-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

/** Full-card error, for a page that failed entirely. */
export function ErrorCard({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <Card>
      <ErrorState message={message} onRetry={onRetry} />
    </Card>
  );
}
