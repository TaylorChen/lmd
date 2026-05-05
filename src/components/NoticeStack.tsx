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
            关闭
          </button>
        </div>
      )}

      {externalChange && (
        <div className="notice warning">
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
