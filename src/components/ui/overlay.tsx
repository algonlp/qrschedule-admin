"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { cn } from "./utils";
import { Icon } from "./Icon";
import { Button } from "./Button";

function useLockBody(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

/** Centered modal — for confirmations and small/medium forms. */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useLockBody(open);
  useEscape(onClose);
  if (!open) return null;
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 qs-animate-in" onClick={onClose} />
      <div className={cn("relative w-full bg-surface border border-border rounded-2xl shadow-pop qs-animate-scale max-h-[90vh] flex flex-col", width)}>
        {(title || description) && (
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-border">
            <div>
              {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
              {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-fg-subtle hover:text-fg cursor-pointer -mr-1 -mt-0.5">
              <Icon name="x" className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-surface-2/50">{footer}</div>}
      </div>
    </div>
  );
}

/** Right-side drawer — for detail records and long content. */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  useLockBody(open);
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 qs-animate-in" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border shadow-pop qs-animate-drawer flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 h-14 border-b border-border shrink-0">
          {title && <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>}
          <button onClick={onClose} aria-label="Close" className="text-fg-subtle hover:text-fg cursor-pointer">
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

type ConfirmOptions = {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
};

/**
 * Imperative confirm dialog. Usage:
 *   const [confirm, confirmDialog] = useConfirm();
 *   ...
 *   if (await confirm({ title, body })) doThing();
 *   ...
 *   return <>{confirmDialog}</>;
 */
export function useConfirm(): [(o: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  const dialog = state ? (
    <Modal
      open
      onClose={() => close(false)}
      title={state.title}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => close(false)}>
            {state.cancelLabel ?? "Cancel"}
          </Button>
          <Button variant={state.tone === "danger" ? "danger" : "primary"} size="sm" onClick={() => close(true)}>
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      <div className="text-sm text-fg-muted">{state.body}</div>
    </Modal>
  ) : null;

  return [confirm, dialog];
}
