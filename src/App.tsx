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
  isLarge: boolean;
  readOnly: boolean;
  visibleStartLine: number;
  visibleLineCount: number;
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

type LineRange = {
  content: string;
  startLine: number;
  lineCount: number;
};

type WorkspaceFile = {
  path: string;
  relativePath: string;
  name: string;
  byteSize: number;
};

type Workspace = {
  rootPath: string;
  files: WorkspaceFile[];
};

type SearchMatch = {
  path: string;
  relativePath: string;
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
};

type Notice = {
  tone: "info" | "error";
  message: string;
};

const largeWindowLines = 600;
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
  const [isLarge, setIsLarge] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [visibleStartLine, setVisibleStartLine] = useState(1);
  const [visibleLineCount, setVisibleLineCount] = useState(3);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [workspaceMatches, setWorkspaceMatches] = useState<SearchMatch[]>([]);
  const [workspaceSearchActive, setWorkspaceSearchActive] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const isDirty = !readOnly && content !== savedContent;
  const matches = useMemo(() => countSearchMatches(content, search), [content, search]);
  const visibleEndLine =
    visibleLineCount === 0 ? 0 : Math.min(lineCount, visibleStartLine + visibleLineCount - 1);
  const canPageBack = isLarge && visibleStartLine > 1;
  const canPageForward = isLarge && visibleEndLine < lineCount;

  const extensions = useMemo(
    () => [
      lineNumbers({
        formatNumber: (lineNo) => String(isLarge ? visibleStartLine + lineNo - 1 : lineNo),
      }),
      history(),
      markdown(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
    ],
    [isLarge, readOnly, visibleStartLine],
  );

  function applyDocument(document: MarkdownDocument) {
    setContent(document.content);
    setSavedContent(document.content);
    setPath(document.path);
    setByteSize(document.byteSize);
    setLineCount(document.lineCount);
    setIsLarge(document.isLarge);
    setReadOnly(document.readOnly);
    setVisibleStartLine(document.visibleStartLine);
    setVisibleLineCount(document.visibleLineCount);
    setSearch("");
  }

  async function handleNew() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    setContent(emptyDocument);
    setSavedContent(emptyDocument);
    setPath(null);
    setByteSize(emptyDocument.length);
    setLineCount(3);
    setIsLarge(false);
    setReadOnly(false);
    setVisibleStartLine(1);
    setVisibleLineCount(3);
    setSearch("");
    setNotice({ tone: "info", message: "New document ready." });
  }

  async function handleOpen() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invoke<MarkdownDocument | null>("open_markdown_file");
      if (!document) return;
      applyDocument(document);
      setNotice({
        tone: "info",
        message: document.isLarge
          ? `Opened ${fileName(document.path)} in read-only large-file mode.`
          : `Opened ${fileName(document.path)}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenWorkspace() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const nextWorkspace = await invoke<Workspace | null>("open_workspace");
      if (!nextWorkspace) return;
      setWorkspace(nextWorkspace);
      setWorkspaceQuery("");
      setWorkspaceMatches([]);
      setWorkspaceSearchActive(false);
      setNotice({
        tone: "info",
        message: `Opened workspace with ${nextWorkspace.files.length.toLocaleString()} files.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openPath(pathToOpen: string, displayName: string) {
    if (pathToOpen === path) return;
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invoke<MarkdownDocument>("open_markdown_path", { path: pathToOpen });
      applyDocument(document);
      setNotice({
        tone: "info",
        message: document.isLarge
          ? `Opened ${displayName} in read-only large-file mode.`
          : `Opened ${displayName}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenWorkspaceFile(file: WorkspaceFile) {
    await openPath(file.path, file.name);
  }

  async function handleOpenSearchMatch(match: SearchMatch) {
    await openPath(match.path, `${match.relativePath}:${match.lineNumber}`);
  }

  async function handleWorkspaceSearch() {
    if (!workspace) {
      setNotice({ tone: "error", message: "Open a workspace before searching." });
      return;
    }

    const query = workspaceQuery.trim();
    if (!query) {
      setWorkspaceMatches([]);
      setWorkspaceSearchActive(false);
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const matches = await invoke<SearchMatch[]>("search_workspace", {
        rootPath: workspace.rootPath,
        query,
        maxResults: 80,
      });
      setWorkspaceMatches(matches);
      setWorkspaceSearchActive(true);
      setNotice({
        tone: "info",
        message: `Found ${matches.length.toLocaleString()} workspace matches.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (readOnly) {
      setNotice({ tone: "error", message: "Large files are read-only in this version." });
      return;
    }

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
    if (readOnly) return;
    setContent(nextContent);
    const stats = localStats(nextContent);
    setByteSize(stats.byteSize);
    setLineCount(stats.lineCount);
    setVisibleStartLine(stats.lineCount === 0 ? 0 : 1);
    setVisibleLineCount(stats.lineCount);
  }

  async function loadRange(startLine: number) {
    if (!path || !isLarge) return;
    setBusy(true);
    setNotice(null);
    try {
      const range = await invoke<LineRange>("load_markdown_range", {
        path,
        startLine,
        lineCount: largeWindowLines,
      });
      setContent(range.content);
      setSavedContent(range.content);
      setVisibleStartLine(range.startLine);
      setVisibleLineCount(range.lineCount);
      setNotice({
        tone: "info",
        message: `Loaded lines ${range.startLine.toLocaleString()}-${(
          range.startLine +
          range.lineCount -
          1
        ).toLocaleString()}.`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function handlePreviousWindow() {
    void loadRange(Math.max(1, visibleStartLine - largeWindowLines));
  }

  function handleNextWindow() {
    void loadRange(visibleStartLine + largeWindowLines);
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
          <button type="button" onClick={handleOpenWorkspace} disabled={busy}>
            Workspace
          </button>
          <button type="button" onClick={handleSave} disabled={busy || !isDirty}>
            Save
          </button>
        </div>

        <div className="workspace-panel">
          <div className="workspace-header">
            <span className="label">Workspace</span>
            <small>{workspace ? `${workspace.files.length.toLocaleString()} files` : "None"}</small>
          </div>

          {workspace ? (
            <>
              <strong title={workspace.rootPath}>{fileName(workspace.rootPath)}</strong>
              <form
                className="workspace-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleWorkspaceSearch();
                }}
              >
                <input
                  value={workspaceQuery}
                  onChange={(event) => {
                    setWorkspaceQuery(event.target.value);
                    setWorkspaceSearchActive(false);
                    if (!event.target.value.trim()) {
                      setWorkspaceMatches([]);
                    }
                  }}
                  placeholder="Search workspace"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !workspaceQuery.trim()}>
                  Find
                </button>
              </form>
              <div className="file-list" aria-label="Workspace files">
                {workspaceSearchActive ? (
                  workspaceMatches.length > 0 ? (
                    workspaceMatches.map((match, index) => (
                      <button
                        type="button"
                        key={`${match.path}:${match.lineNumber}:${index}`}
                        className={`file-item search-result ${match.path === path ? "active" : ""}`}
                        onClick={() => void handleOpenSearchMatch(match)}
                        disabled={busy}
                        title={`${match.relativePath}:${match.lineNumber}`}
                      >
                        <span>{match.relativePath}</span>
                        <small>Line {match.lineNumber.toLocaleString()}</small>
                        <em>{match.lineText}</em>
                      </button>
                    ))
                  ) : (
                    <p className="empty-workspace">No matches found.</p>
                  )
                ) : workspace.files.length > 0 ? (
                  workspace.files.map((file) => (
                    <button
                      type="button"
                      key={file.path}
                      className={`file-item ${file.path === path ? "active" : ""}`}
                      onClick={() => void handleOpenWorkspaceFile(file)}
                      disabled={busy}
                      title={file.relativePath}
                    >
                      <span>{file.relativePath}</span>
                      <small>{formatBytes(file.byteSize)}</small>
                    </button>
                  ))
                ) : (
                  <p className="empty-workspace">No Markdown files found.</p>
                )}
              </div>
            </>
          ) : (
            <p className="empty-workspace">Open a folder to browse notes.</p>
          )}
        </div>

        <div className="document-card">
          <span className="label">Document</span>
          <strong>{fileName(path)}</strong>
          <small title={path ?? undefined}>{path ?? "Not saved yet"}</small>
        </div>

        {isLarge && (
          <div className="large-file-card">
            <span className="label">Large file</span>
            <strong>Read-only window</strong>
            <small>
              Lines {visibleStartLine.toLocaleString()}-{visibleEndLine.toLocaleString()}
            </small>
          </div>
        )}

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
            <p>
              {readOnly
                ? `Read-only lines ${visibleStartLine.toLocaleString()}-${visibleEndLine.toLocaleString()}`
                : isDirty
                  ? "Unsaved changes"
                  : "All changes saved"}
            </p>
          </div>

          {isLarge && (
            <div className="range-controls">
              <button type="button" onClick={handlePreviousWindow} disabled={busy || !canPageBack}>
                Previous
              </button>
              <button type="button" onClick={handleNextWindow} disabled={busy || !canPageForward}>
                Next
              </button>
            </div>
          )}

          <label className="search-box">
            <span>{isLarge ? "Search window" : "Search"}</span>
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
