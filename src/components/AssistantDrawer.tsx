import { useEffect, type ReactNode, type RefObject } from "react";

type AssistantDrawerProps = {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
};

export function AssistantDrawer({ open, triggerRef, onClose, children }: AssistantDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function closeAndRestoreFocus() {
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeAndRestoreFocus();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, triggerRef]);

  if (!open) return null;

  function closeAndRestoreFocus() {
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        type="button"
        className="assistant-drawer-backdrop"
        aria-label="关闭 AI 助手"
        onClick={closeAndRestoreFocus}
      />
      <section className="assistant-drawer utility-surface" role="dialog" aria-label="AI 助手">
        <header className="utility-surface-header">
          <strong>AI 助手</strong>
          <button type="button" aria-label="关闭 AI 助手" onClick={closeAndRestoreFocus}>
            ×
          </button>
        </header>
        <div className="assistant-drawer-content">{children}</div>
      </section>
    </>
  );
}
