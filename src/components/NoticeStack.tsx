import { useEffect, useRef } from "react";
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
  // Notification discipline: routine success is quiet, but important results remain
  // visible until dismissed. Errors always demand attention. The callback is held in
  // a ref so an unrelated re-render can't restart the timer.
  const dismissRef = useRef(onDismissNotice);
  dismissRef.current = onDismissNotice;
  useEffect(() => {
    if (notice?.tone !== "info" || notice.dismissAfterMs === null) return;
    const timer = window.setTimeout(() => dismissRef.current(), notice.dismissAfterMs ?? 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className="notice-stack" aria-live="polite">
      {notice && (
        <div className={`notice ${notice.tone}`} role="status">
          <span>{notice.message}</span>
          <button type="button" onClick={onDismissNotice} aria-label="关闭通知">
            关闭
          </button>
        </div>
      )}

      {externalChange && (
        <div className="notice warning" role="status">
          <span>
            {externalChange.kind === "missing"
              ? "该文件已从磁盘中删除。"
              : "该文件已在磁盘中被修改。"}
          </span>
          {externalChange.kind === "modified" && (
            <button type="button" onClick={onReloadCurrentFile} disabled={busy}>
              重新加载
            </button>
          )}
        </div>
      )}
    </div>
  );
}
