import { useEffect, useRef, type RefObject } from "react";
import type { DocumentHeading } from "../types";
import { DocumentOutline } from "./DocumentOutline";

type OutlinePopoverProps = {
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  headings: DocumentHeading[];
  busy: boolean;
  onOpenHeading: (heading: DocumentHeading) => void;
  onClose: () => void;
};

export function OutlinePopover({
  open,
  triggerRef,
  headings,
  busy,
  onOpenHeading,
  onClose,
}: OutlinePopoverProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeAndRestoreFocus() {
      onClose();
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeAndRestoreFocus();
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        closeAndRestoreFocus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose, open, triggerRef]);

  if (!open) return null;

  return (
    <section ref={panelRef} className="outline-popover utility-surface" role="dialog" aria-label="文档大纲">
      <DocumentOutline
        headings={headings}
        busy={busy}
        onOpenHeading={(heading) => {
          onOpenHeading(heading);
          onClose();
        }}
      />
    </section>
  );
}
