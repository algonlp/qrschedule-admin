"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "./utils";
import { Icon } from "./Icon";

type ToastKind = "success" | "error" | "info";
type Toast = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++seq;
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, "success"),
    error: (m) => toast(m, "error"),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const id = setTimeout(onClose, 4200);
    return () => clearTimeout(id);
  }, [onClose]);

  const tone =
    toast.kind === "success"
      ? "border-success/30 bg-surface"
      : toast.kind === "error"
        ? "border-danger/30 bg-surface"
        : "border-border bg-surface";
  const iconTone = toast.kind === "success" ? "text-success" : toast.kind === "error" ? "text-danger" : "text-info";
  const icon = toast.kind === "success" ? "check" : toast.kind === "error" ? "alert" : "info";

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-md qs-animate-in",
        tone,
      )}
    >
      <Icon name={icon} className={cn("w-4 h-4 mt-0.5 shrink-0", iconTone)} />
      <p className="text-sm text-fg flex-1">{toast.message}</p>
      <button onClick={onClose} aria-label="Dismiss" className="text-fg-subtle hover:text-fg cursor-pointer shrink-0">
        <Icon name="x" className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
