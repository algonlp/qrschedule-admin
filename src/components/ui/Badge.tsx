import { cn } from "./utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-muted border-border",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  primary: "bg-primary-soft text-primary border-transparent",
};

/** Canonical status -> tone map. Add new statuses here, never per-page. */
const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  live: "success",
  approved: "success",
  paid: "success",
  succeeded: "success",
  completed: "success",
  on: "success",
  fresh: "success",

  pending: "warning",
  pending_review: "warning",
  trialing: "warning",
  stale: "warning",
  processing: "warning",
  "setup incomplete": "warning",
  setup: "warning",

  failed: "danger",
  rejected: "danger",
  cancelled: "danger",
  canceled: "danger",
  expired: "danger",
  past_due: "danger",
  loss: "danger",
  off: "danger",

  inactive: "neutral",
  refunded: "neutral",
  unknown: "neutral",
  draft: "neutral",
  "not tracked": "neutral",
  "not_required": "neutral",

  manual: "info",
  booked: "info",
  sent: "info",
};

export function Badge({
  children,
  tone,
  className,
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap",
        TONE[tone ?? "neutral"],
        className,
      )}
    >
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Badge that picks its tone from a status string. */
export function StatusBadge({ status, className, dot }: { status: string; className?: string; dot?: boolean }) {
  const key = status.toLowerCase().trim();
  const tone = STATUS_TONE[key] ?? "neutral";
  const label = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge tone={tone} className={className} dot={dot}>
      {label}
    </Badge>
  );
}
