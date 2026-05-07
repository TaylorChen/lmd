import { useEffect, useState } from "react";

type TagRenameDialogProps = {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (oldTag: string, newTag: string) => void;
};

export function TagRenameDialog({ open, busy, onCancel, onSubmit }: TagRenameDialogProps) {
  const [oldTag, setOldTag] = useState("");
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    if (!open) return;
    setOldTag("");
    setNewTag("");
  }, [open]);

  if (!open) return null;

  return (
    <div className="name-dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <form
        className="name-dialog"
        role="dialog"
        aria-label="重命名标签"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const from = oldTag.trim().replace(/^#/, "");
          const to = newTag.trim().replace(/^#/, "");
          if (!from || !to) return;
          onSubmit(from, to);
        }}
      >
        <header>
          <strong>重命名标签</strong>
        </header>
        <label>
          <span>原标签</span>
          <input
            autoFocus
            aria-label="原标签"
            value={oldTag}
            onChange={(event) => setOldTag(event.target.value)}
            placeholder="old-tag"
          />
        </label>
        <label>
          <span>新标签</span>
          <input
            aria-label="新标签"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder="new-tag"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <footer>
          <button type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="submit" disabled={busy || !oldTag.trim() || !newTag.trim()}>
            重命名
          </button>
        </footer>
      </form>
    </div>
  );
}
