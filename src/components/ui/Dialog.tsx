import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Dialog({ open, onClose, title, children, footer, wide }: Props) {
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "flex max-h-[90vh] w-full flex-col rounded-lg border border-border-strong bg-surface-1 shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-surface-3 hover:text-zinc-100"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-zinc-200">
          {children}
        </div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
