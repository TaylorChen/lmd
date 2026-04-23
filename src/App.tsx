import { useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { AssistantPanel } from "./components/AssistantPanel";
import { EditorToolbar } from "./components/EditorToolbar";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { LibraryRail } from "./components/LibraryRail";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { NoticeStack } from "./components/NoticeStack";
import { WorkspaceListPanel } from "./components/WorkspaceListPanel";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useEditorExtensions } from "./hooks/useEditorExtensions";
import { useExternalChangePolling } from "./hooks/useExternalChangePolling";
import { countSearchMatches, fileName, isPathInsideRoot, localStats } from "./lib/format";
import { renderMarkdownDocument } from "./lib/markdown";
import { readRecentFiles, readSettings, recentFileLimit, storageKeys, writeRecentFiles, writeSettings } from "./lib/storage";
import { invokeCommand } from "./lib/tauri";
import type {
  AssistantCatalog,
  AssistantDraft,
  ExternalChange,
  DocumentKnowledge,
  EditorMode,
  KnowledgeLintReport,
  LineRange,
  MarkdownDocument,
  Notice,
  RecentFile,
  SaveResult,
  SearchMatch,
  QueryContext,
  Workspace,
  WorkspaceFile,
} from "./types";

const largeWindowLines = 600;
const emptyDocument = `# Untitled

Start writing in Markdown.
`;

