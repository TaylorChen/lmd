import type { ExternalChange, Notice } from "../types";

type NoticeStackProps = {
  notice: Notice | null;
  externalChange: ExternalChange | null;
  busy: boolean;
  onDismissNotice: () => void;
  onReloadCurrentFile: () => void;
};

export function NoticeStack({
  notice,
  externalChange,
  busy,
  onDismissNotice,
  onReloadCurrentFile,
}: NoticeStackProps) {
  return (
    <div className="notice-stack">
      {notice && (
        <div className={`notice ${notice.tone}`}>
          <span>{notice.message}</span>
          <button type="button" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}

      {externalChange && (
        <div className="notice warning">
          <span>
            {externalChange.kind === "missing"
              ? "This file was removed from disk."
              : "This file changed on disk."}
          </span>
          {externalChange.kind === "modified" && (
            <button type="button" onClick={onReloadCurrentFile} disabled={busy}>
              Reload
            </button>
          )}
        </div>
      )}
    </div>
  );
}
