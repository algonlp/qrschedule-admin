import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

const control =
  "w-full h-9 px-3 text-sm rounded-lg bg-surface border border-border-strong text-fg placeholder:text-fg-subtle " +
  "transition-colors focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 " +
  "disabled:bg-surface-2 disabled:text-fg-subtle disabled:cursor-not-allowed";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(control, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(control, "pr-8 cursor-pointer", className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(control, "h-auto py-2 resize-y min-h-[4.5rem]", className)} {...props} />;
});

/** Accessible on/off switch. Controlled: pass `checked` + `onChange`. */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
  size = "md",
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const dims =
    size === "sm"
      ? { track: "w-8 h-4.5", knob: "w-3.5 h-3.5", shift: "translate-x-3.5" }
      : { track: "w-10 h-6", knob: "w-4.5 h-4.5", shift: "translate-x-4.5" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        disabled ? "opacity-45 cursor-not-allowed" : "",
        checked ? "bg-primary" : "bg-surface-hover border-border-strong",
        dims.track,
        className,
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow-sm transition-transform",
          "ml-0.5",
          dims.knob,
          checked ? dims.shift : "translate-x-0",
        )}
      />
    </button>
  );
}

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
