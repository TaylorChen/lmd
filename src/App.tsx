import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { AssistantPanel } from "./components/AssistantPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorToolbar, type MarkdownAction } from "./components/EditorToolbar";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { LibraryRail } from "./components/LibraryRail";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { NameDialog, type NameDialogState } from "./components/NameDialog";
import { NoticeStack } from "./components/NoticeStack";
import { WorkspaceListPanel } from "./components/WorkspaceListPanel";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useEditorExtensions } from "./hooks/useEditorExtensions";
import { useExternalChangePolling } from "./hooks/useExternalChangePolling";
import { countSearchMatches, fileName, isPathInsideRoot, localStats } from "./lib/format";
import { renderMarkdownDocument } from "./lib/markdown";
import { readRecentFiles, readSettings, recentFileLimit, storageKeys, writeRecentFiles, writeSettings } from "./lib/storage";
import { invokeCommand, isNativeRuntime } from "./lib/tauri";
import type {
  AssistantCatalog,
  AssistantDraft,
  AssistantEvent,
  AssistantMessage,
  AssistantProvider,
  AttachmentImportResult,
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

type EditableFrontmatter = {
  title: string;
  tags: string;
  status: string;
};

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
    {
      id: "ollama",
      label: "Ollama",
      models: ["qwen2.5:7b", "llama3.2", "deepseek-r1:7b"],
      baseUrl: "http://127.0.0.1:11434/v1/chat/completions",
    },
    {
      id: "lmstudio",
      label: "LM Studio",
      models: ["local-model"],
      baseUrl: "http://127.0.0.1:1234/v1/chat/completions",
    },
    { id: "external_command", label: "外部命令", models: ["command-json-v1"] },
  ],
};

function splitFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { fields: new Map<string, string>(), body: content };
  }
  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) {
    return { fields: new Map<string, string>(), body: content };
  }
  const rawFrontmatter = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 4).replace(/^\n/, "");
  const fields = new Map<string, string>();
  for (const line of rawFrontmatter.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) continue;
    fields.set(key.trim(), rest.join(":").trim().replace(/^['"]|['"]$/g, ""));
  }
  return { fields, body };
}

function readEditableFrontmatter(content: string): EditableFrontmatter {
  const { fields } = splitFrontmatter(content);
  const title = fields.get("title") ?? "";
  const rawTags = fields.get("tags") ?? "";
  const tags = rawTags
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean)
    .join(", ");
  return {
    title,
    tags,
    status: fields.get("status") ?? "",
  };
}

