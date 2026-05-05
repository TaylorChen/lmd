import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import { AssistantPanel } from "./components/AssistantPanel";
import { EditorToolbar, type MarkdownAction } from "./components/EditorToolbar";
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
  AssistantEvent,
  AssistantProvider,
  ExternalChange,
  DocumentKnowledge,
  EditorMode,
  KnowledgeLintReport,
  LibrarySection,
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
const emptyDocument = `# 未命名

开始写 Markdown。
`;

const defaultAssistantCatalog: AssistantCatalog = {
  defaultProvider: "deepseek",
  providers: [
    {
      id: "deepseek",
      label: "DeepSeek",
      models: ["deepseek-v4-flash", "deepseek-v4-pro"],
      baseUrl: "https://api.deepseek.com/chat/completions",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
    {
      id: "minimax",
      label: "MiniMax",
      models: ["MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2"],
      baseUrl: "https://api.minimaxi.com/v1/chat/completions",
      apiKeyEnv: "MINIMAX_API_KEY",
    },
    {
      id: "kimi",
      label: "Kimi",
      models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k"],
      baseUrl: "https://api.moonshot.cn/v1/chat/completions",
      apiKeyEnv: "MOONSHOT_API_KEY",
    },
    {
      id: "zhipu",
      label: "智谱 GLM",
      models: ["glm-5.1", "glm-4.7", "glm-4.5"],
      baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      apiKeyEnv: "ZAI_API_KEY",
    },
    { id: "external_command", label: "外部命令", models: ["command-json-v1"] },
  ],
};

export default function App() {
  const editorViewRef = useRef<EditorView | null>(null);
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
  const [librarySection, setLibrarySection] = useState<LibrarySection>("all-notes");
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles());
  const [settings, setSettings] = useState(() => readSettings());
  const [assistantCatalog, setAssistantCatalog] = useState<AssistantCatalog>(defaultAssistantCatalog);
  const [knownModifiedMs, setKnownModifiedMs] = useState<number | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);
  const [search, setSearch] = useState("");
  const [editorMode, setEditorMode] = useState<EditorMode>(() => settings.defaultEditorMode);
  const [inspectorTab, setInspectorTab] = useState<"knowledge" | "assistant">("assistant");
  const [documentKnowledge, setDocumentKnowledge] = useState<DocumentKnowledge | null>(null);
  const [knowledgeLint, setKnowledgeLint] = useState<KnowledgeLintReport | null>(null);
  const [queryContext, setQueryContext] = useState<QueryContext | null>(null);
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [assistantEvents, setAssistantEvents] = useState<AssistantEvent[]>([]);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [busy, setBusy] = useState(false);

  const isDirty = !readOnly && content !== savedContent;
  const matches = useMemo(() => countSearchMatches(content, search), [content, search]);
  const visibleEndLine =
    visibleLineCount === 0 ? 0 : Math.min(lineCount, visibleStartLine + visibleLineCount - 1);
  const canPageBack = isLarge && visibleStartLine > 1;
  const canPageForward = isLarge && visibleEndLine < lineCount;

  const extensions = useEditorExtensions(isLarge, readOnly, visibleStartLine);
  const workspaceFiles = useMemo(() => {
    if (!workspace) return [];

    return workspace.files.filter((file) => {
      if (librarySection === "notes") return file.relativePath.startsWith("notes/");
      if (librarySection === "sources") return file.relativePath.startsWith("sources/");
      if (librarySection === "wiki") return file.relativePath.startsWith("wiki/");
      if (librarySection === "inbox") return file.relativePath.startsWith("wiki/inbox/");
      return true;
    });
  }, [librarySection, workspace]);

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
    setAssistantEvents([]);
  }

  function appendAssistantEvent(event: AssistantEvent) {
    setAssistantEvents((currentEvents) => [...currentEvents, event].slice(-8));
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
    if (isDirty && !window.confirm("放弃未保存的更改？")) return;
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
    setNotice({ tone: "info", message: "新文档已就绪。" });
  }

  async function handleOpen() {
    if (isDirty && !window.confirm("放弃未保存的更改？")) return;

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
          ? `已用大文件只读模式打开 ${fileName(document.path)}。`
          : `已打开 ${fileName(document.path)}。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenWorkspace() {
    if (isDirty && !window.confirm("放弃未保存的更改？")) return;

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
        message: `已打开工作区，共 ${nextWorkspace.files.length.toLocaleString()} 个文件。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshWorkspace(showNotice = true) {
    if (!workspace) {
      setNotice({ tone: "error", message: "请先打开工作区再刷新。" });
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
          message: `工作区已刷新，共 ${nextWorkspace.files.length.toLocaleString()} 个文件。`,
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
      setNotice({ tone: "error", message: "请先打开工作区再初始化知识库模式。" });
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
      setNotice({ tone: "info", message: "知识库工作区已初始化。" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openPath(pathToOpen: string, displayName: string) {
    if (pathToOpen === path) return;
    if (isDirty && !window.confirm("放弃未保存的更改？")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path: pathToOpen });
      applyDocument(document);
      rememberDocument(document.path);
      setNotice({
        tone: "info",
        message: document.isLarge
          ? `已用大文件只读模式打开 ${displayName}。`
          : `已打开 ${displayName}。`,
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
      setNotice({ tone: "error", message: "请先打开工作区再搜索。" });
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
        message: `找到 ${matches.length.toLocaleString()} 条工作区匹配结果。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (readOnly) {
      setNotice({ tone: "error", message: "当前版本中大文件为只读模式。" });
      return;
    }
    if (
      externalChange?.kind === "modified" &&
      !window.confirm("该文件已在磁盘中被修改。仍要保存并覆盖外部更改吗？")
    ) {
      return;
    }
    if (
      externalChange?.kind === "missing" &&
      !window.confirm("该文件已从磁盘中删除。仍要保存并重新创建它吗？")
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
      setNotice({ tone: "info", message: `已保存 ${fileName(result.path)}。` });
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
      setNotice({ tone: "info", message: `已导出 HTML 到 ${fileName(exportedPath)}。` });
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
      setNotice({ tone: "info", message: `已导出 PDF 到 ${fileName(exportedPath)}。` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function assistantProviderConfig(provider: AssistantProvider) {
    const providerInfo = assistantCatalog.providers.find((item) => item.id === provider);
    return {
      apiKey: settings.assistantApiKeys[provider],
      baseUrl: settings.assistantBaseUrls[provider] || providerInfo?.baseUrl,
      externalCommand: settings.assistantExternalCommand,
      externalTimeoutSeconds: settings.assistantExternalTimeoutSeconds,
    };
  }

  async function handleAssistantRun(task: string, prompt = "") {
    if (!workspace || !path) {
      setNotice({ tone: "error", message: "请先打开知识库工作区中的文档。" });
      return;
    }

    const providerConfig = assistantProviderConfig(settings.assistantProvider);
    setBusy(true);
    setNotice(null);
    appendAssistantEvent({
      label: "已请求 AI",
      detail: `${settings.assistantProvider} / ${settings.assistantModel}`,
      tone: "info",
    });
    try {
      const draft = await invokeCommand<AssistantDraft>("summarize_query_context", {
        rootPath: workspace.rootPath,
        currentPath: path,
        currentContent: isDirty ? content : undefined,
        provider: settings.assistantProvider,
        model: settings.assistantModel,
        task,
        prompt,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        externalCommand: providerConfig.externalCommand,
        externalTimeoutSeconds: providerConfig.externalTimeoutSeconds,
      });
      setAssistantDraft(draft);
      appendAssistantEvent({
        label: "草稿已生成",
        detail: draft.title,
        tone: "info",
      });
      setNotice({ tone: "info", message: "AI 草稿已生成。" });
    } catch (error) {
      appendAssistantEvent({
        label: "草稿生成失败",
        detail: String(error),
        tone: "error",
      });
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSummarizeContext() {
    await handleAssistantRun("summarize");
  }

  async function handleAssistantPromptSubmit(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    await handleAssistantRun("chat", trimmedPrompt);
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
      appendAssistantEvent({
        label: "草稿已保存",
        detail: fileName(savedPath),
        tone: "info",
      });
      setNotice({ tone: "info", message: `已将 Wiki 草稿保存到 ${fileName(savedPath)}。` });
      await handleRefreshWorkspace(false);
    } catch (error) {
      appendAssistantEvent({
        label: "保存失败",
        detail: String(error),
        tone: "error",
      });
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

  function insertAssistantDraft() {
    if (!assistantDraft || readOnly) return;
    const insert = assistantDraft.content.trim();
    if (!insert) return;

    const view = editorViewRef.current;
    if (!view) {
      handleChange(content ? `${content.trimEnd()}\n\n${insert}\n` : `${insert}\n`);
      setNotice({ tone: "info", message: "AI 内容已插入编辑器。" });
      return;
    }

    const selection = view.state.selection.main;
    const prefix = selection.from > 0 ? "\n\n" : "";
    const suffix = insert.endsWith("\n") ? "" : "\n";
    view.dispatch({
      changes: { from: selection.to, to: selection.to, insert: `${prefix}${insert}${suffix}` },
    });
    view.focus();
    setNotice({ tone: "info", message: "AI 内容已插入编辑器。" });
  }

  function replaceSelectionWithAssistantDraft() {
    if (!assistantDraft || readOnly) return;
    const insert = assistantDraft.content.trim();
    if (!insert) return;

    const view = editorViewRef.current;
    if (!view) {
      handleChange(`${insert}\n`);
      setNotice({ tone: "info", message: "已用 AI 内容替换当前文档。" });
      return;
    }

    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length },
    });
    view.focus();
    setNotice({
      tone: "info",
      message: selection.empty ? "AI 内容已插入光标位置。" : "已用 AI 内容替换选中文本。",
    });
  }

  function applyMarkdownAction(action: MarkdownAction) {
    if (readOnly) return;

    const view = editorViewRef.current;
    if (!view) {
      const fallback = action === "h1" ? "# " : action === "h2" ? "## " : "";
      if (fallback) handleChange(`${fallback}${content}`);
      return;
    }

    const selection = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(selection.from, selection.to);

    if (action === "h1" || action === "h2") {
      const line = view.state.doc.lineAt(selection.from);
      const marker = action === "h1" ? "# " : "## ";
      const nextLine = `${marker}${line.text.replace(/^#{1,6}\s+/, "")}`;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: nextLine },
        selection: { anchor: line.from + nextLine.length },
      });
      view.focus();
      return;
    }

    const wrapSelection = (before: string, after = before, placeholder = "文本") => {
      const inner = selectedText || placeholder;
      const insert = `${before}${inner}${after}`;
      const anchor = selectedText ? selection.from + insert.length : selection.from + before.length;
      const head = selectedText ? anchor : anchor + placeholder.length;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor, head },
      });
      view.focus();
    };

    if (action === "bold") wrapSelection("**", "**", "加粗文本");
    if (action === "italic") wrapSelection("*", "*", "斜体文本");
    if (action === "code") {
      if (selectedText.includes("\n")) wrapSelection("```markdown\n", "\n```", selectedText || "code");
      else wrapSelection("`", "`", "代码");
    }
    if (action === "link") wrapSelection("[", "](https://example.com)", "链接文本");
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
        message: `已加载第 ${range.startLine.toLocaleString()}-${(
          range.startLine +
          range.lineCount -
          1
        ).toLocaleString()} 行。`,
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
    if (isDirty && !window.confirm("放弃未保存的更改并从磁盘重新加载？")) return;

    setBusy(true);
    setNotice(null);
    try {
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path });
      applyDocument(document);
      rememberDocument(document.path);
      setNotice({ tone: "info", message: `已重新加载 ${fileName(document.path)}。` });
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
          appendAssistantEvent({
            label: "上下文已加载",
            detail: `${context.items.length.toLocaleString()} 条，来自 ${context.currentRelativePath}`,
            tone: "info",
          });
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
          setNotice({ tone: "info", message: "已恢复上次会话。" });
        }
      } catch (error) {
        if (!cancelled) {
          setNotice({ tone: "error", message: `无法恢复上次会话：${String(error)}` });
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
    <main className={`app-shell ${leftPanelOpen ? "left-open" : "left-closed"}`}>
      <button
        type="button"
        className="floating-panel-toggle"
        onClick={() => setLeftPanelOpen(true)}
        aria-label="显示笔记栏"
        title="显示笔记栏"
      >
        &gt;
      </button>

      <div className="left-workspace" aria-hidden={!leftPanelOpen}>
        <LibraryRail
          busy={busy}
          readOnly={readOnly}
          isDirty={isDirty}
          workspace={workspace}
          leftPanelOpen={leftPanelOpen}
          activeSection={librarySection}
          onToggleLeftPanel={() => setLeftPanelOpen((open) => !open)}
          onSectionChange={(section) => {
            setLibrarySection(section);
            setWorkspaceSearchActive(false);
            setWorkspaceMatches([]);
          }}
          onNew={() => void handleNew()}
          onOpen={() => void handleOpen()}
          onOpenWorkspace={() => void handleOpenWorkspace()}
          onSave={() => void handleSave()}
          onInitializeKnowledgeWorkspace={() => void handleInitializeKnowledgeWorkspace()}
          onRefreshWorkspace={() => void handleRefreshWorkspace()}
          onExportHtml={() => void handleExportHtml()}
          onExportPdf={() => void handleExportPdf()}
        />

        <WorkspaceListPanel
          busy={busy}
          workspace={workspace}
          librarySection={librarySection}
          workspaceFiles={workspaceFiles}
          workspaceQuery={workspaceQuery}
          workspaceMatches={workspaceMatches}
          workspaceSearchActive={workspaceSearchActive}
          recentFiles={recentFiles}
          path={path}
          isLarge={isLarge}
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
      </div>

      <section className="editor-pane">
        <EditorToolbar
          isLarge={isLarge}
          canFormat={!readOnly && !busy}
          busy={busy}
          canPageBack={canPageBack}
          canPageForward={canPageForward}
          search={search}
          matches={matches}
          mode={editorMode}
          onPreviousWindow={handlePreviousWindow}
          onNextWindow={handleNextWindow}
          onSearchChange={setSearch}
          onModeChange={setEditorMode}
          onMarkdownAction={applyMarkdownAction}
        />

        <NoticeStack
          notice={notice}
          externalChange={externalChange}
          busy={busy}
          onDismissNotice={() => setNotice(null)}
          onReloadCurrentFile={() => void handleReloadCurrentFile()}
        />

        <div className={`document-workspace ${editorMode}`}>
          <div className="document-heading">
            <h1>{fileName(path)}</h1>
            <p>
              {readOnly
                ? `只读：第 ${visibleStartLine.toLocaleString()}-${visibleEndLine.toLocaleString()} 行`
                : isDirty
                  ? "有未保存的更改"
                  : "所有更改已保存"}
            </p>
          </div>
          <div className={`document-main ${editorMode}`}>
            {editorMode !== "preview" && (
              <div className="editor-frame">
                <CodeMirror
                  value={content}
                  height="100%"
                  basicSetup={false}
                  extensions={extensions}
                  onChange={handleChange}
                  onCreateEditor={(view) => {
                    editorViewRef.current = view;
                  }}
                  theme="light"
                />
              </div>
            )}

            {editorMode !== "edit" && <MarkdownPreview content={content} />}
          </div>

        </div>
      </section>

      <aside className="right-companion inspector-rail" aria-label="检查器">
        <div className="companion-tabs mode-switch" aria-label="检查器标签">
          <button
            type="button"
            className={inspectorTab === "assistant" ? "active" : ""}
            onClick={() => setInspectorTab("assistant")}
          >
            AI 助手
          </button>
          <button
            type="button"
            className={inspectorTab === "knowledge" ? "active" : ""}
            onClick={() => setInspectorTab("knowledge")}
            disabled={!workspace?.knowledge.isInitialized || !path}
          >
            知识
          </button>
        </div>
        {inspectorTab === "knowledge" ? (
          <KnowledgePanel
            knowledge={documentKnowledge}
            lint={knowledgeLint}
            queryContext={queryContext}
            workspaceIndexPath={workspace ? `${workspace.knowledge.wikiPath}/index.md` : null}
            workspaceLogPath={workspace ? `${workspace.knowledge.wikiPath}/log.md` : null}
            busy={busy}
            onOpenPath={(nextPath, name) => void openPath(nextPath, name)}
          />
        ) : (
          <AssistantPanel
            busy={busy}
            queryContext={queryContext}
            draft={assistantDraft}
            events={assistantEvents}
            settings={settings}
            prompt={assistantPrompt}
            onPromptChange={setAssistantPrompt}
            onSummarize={() => void handleSummarizeContext()}
            onRunTask={(task) => void handleAssistantRun(task)}
            onSubmitPrompt={(prompt) => void handleAssistantPromptSubmit(prompt)}
            onSaveDraft={() => void handleSaveAssistantDraft()}
            onInsertDraft={insertAssistantDraft}
            onReplaceSelection={replaceSelectionWithAssistantDraft}
          />
        )}
      </aside>
    </main>
  );
}
