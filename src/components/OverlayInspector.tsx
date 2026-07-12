import { useEffect, type ReactNode } from "react";

export type ActiveUtility = "outline" | "knowledge" | "assistant" | null;

type OverlayInspectorProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  onRestoreFocus?: () => void;
  children: ReactNode;
};

export function OverlayInspector({ open, title, onClose, onRestoreFocus, children }: OverlayInspectorProps) {
  useEffect(() => {
    if (!open) return;
    function closeAndRestoreFocus() {
      onClose();
      requestAnimationFrame(() => onRestoreFocus?.());
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeAndRestoreFocus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, onRestoreFocus, open]);

  if (!open) return null;

  return (
    <section className="overlay-inspector utility-surface" role="dialog" aria-label={title}>
      <header className="utility-surface-header">
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`关闭 ${title}`}
          onClick={() => {
            onClose();
            requestAnimationFrame(() => onRestoreFocus?.());
          }}
        >
          ×
        </button>
      </header>
      <div className="utility-surface-content">{children}</div>
    </section>
  );
}