function applyEditableFrontmatter(content: string, draft: EditableFrontmatter) {
  const { fields, body } = splitFrontmatter(content);
  const nextFields = new Map(fields);
  const setOrDelete = (key: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) nextFields.set(key, trimmed);
    else nextFields.delete(key);
  };
  setOrDelete("title", draft.title);
  setOrDelete("status", draft.status);
  const tags = draft.tags
    .split(",")
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length > 0) nextFields.set("tags", `[${tags.join(", ")}]`);
  else nextFields.delete("tags");

  if (nextFields.size === 0) return body;
  const frontmatter = Array.from(nextFields.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}

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
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantEvents, setAssistantEvents] = useState<AssistantEvent[]>([]);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [nameDialog, setNameDialog] = useState<(NameDialogState & { kind: "new" | "rename" | "wiki" }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);

  const isDirty = !readOnly && content !== savedContent;
  const matches = useMemo(() => countSearchMatches(content, search), [content, search]);
  const visibleEndLine =
    visibleLineCount === 0 ? 0 : Math.min(lineCount, visibleStartLine + visibleLineCount - 1);
  const canPageBack = isLarge && visibleStartLine > 1;
  const canPageForward = isLarge && visibleEndLine < lineCount;
  const editableFrontmatter = useMemo(() => readEditableFrontmatter(content), [content]);

  const extensions = useEditorExtensions(isLarge, readOnly, visibleStartLine, workspace?.files ?? []);
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
  }

  function appendAssistantEvent(event: AssistantEvent) {
    setAssistantEvents((currentEvents) => [...currentEvents, event].slice(-8));
  }

  function appendAssistantMessage(message: Omit<AssistantMessage, "id">) {
    setAssistantMessages((currentMessages) => [
      ...currentMessages,
      {
        ...message,
        id: `${Date.now()}-${currentMessages.length}`,
      },
    ]);
  }

  function animateAssistantMessage(content: string) {
    const id = `${Date.now()}-assistant-stream`;
    setAssistantMessages((currentMessages) => [
      ...currentMessages,
      { id, role: "assistant", content: "" },
    ]);
    const chunkSize = Math.max(4, Math.ceil(content.length / 80));
    let index = 0;
    const intervalId = window.setInterval(() => {
      index = Math.min(content.length, index + chunkSize);
      setAssistantMessages((currentMessages) =>
        currentMessages.map((message) =>
          message.id === id ? { ...message, content: content.slice(0, index) } : message,
        ),
      );
      if (index >= content.length) {
        window.clearInterval(intervalId);
      }
    }, 18);
  }

  function startAssistantStreamMessage() {
    const id = `${Date.now()}-assistant-stream`;
    setAssistantMessages((currentMessages) => [
      ...currentMessages,
      { id, role: "assistant", content: "" },
    ]);
    return id;
  }

  function appendAssistantStreamDelta(id: string, delta: string) {
    setAssistantMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === id ? { ...message, content: `${message.content}${delta}` } : message,
      ),
    );
  }

  function replaceAssistantStreamMessage(id: string, content: string) {
    setAssistantMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    );
  }

  function assistantTaskLabel(task: string, prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt) return trimmedPrompt;
    if (task === "polish") return "优化当前笔记";
    if (task === "todos") return "提取当前笔记中的待办";
    if (task === "title") return "生成标题候选";
    if (task === "wiki") return "整理为 Wiki 草稿";
    if (task === "outline") return "生成当前笔记大纲";
    if (task === "continue") return "续写当前笔记";
    return "总结当前笔记";
  }

  function addSavedInboxFile(savedPath: string) {
    if (!workspace) return;
    const relativePath = isPathInsideRoot(savedPath, workspace.rootPath)
      ? savedPath.slice(workspace.rootPath.length).replace(/^[/\\]+/, "")
      : `wiki/inbox/${fileName(savedPath)}`;
    const savedFile: WorkspaceFile = {
      path: savedPath,
      relativePath,
      name: fileName(savedPath),
      byteSize: 0,
    };
    setWorkspace({
      ...workspace,
      files: [
        savedFile,
        ...workspace.files.filter((file) => file.path !== savedPath),
      ],
    });
    setLibrarySection("inbox");
    setWorkspaceSearchActive(false);
    setWorkspaceMatches([]);
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

  function handleRemoveRecentFile(documentPath: string) {
    setRecentFiles((currentRecentFiles) => {
      const nextRecentFiles = currentRecentFiles.filter((file) => file.path !== documentPath);
      writeRecentFiles(nextRecentFiles);
      return nextRecentFiles;
    });
    if (window.localStorage.getItem(storageKeys.lastDocumentPath) === documentPath) {
      window.localStorage.removeItem(storageKeys.lastDocumentPath);
    }
    setNotice({ tone: "info", message: "已从最近列表移除。" });
  }

  function insertTextAtCursor(insert: string, message: string) {
    if (readOnly) return;
    const view = editorViewRef.current;
    if (!view) {
      handleChange(content ? `${content.trimEnd()}\n\n${insert}\n` : `${insert}\n`);
      setNotice({ tone: "info", message });
      return;
    }
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length },
    });
    view.focus();
    setNotice({ tone: "info", message });
  }

  async function handleNew() {
    if (isDirty && !window.confirm("放弃未保存的更改？")) return;
    if (workspace) {
      setNameDialog({
        kind: "new",
        title: "新建 Markdown",
        label: "文件名",
        defaultValue: "未命名.md",
        confirmLabel: "创建",
      });
      return;
    }
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

  async function createNamedMarkdown(name: string) {
    if (!workspace) return;
    const directory = workspace.knowledge.isInitialized ? "notes" : "";
    const title = name.replace(/\.(md|markdown|mdown)$/i, "");
    const initialContent = `# ${title}\n\n`;
    setBusy(true);
    setNotice(null);
    try {
      const result = await invokeCommand<SaveResult>("create_markdown_file", {
        rootPath: workspace.rootPath,
        directory,
        name,
        content: initialContent,
      });
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path: result.path });
      applyDocument(document);
      rememberDocument(document.path);
      await handleRefreshWorkspace(false);
      setNotice({ tone: "info", message: `已新建 ${fileName(result.path)}。` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameCurrentFile() {
    if (!path) {
      setNotice({ tone: "error", message: "请先保存或打开一个 Markdown 文件。" });
      return;
    }
    if (isDirty) {
      setNotice({ tone: "error", message: "请先保存当前更改再重命名。" });
      return;
    }
    setNameDialog({
      kind: "rename",
      title: "重命名 Markdown",
      label: "文件名",
      defaultValue: fileName(path),
      confirmLabel: "重命名",
    });
  }

  async function renameCurrentFile(nextName: string) {
    if (!path) return;
    setBusy(true);
    setNotice(null);
    try {
      const oldPath = path;
      const result = await invokeCommand<SaveResult>("rename_markdown_file", {
        path,
        newName: nextName,
      });
      const document = await invokeCommand<MarkdownDocument>("open_markdown_path", { path: result.path });
      applyDocument(document);
      rememberDocument(document.path);
      setRecentFiles((currentRecentFiles) => {
        const nextRecentFiles = [
          { path: result.path, name: fileName(result.path) },
          ...currentRecentFiles.filter((file) => file.path !== oldPath && file.path !== result.path),
        ].slice(0, recentFileLimit);
        writeRecentFiles(nextRecentFiles);
        return nextRecentFiles;
      });
      if (workspace) {
        await handleRefreshWorkspace(false);
      }
      setNotice({ tone: "info", message: `已重命名为 ${fileName(result.path)}。` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportAttachment() {
    if (readOnly) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await invokeCommand<AttachmentImportResult | null>("import_attachment", {
        rootPath: workspace?.rootPath,
        currentPath: path,
      });
      if (!result) return;
      insertTextAtCursor(result.markdown, `已插入附件 ${fileName(result.path)}。`);
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateWikiPage() {
    if (!workspace) {
      setNotice({ tone: "error", message: "请先打开工作区。" });
      return;
    }
    setNameDialog({
      kind: "wiki",
      title: "新建 Wiki 页面",
      label: "页面文件名",
      defaultValue: "新页面.md",
      confirmLabel: "创建",
    });
  }

  async function createWikiPage(name: string) {
    if (!workspace) return;
    const title = name.replace(/\.(md|markdown|mdown)$/i, "");
    setBusy(true);
    setNotice(null);
    try {
      await invokeCommand<SaveResult>("create_markdown_file", {
        rootPath: workspace.rootPath,
        directory: "wiki",
        name,
        content: `# ${title}\n\n`,
      });
      await handleRefreshWorkspace(false);
      insertTextAtCursor(`[[${title}]]`, `已创建并插入 Wiki Link：${title}。`);
      setLibrarySection("wiki");
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  function handleNameDialogSubmit(value: string) {
    const current = nameDialog;
    setNameDialog(null);
    if (!current) return;
    if (current.kind === "new") void createNamedMarkdown(value);
    if (current.kind === "rename") void renameCurrentFile(value);
    if (current.kind === "wiki") void createWikiPage(value);
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
      const filteredMatches = matches.filter((match) => {
        if (librarySection === "notes") return match.relativePath.startsWith("notes/");
        if (librarySection === "sources") return match.relativePath.startsWith("sources/");
        if (librarySection === "wiki") return match.relativePath.startsWith("wiki/");
        if (librarySection === "inbox") return match.relativePath.startsWith("wiki/inbox/");
        return true;
      });
      setWorkspaceMatches(filteredMatches);
      setWorkspaceSearchActive(true);
      setNotice({
        tone: "info",
        message: `找到 ${filteredMatches.length.toLocaleString()} 条工作区匹配结果。`,
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

  async function runAssistantCommand(args: Record<string, unknown>) {
    if (!isNativeRuntime()) {
      return invokeCommand<AssistantDraft>(String(args.command), args.payload as Record<string, unknown>);
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const messageId = startAssistantStreamMessage();
    const unlisten = await listen<{ requestId: string; delta: string }>(
      "assistant-stream-delta",
      (event) => {
        if (event.payload.requestId !== requestId) return;
        appendAssistantStreamDelta(messageId, event.payload.delta);
      },
    );
    try {
      const draft = await invokeCommand<AssistantDraft>(String(args.command), {
        ...(args.payload as Record<string, unknown>),
        requestId,
      });
      replaceAssistantStreamMessage(messageId, draft.content);
      return draft;
    } catch (error) {
      replaceAssistantStreamMessage(messageId, `生成失败：${String(error)}`);
      throw error;
    } finally {
      unlisten();
    }
  }

  async function handleAssistantRun(task: string, prompt = "") {
    appendAssistantMessage({ role: "user", content: assistantTaskLabel(task, prompt) });
    if (!workspace || !path) {
      await handleAssistantEditorRun(task, prompt);
      return;
    }

    const providerConfig = assistantProviderConfig(settings.assistantProvider);
    setAssistantBusy(true);
    appendAssistantEvent({
      label: "已请求 AI",
      detail: `${settings.assistantProvider} / ${settings.assistantModel}`,
      tone: "info",
    });
    try {
      const draft = await runAssistantCommand({
        command: "summarize_query_context",
        payload: {
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
        },
      });
      setAssistantDraft(draft);
      if (!isNativeRuntime()) animateAssistantMessage(draft.content);
      appendAssistantEvent({
        label: "草稿已生成",
        detail: draft.title,
        tone: "info",
      });
    } catch (error) {
      appendAssistantEvent({
        label: "草稿生成失败",
        detail: String(error),
        tone: "error",
      });
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setAssistantBusy(false);
    }
  }

  async function handleAssistantEditorRun(task: string, prompt = "") {
    const providerConfig = assistantProviderConfig(settings.assistantProvider);
    setAssistantBusy(true);
    appendAssistantEvent({
      label: "已请求 AI",
      detail: `${settings.assistantProvider} / ${settings.assistantModel}`,
      tone: "info",
    });
    try {
      const draft = await runAssistantCommand({
        command: "summarize_editor_context",
        payload: {
          currentPath: path,
          currentRelativePath: fileName(path),
          currentContent: content,
          provider: settings.assistantProvider,
          model: settings.assistantModel,
          task,
          prompt,
          apiKey: providerConfig.apiKey,
          baseUrl: providerConfig.baseUrl,
          externalCommand: providerConfig.externalCommand,
          externalTimeoutSeconds: providerConfig.externalTimeoutSeconds,
        },
      });
      setAssistantDraft(draft);
      if (!isNativeRuntime()) animateAssistantMessage(draft.content);
      appendAssistantEvent({
        label: "草稿已生成",
        detail: draft.title,
        tone: "info",
      });
    } catch (error) {
      appendAssistantEvent({
        label: "草稿生成失败",
        detail: String(error),
        tone: "error",
      });
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setAssistantBusy(false);
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
      addSavedInboxFile(savedPath);
      setNotice({ tone: "info", message: `已将 Wiki 草稿保存到 ${fileName(savedPath)}。` });
      const refreshedWorkspace = await invokeCommand<Workspace>("refresh_workspace", {
        rootPath: workspace.rootPath,
      });
      const savedRelativePath = isPathInsideRoot(savedPath, refreshedWorkspace.rootPath)
        ? savedPath.slice(refreshedWorkspace.rootPath.length).replace(/^[/\\]+/, "")
        : `wiki/inbox/${fileName(savedPath)}`;
      const savedFile: WorkspaceFile = {
        path: savedPath,
        relativePath: savedRelativePath,
        name: fileName(savedPath),
        byteSize: 0,
      };
      setWorkspace({
        ...refreshedWorkspace,
        files: [
          savedFile,
          ...refreshedWorkspace.files.filter((file) => file.path !== savedPath),
        ],
      });
      window.localStorage.setItem(storageKeys.lastWorkspaceRoot, refreshedWorkspace.rootPath);
      setWorkspaceSearchActive(false);
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

  function handleApplyFrontmatter(draft: EditableFrontmatter) {
    if (readOnly) return;
    handleChange(applyEditableFrontmatter(content, draft));
    setNotice({ tone: "info", message: "Front Matter 已更新。" });
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
    onOpenCommandPalette: () => {
      setCommandPaletteQuery("");
      setCommandPaletteOpen(true);
    },
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

  const commandItems = [
    {
      id: "new",
      label: "新建 Markdown",
      hint: "创建并命名新笔记",
      disabled: busy,
      run: () => void handleNew(),
    },
    {
      id: "open",
      label: "打开文件",
      hint: "从磁盘打开 Markdown",
      disabled: busy,
      run: () => void handleOpen(),
    },
    {
      id: "workspace",
      label: "打开工作区",
      hint: "选择文件夹作为笔记库",
      disabled: busy,
      run: () => void handleOpenWorkspace(),
    },
    {
      id: "save",
      label: "保存",
      hint: "保存当前 Markdown",
      disabled: busy || readOnly || !isDirty,
      run: () => void handleSave(),
    },
    {
      id: "rename",
      label: "重命名当前文件",
      hint: "修改当前 Markdown 文件名",
      disabled: busy || readOnly || isDirty || !path,
      run: () => void handleRenameCurrentFile(),
    },
    {
      id: "attachment",
      label: "添加附件",
      hint: "复制文件到 attachments 并插入链接",
      disabled: busy || readOnly,
      run: () => void handleImportAttachment(),
    },
    {
      id: "wiki",
      label: "新建 Wiki 页面",
      hint: "创建页面并插入 [[Wiki Link]]",
      disabled: busy || !workspace,
      run: () => void handleCreateWikiPage(),
    },
    {
      id: "summarize",
      label: "AI 总结当前笔记",
      hint: settings.assistantModel,
      disabled: assistantBusy,
      run: () => void handleSummarizeContext(),
    },
    {
      id: "export-html",
      label: "导出 HTML",
      hint: "使用当前预览渲染器",
      disabled: busy,
      run: () => void handleExportHtml(),
    },
    {
      id: "export-pdf",
      label: "导出 PDF",
      hint: "导出轻量 PDF",
      disabled: busy,
      run: () => void handleExportPdf(),
    },
  ];

  return (
    <main className={`app-shell ${leftPanelOpen ? "left-open" : "left-closed"}`}>
      <CommandPalette
        open={commandPaletteOpen}
        query={commandPaletteQuery}
        items={commandItems}
        onQueryChange={setCommandPaletteQuery}
        onClose={() => setCommandPaletteOpen(false)}
      />
      <NameDialog
        state={nameDialog}
        onCancel={() => setNameDialog(null)}
        onSubmit={handleNameDialogSubmit}
      />
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
          onRename={() => void handleRenameCurrentFile()}
          onImportAttachment={() => void handleImportAttachment()}
          onCreateWikiPage={() => void handleCreateWikiPage()}
          onOpenCommandPalette={() => {
            setCommandPaletteQuery("");
            setCommandPaletteOpen(true);
          }}
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
          onRemoveRecentFile={handleRemoveRecentFile}
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
            <button
              type="button"
              className="document-rename-button"
              onClick={() => void handleRenameCurrentFile()}
              disabled={busy || readOnly || isDirty || !path}
            >
              重命名
            </button>
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
            frontmatterDraft={editableFrontmatter}
            workspaceIndexPath={workspace ? `${workspace.knowledge.wikiPath}/index.md` : null}
            workspaceLogPath={workspace ? `${workspace.knowledge.wikiPath}/log.md` : null}
            busy={assistantBusy}
            onOpenPath={(nextPath, name) => void openPath(nextPath, name)}
            onApplyFrontmatter={handleApplyFrontmatter}
          />
        ) : (
          <AssistantPanel
            busy={assistantBusy}
            queryContext={queryContext}
            hasCurrentContent={Boolean(content.trim())}
            draft={assistantDraft}
            messages={assistantMessages}
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
