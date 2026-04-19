import { useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

type MarkdownDocument = {
  path: string;
  content: string;
  byteSize: number;
  lineCount: number;
};

type SaveResult = {
  path: string;
  byteSize: number;
  lineCount: number;
};

type DocumentStats = {
  byteSize: number;
  lineCount: number;
};

type Notice = {
  tone: "info" | "error";
  message: string;
};

const emptyDocument = `# Untitled

Start writing in Markdown.
`;

function fileName(path: string | null) {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() || path;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function localStats(content: string): DocumentStats {
  return {
    byteSize: new TextEncoder().encode(content).length,
    lineCount: content ? content.split(/\r\n|\r|\n/).length : 0,
  };
}

function countSearchMatches(content: string, query: string) {
  const term = query.trim();
  if (!term) return 0;

  let count = 0;
  let index = 0;
  const haystack = content.toLowerCase();
  const needle = term.toLowerCase();

  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }

  return count;
}

export default function App() {
  const [content, setContent] = useState(emptyDocument);
  const [savedContent, setSavedContent] = useState(emptyDocument);
  const [path, setPath] = useState<string | null>(null);
  const [byteSize, setByteSize] = useState(emptyDocument.length);
  const [lineCount, setLineCount] = useState(3);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const isDirty = content !== savedContent;
  const matches = useMemo(() => countSearchMatches(content, search), [content, search]);

  const extensions = useMemo(
    () => [
      lineNumbers(),
      history(),
      markdown(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
    ],
    [],
  );

  async function handleNew() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    setContent(emptyDocument);
    setSavedContent(emptyDocument);
    setPath(null);
    setByteSize(emptyDocument.length);
    setLineCount(3);
    setNotice({ tone: "info", message: "New document ready." });
  }

  async function handleOpen() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invoke<MarkdownDocument | null>("open_markdown_file");
      if (!document) return;
      setContent(document.content);
      setSavedContent(document.content);
      setPath(document.path);
      setByteSize(document.byteSize);
      setLineCount(document.lineCount);
      setNotice({ tone: "info", message: `Opened ${fileName(document.path)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await invoke<SaveResult | null>("save_markdown_file", {
        path,
        content,
      });
      if (!result) return;
      setPath(result.path);
      setSavedContent(content);
      setByteSize(result.byteSize);
      setLineCount(result.lineCount);
      setNotice({ tone: "info", message: `Saved ${fileName(result.path)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function handleChange(nextContent: string) {
    setContent(nextContent);
    const stats = localStats(nextContent);
    setByteSize(stats.byteSize);
    setLineCount(stats.lineCount);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="app-mark">LMD</div>
          <p className="sidebar-copy">Light Markdown</p>
        </div>

        <div className="sidebar-actions">
          <button type="button" onClick={handleNew} disabled={busy}>
            New
          </button>
          <button type="button" onClick={handleOpen} disabled={busy}>
            Open
          </button>
          <button type="button" onClick={handleSave} disabled={busy || !isDirty}>
            Save
          </button>
        </div>

        <div className="document-card">
          <span className="label">Document</span>
          <strong>{fileName(path)}</strong>
          <small title={path ?? undefined}>{path ?? "Not saved yet"}</small>
        </div>

        <div className="stats-grid">
          <div>
            <span>{formatBytes(byteSize)}</span>
            <small>Size</small>
          </div>
          <div>
            <span>{lineCount.toLocaleString()}</span>
            <small>Lines</small>
          </div>
        </div>
      </aside>

      <section className="editor-pane">
        <header className="toolbar">
          <div>
            <h1>{fileName(path)}</h1>
            <p>{isDirty ? "Unsaved changes" : "All changes saved"}</p>
          </div>

          <label className="search-box">
            <span>Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find in document"
            />
            <strong>{search.trim() ? matches : 0}</strong>
          </label>
        </header>

        {notice && (
          <div className={`notice ${notice.tone}`}>
            <span>{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        <div className="editor-frame">
          <CodeMirror
            value={content}
            height="100%"
            basicSetup={false}
            extensions={extensions}
            onChange={handleChange}
            theme="light"
          />
        </div>
      </section>
    </main>
  );
}