const defaultAssistantCatalog: AssistantCatalog = {
  defaultProvider: "builtin",
  providers: [
    { id: "builtin", label: "Builtin", models: ["local-summary-v1", "local-summary-v2"] },
    { id: "mock_openai", label: "Mock OpenAI", models: ["gpt-mock-1", "gpt-mock-2"] },
    { id: "external_command", label: "External Command", models: ["command-json-v1"] },
  ],
};

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
  const [settings, setSettings] = useState(() => readSettings());
  const [assistantCatalog, setAssistantCatalog] = useState<AssistantCatalog>(defaultAssistantCatalog);
  const [knownModifiedMs, setKnownModifiedMs] = useState<number | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);
  const [search, setSearch] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>(() => settings.defaultEditorMode);
  const [inspectorTab, setInspectorTab] = useState<"preview" | "knowledge" | "assistant">("preview");
  const [documentKnowledge, setDocumentKnowledge] = useState<DocumentKnowledge | null>(null);
  const [knowledgeLint, setKnowledgeLint] = useState<KnowledgeLintReport | null>(null);
  const [queryContext, setQueryContext] = useState<QueryContext | null>(null);
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);

  const isDirty = !readOnly && content !== savedContent;
  const matches = useMemo(() => countSearchMatches(content, search), [content, search]);
  const visibleEndLine =
    visibleLineCount === 0 ? 0 : Math.min(lineCount, visibleStartLine + visibleLineCount - 1);
  const canPageBack = isLarge && visibleStartLine > 1;
  const canPageForward = isLarge && visibleEndLine < lineCount;

  const extensions = useEditorExtensions(isLarge, readOnly, visibleStartLine);

  useEffect(() => {
    let cancelled = false;

    async function loadAssistantCatalog() {
      try {
        const catalog = await invokeCommand<AssistantCatalog>("assistant_catalog");
        if (!cancelled) {
          setAssistantCatalog(catalog);
        }
      } catch {
        if (!cancelled) {
          setAssistantCatalog(defaultAssistantCatalog);
        }
      }
    }

    void loadAssistantCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const selectedProvider =
      assistantCatalog.providers.find((provider) => provider.id === settings.assistantProvider) ??
      assistantCatalog.providers[0];
    if (!selectedProvider) return;

    if (selectedProvider.id !== settings.assistantProvider) {
      handleSettingsChange({
        ...settings,
        assistantProvider: selectedProvider.id,
        assistantModel: selectedProvider.models[0] ?? settings.assistantModel,
      });
      return;
    }

    if (!selectedProvider.models.includes(settings.assistantModel)) {
      handleSettingsChange({
        ...settings,
        assistantModel: selectedProvider.models[0] ?? settings.assistantModel,
      });
    }
  }, [assistantCatalog, settings]);

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

  function clearKnowledge() {
    setDocumentKnowledge(null);
    setKnowledgeLint(null);
    setQueryContext(null);
    setAssistantDraft(null);
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
    clearKnowledge();
    setNotice({ tone: "info", message: "New document ready." });
  }

  async function handleOpen() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invokeCommand<MarkdownDocument | null>("open_markdown_file");
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
      const nextWorkspace = await invokeCommand<Workspace | null>("open_workspace");
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
      const nextWorkspace = await invokeCommand<Workspace>("refresh_workspace", {
        rootPath: workspace.rootPath,
      });
      setWorkspace(nextWorkspace);
      if (!nextWorkspace.knowledge.isInitialized) {
        clearKnowledge();
      }
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

  async function handleInitializeKnowledgeWorkspace() {
    if (!workspace) {
      setNotice({ tone: "error", message: "Open a workspace before initializing knowledge mode." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const nextWorkspace = await invokeCommand<Workspace>("initialize_knowledge_workspace", {
        rootPath: workspace.rootPath,
      });
      setWorkspace(nextWorkspace);
      window.localStorage.setItem(storageKeys.lastWorkspaceRoot, nextWorkspace.rootPath);
      setWorkspaceSearchActive(false);
      setNotice({ tone: "info", message: "Knowledge workspace initialized." });
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
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path: pathToOpen });
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
      const matches = await invokeCommand<SearchMatch[]>("search_workspace", {
        rootPath: workspace.rootPath,
        query,
        maxResults: settings.searchResultLimit,
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
      const result = await invokeCommand<SaveResult | null>("save_markdown_file", {
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

  async function handleExportHtml() {
    setBusy(true);
    setNotice(null);
    try {
      const exportedPath = await invokeCommand<string | null>("export_markdown_html", {
        path,
        html: renderMarkdownDocument(fileName(path), content),
      });
      if (!exportedPath) return;
      setNotice({ tone: "info", message: `Exported HTML to ${fileName(exportedPath)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPdf() {
    setBusy(true);
    setNotice(null);
    try {
      const exportedPath = await invokeCommand<string | null>("export_markdown_pdf", {
        path,
        content,
      });
      if (!exportedPath) return;
      setNotice({ tone: "info", message: `Exported PDF to ${fileName(exportedPath)}.` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSummarizeContext() {
    if (!workspace || !path) {
      setNotice({ tone: "error", message: "Open a document inside a knowledge workspace first." });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const draft = await invokeCommand<AssistantDraft>("summarize_query_context", {
        rootPath: workspace.rootPath,
        currentPath: path,
        currentContent: isDirty ? content : undefined,
        provider: settings.assistantProvider,
        model: settings.assistantModel,
      });
      setAssistantDraft(draft);
      setNotice({ tone: "info", message: "Assistant draft generated." });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAssistantDraft() {
    if (!workspace || !assistantDraft) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const savedPath = await invokeCommand<string>("save_wiki_draft", {
        rootPath: workspace.rootPath,
        title: assistantDraft.title,
        content: assistantDraft.content,
      });
      setNotice({ tone: "info", message: `Saved wiki draft to ${fileName(savedPath)}.` });
      await handleRefreshWorkspace(false);
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
      const range = await invokeCommand<LineRange>("load_markdown_range", {
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
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path });
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
    const timeoutId = window.setTimeout(() => {
      void refreshKnowledge();
    }, 120);

    async function refreshKnowledge() {
      if (
        !workspace?.knowledge.isInitialized ||
        !path ||
        !isPathInsideRoot(path, workspace.rootPath)
      ) {
        if (!cancelled) clearKnowledge();
        return;
      }

      try {
        const [knowledge, lint, context] = await Promise.all([
          invokeCommand<DocumentKnowledge>("document_knowledge", {
            rootPath: workspace.rootPath,
            currentPath: path,
            currentContent: isDirty ? content : undefined,
          }),
          invokeCommand<KnowledgeLintReport>("knowledge_lint_report", {
            rootPath: workspace.rootPath,
          }),
          invokeCommand<QueryContext>("query_context", {
            rootPath: workspace.rootPath,
            currentPath: path,
            currentContent: isDirty ? content : undefined,
          }),
        ]);
        if (!cancelled) {
          setDocumentKnowledge(knowledge);
          setKnowledgeLint(lint);
          setQueryContext(context);
        }
      } catch {
        if (!cancelled) clearKnowledge();
      }
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [workspace, path, content, isDirty]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const lastWorkspaceRoot = window.localStorage.getItem(storageKeys.lastWorkspaceRoot);
      const lastDocumentPath = window.localStorage.getItem(storageKeys.lastDocumentPath);

      if (!lastWorkspaceRoot && !lastDocumentPath) return;

      setBusy(true);
      try {
        if (lastWorkspaceRoot) {
          const restoredWorkspace = await invokeCommand<Workspace>("refresh_workspace", {
            rootPath: lastWorkspaceRoot,
          });
          if (!cancelled) setWorkspace(restoredWorkspace);
        }

        if (lastDocumentPath) {
          const document = await invokeCommand<MarkdownDocument>("open_markdown_path", {
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

  useAppShortcuts({
    busy,
    readOnly,
    isDirty,
    workspace,
    onSave: () => void handleSave(),
    onOpen: () => void handleOpen(),
    onOpenWorkspace: () => void handleOpenWorkspace(),
    onNew: () => void handleNew(),
    onRefreshWorkspace: () => void handleRefreshWorkspace(),
  });

  useExternalChangePolling({
    path,
    knownModifiedMs,
    intervalMs: settings.externalCheckSeconds * 1000,
    onExternalChange: setExternalChange,
  });

  function handleSettingsChange(nextSettings: typeof settings) {
    setSettings(nextSettings);
    writeSettings(nextSettings);
  }

  return (
    <main className="app-shell">
      <LibraryRail
        busy={busy}
        workspace={workspace}
        isDirty={isDirty}
        onNew={() => void handleNew()}
        onOpen={() => void handleOpen()}
        onOpenWorkspace={() => void handleOpenWorkspace()}
        onInitializeKnowledgeWorkspace={() => void handleInitializeKnowledgeWorkspace()}
        onRefreshWorkspace={() => void handleRefreshWorkspace()}
        onSave={() => void handleSave()}
        onExportHtml={() => void handleExportHtml()}
        onExportPdf={() => void handleExportPdf()}
      />

      <WorkspaceListPanel
        busy={busy}
        workspace={workspace}
        workspaceQuery={workspaceQuery}
        workspaceMatches={workspaceMatches}
        workspaceSearchActive={workspaceSearchActive}
        recentFiles={recentFiles}
        path={path}
        isLarge={isLarge}
        byteSize={byteSize}
        lineCount={lineCount}
        visibleStartLine={visibleStartLine}
        visibleEndLine={visibleEndLine}
        settings={settings}
        assistantCatalog={assistantCatalog}
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
        onSettingsChange={handleSettingsChange}
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
          mode={editorMode}
          inspectorTab={inspectorTab}
          canShowKnowledge={Boolean(workspace?.knowledge.isInitialized && path)}
          onPreviousWindow={handlePreviousWindow}
          onNextWindow={handleNextWindow}
          onSearchChange={setSearch}
          onModeChange={setEditorMode}
          onInspectorTabChange={setInspectorTab}
        />

        <NoticeStack
          notice={notice}
          externalChange={externalChange}
          busy={busy}
          onDismissNotice={() => setNotice(null)}
          onReloadCurrentFile={() => void handleReloadCurrentFile()}
        />

        <div className={`document-workspace ${editorMode}`}>
          {editorMode !== "preview" && (
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
          )}

          {editorMode !== "edit" &&
            (inspectorTab === "preview" || !workspace?.knowledge.isInitialized ? (
              <MarkdownPreview content={content} />
            ) : inspectorTab === "assistant" ? (
              <AssistantPanel
                busy={busy}
                queryContext={queryContext}
                draft={assistantDraft}
                settings={settings}
                onSummarize={() => void handleSummarizeContext()}
                onSaveDraft={() => void handleSaveAssistantDraft()}
              />
            ) : (
              <KnowledgePanel
                knowledge={documentKnowledge}
                lint={knowledgeLint}
                queryContext={queryContext}
                workspaceIndexPath={workspace ? `${workspace.knowledge.wikiPath}/index.md` : null}
                workspaceLogPath={workspace ? `${workspace.knowledge.wikiPath}/log.md` : null}
                busy={busy}
                onOpenPath={(nextPath, name) => void openPath(nextPath, name)}
              />
            ))}
        </div>
      </section>
    </main>
  );
}
