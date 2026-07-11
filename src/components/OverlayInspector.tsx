import { useEffect, type ReactNode, type RefObject } from "react";

type OverlayInspectorProps = {
  open: boolean;
  title: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
};

export function OverlayInspector({ open, title, triggerRef, onClose, children }: OverlayInspectorProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, triggerRef]);

  if (!open) return null;

  return (
    <section className="overlay-inspector utility-surface" role="dialog" aria-label={title}>
      <header className="utility-surface-header">
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`关闭${title}`}
          onClick={() => {
            onClose();
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        >
          ×
        </button>
      </header>
      <div className="utility-surface-content">{children}</div>
    </section>
  );
}
