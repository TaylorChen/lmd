import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { EditorToolbar } from "./components/EditorToolbar";
import { NoticeStack } from "./components/NoticeStack";
import { Sidebar } from "./components/Sidebar";
import { countSearchMatches, fileName, isPathInsideRoot, localStats } from "./lib/format";
import { readRecentFiles, recentFileLimit, storageKeys, writeRecentFiles } from "./lib/storage";
import type {
  ExternalChange,
  FileMetadata,
  LineRange,
  MarkdownDocument,
  Notice,
  RecentFile,
  SaveResult,
  SearchMatch,
  Workspace,
  WorkspaceFile,
} from "./types";

const largeWindowLines = 600;
const emptyDocument = `# Untitled

Start writing in Markdown.
`;

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
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles());
  const [knownModifiedMs, setKnownModifiedMs] = useState<number | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);
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
    setKnownModifiedMs(document.modifiedMs);
    setExternalChange(null);
    setIsLarge(document.isLarge);
    setReadOnly(document.readOnly);
    setVisibleStartLine(document.visibleStartLine);
    setVisibleLineCount(document.visibleLineCount);
    setSearch("");
  }

  function rememberDocument(documentPath: string) {
    const recentFile = {
      path: documentPath,
      name: fileName(documentPath),
    };

    setRecentFiles((currentRecentFiles) => {
      const nextRecentFiles = [
        recentFile,
        ...currentRecentFiles.filter((file) => file.path !== documentPath),
      ].slice(0, recentFileLimit);
      writeRecentFiles(nextRecentFiles);
      return nextRecentFiles;
    });
    window.localStorage.setItem(storageKeys.lastDocumentPath, documentPath);
  }

  async function handleNew() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    setContent(emptyDocument);
    setSavedContent(emptyDocument);
    setPath(null);
    setByteSize(emptyDocument.length);
    setLineCount(3);
    setKnownModifiedMs(null);
    setExternalChange(null);
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
      rememberDocument(document.path);
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
      window.localStorage.setItem(storageKeys.lastWorkspaceRoot, nextWorkspace.rootPath);
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

  async function handleRefreshWorkspace(showNotice = true) {
    if (!workspace) {
      setNotice({ tone: "error", message: "Open a workspace before refreshing." });
      return;
    }

    setBusy(true);
    if (showNotice) setNotice(null);
    try {
      const nextWorkspace = await invoke<Workspace>("refresh_workspace", {
        rootPath: workspace.rootPath,
      });
      setWorkspace(nextWorkspace);
      window.localStorage.setItem(storageKeys.lastWorkspaceRoot, nextWorkspace.rootPath);
      setWorkspaceSearchActive(false);
      if (showNotice) {
        setNotice({
          tone: "info",
          message: `Refreshed workspace with ${nextWorkspace.files.length.toLocaleString()} files.`,
        });
      }
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
      rememberDocument(document.path);
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
    if (
      externalChange?.kind === "modified" &&
      !window.confirm("This file changed on disk. Save anyway and overwrite the external changes?")
    ) {
      return;
    }
    if (
      externalChange?.kind === "missing" &&
      !window.confirm("This file was removed from disk. Save anyway and recreate it?")
    ) {
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
      setKnownModifiedMs(result.modifiedMs);
      setExternalChange(null);
      rememberDocument(result.path);
      if (workspace && isPathInsideRoot(result.path, workspace.rootPath)) {
        void handleRefreshWorkspace(false);
      }
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

  async function handleReloadCurrentFile() {
    if (!path) return;
    if (isDirty && !window.confirm("Discard unsaved changes and reload from disk?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invoke<MarkdownDocument>("open_markdown_path", { path });
      applyDocument(document);
      rememberDocument(document.path);
      setNotice({ tone: "info", message: `Reloaded ${fileName(document.path)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const lastWorkspaceRoot = window.localStorage.getItem(storageKeys.lastWorkspaceRoot);
      const lastDocumentPath = window.localStorage.getItem(storageKeys.lastDocumentPath);

      if (!lastWorkspaceRoot && !lastDocumentPath) return;

      setBusy(true);
      try {
        if (lastWorkspaceRoot) {
          const restoredWorkspace = await invoke<Workspace>("refresh_workspace", {
            rootPath: lastWorkspaceRoot,
          });
          if (!cancelled) setWorkspace(restoredWorkspace);
        }

        if (lastDocumentPath) {
          const document = await invoke<MarkdownDocument>("open_markdown_path", {
            path: lastDocumentPath,
          });
          if (!cancelled) {
            applyDocument(document);
            rememberDocument(document.path);
          }
        }

        if (!cancelled) {
          setNotice({ tone: "info", message: "Restored previous session." });
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ tone: "error", message: `Could not restore previous session: ${String(error)}` });
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || event.altKey || event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (!busy && !readOnly && isDirty) void handleSave();
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        if (!busy) void handleOpenWorkspace();
      } else if (key === "o") {
        event.preventDefault();
        if (!busy) void handleOpen();
      } else if (key === "n") {
        event.preventDefault();
        if (!busy) void handleNew();
      } else if (key === "r") {
        event.preventDefault();
        if (!busy && workspace) void handleRefreshWorkspace();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, content, isDirty, path, readOnly, savedContent, workspace]);

  useEffect(() => {
    if (!path || !knownModifiedMs) return;

    let cancelled = false;
    async function checkCurrentFile() {
      try {
        const metadata = await invoke<FileMetadata>("file_metadata", { path });
        if (cancelled) return;

        if (!metadata.exists) {
          setExternalChange({ kind: "missing" });
          return;
        }

        if (metadata.modifiedMs && metadata.modifiedMs !== knownModifiedMs) {
          setExternalChange({
            kind: "modified",
            modifiedMs: metadata.modifiedMs,
            byteSize: metadata.byteSize,
          });
        }
      } catch {
        // External change checks should not interrupt editing.
      }
    }

    const interval = window.setInterval(() => {
      void checkCurrentFile();
    }, 5000);
    void checkCurrentFile();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [knownModifiedMs, path]);

  return (
    <main className="app-shell">
      <Sidebar
        busy={busy}
        workspace={workspace}
        workspaceQuery={workspaceQuery}
        workspaceMatches={workspaceMatches}
        workspaceSearchActive={workspaceSearchActive}
        recentFiles={recentFiles}
        path={path}
        isLarge={isLarge}
        isDirty={isDirty}
        byteSize={byteSize}
        lineCount={lineCount}
        visibleStartLine={visibleStartLine}
        visibleEndLine={visibleEndLine}
        onNew={() => void handleNew()}
        onOpen={() => void handleOpen()}
        onOpenWorkspace={() => void handleOpenWorkspace()}
        onRefreshWorkspace={() => void handleRefreshWorkspace()}
        onSave={() => void handleSave()}
        onWorkspaceQueryChange={(query) => {
          setWorkspaceQuery(query);
          setWorkspaceSearchActive(false);
          if (!query.trim()) {
            setWorkspaceMatches([]);
          }
        }}
        onWorkspaceSearch={() => void handleWorkspaceSearch()}
        onOpenWorkspaceFile={(file) => void handleOpenWorkspaceFile(file)}
        onOpenSearchMatch={(match) => void handleOpenSearchMatch(match)}
        onOpenRecentFile={(recentPath, name) => void openPath(recentPath, name)}
      />

      <section className="editor-pane">
        <EditorToolbar
          path={path}
          readOnly={readOnly}
          isDirty={isDirty}
          isLarge={isLarge}
          visibleStartLine={visibleStartLine}
          visibleEndLine={visibleEndLine}
          busy={busy}
          canPageBack={canPageBack}
          canPageForward={canPageForward}
          search={search}
          matches={matches}
          onPreviousWindow={handlePreviousWindow}
          onNextWindow={handleNextWindow}
          onSearchChange={setSearch}
        />

        <NoticeStack
          notice={notice}
          externalChange={externalChange}
          busy={busy}
          onDismissNotice={() => setNotice(null)}
          onReloadCurrentFile={() => void handleReloadCurrentFile()}
        />

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
