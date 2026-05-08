import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { listen } from "@tauri-apps/api/event";
import { AssistantPanel } from "./components/AssistantPanel";
import { CommandPalette } from "./components/CommandPalette";
import { EditorToolbar, type MarkdownAction } from "./components/EditorToolbar";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { LibraryRail } from "./components/LibraryRail";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { NameDialog, type NameDialogState } from "./components/NameDialog";
import { NoticeStack } from "./components/NoticeStack";
import { TagRenameDialog } from "./components/TagRenameDialog";
import { WorkspaceListPanel } from "./components/WorkspaceListPanel";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useEditorExtensions } from "./hooks/useEditorExtensions";
import { useExternalChangePolling } from "./hooks/useExternalChangePolling";
import { fileName, isPathInsideRoot, localStats } from "./lib/format";
import { renderMarkdownDocument } from "./lib/markdown";
import {
  readRecentFiles,
  readSettings,
  recentFileLimit,
  storageKeys,
  writeRecentFiles,
  writeSettings,
  writeSettingsWithoutApiKeys,
} from "./lib/storage";
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
  GitStatus,
  HistorySnapshot,
  KnowledgeLintReport,
  LibrarySection,
  LineRange,
  MarkdownDocument,
  Notice,
  RecentFile,
  SaveResult,
  SearchMatch,
  QueryContext,
  TagRenameResult,
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

type DocumentTab = {
  id: string;
  content: string;
  savedContent: string;
  path: string | null;
  byteSize: number;
  lineCount: number;
  knownModifiedMs: number | null;
  isLarge: boolean;
  readOnly: boolean;
  visibleStartLine: number;
  visibleLineCount: number;
  search: string;
};

type TabContextMenuState = {
  tabId: string;
  x: number;
  y: number;
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

function createUntitledTab(): DocumentTab {
  return {
    id: `untitled-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    content: emptyDocument,
    savedContent: emptyDocument,
    path: null,
    byteSize: emptyDocument.length,
    lineCount: 3,
    knownModifiedMs: null,
    isLarge: false,
    readOnly: false,
    visibleStartLine: 1,
    visibleLineCount: 3,
    search: "",
  };
}

function tabFromDocument(document: MarkdownDocument): DocumentTab {
  return {
    id: document.path,
    content: document.content,
    savedContent: document.content,
    path: document.path,
    byteSize: document.byteSize,
    lineCount: document.lineCount,
    knownModifiedMs: document.modifiedMs,
    isLarge: document.isLarge,
    readOnly: document.readOnly,
    visibleStartLine: document.visibleStartLine,
    visibleLineCount: document.visibleLineCount,
    search: "",
  };
}

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

function createBlockId() {
  const timestamp = Date.now().toString(36);
  return `^block-${timestamp}`;
}

function markdownTableTemplate() {
  return "| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n";
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function csvToMarkdownTable(input: string) {
  const rows = input
    .trim()
    .split(/\r\n|\r|\n/)
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((row) => row.length > 0 && row.some(Boolean));
  if (rows.length === 0) return markdownTableTemplate();
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ""),
  ]);
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function formatMarkdownTable(input: string) {
  const lines = input
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|"));
  if (lines.length < 2) return input;

  const rows = lines.map((line) => {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|");
    return cells.map((cell) => cell.trim());
  });
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ""),
  ]);
  const widths = Array.from({ length: columnCount }, (_, column) =>
    Math.max(3, ...normalizedRows.map((row) => row[column].length)),
  );
  const formatRow = (row: string[]) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column], " ")).join(" | ")} |`;

  const header = formatRow(normalizedRows[0]);
  const divider = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  const body = normalizedRows.slice(2).map(formatRow);
  return [header, divider, ...body].join("\n");
}

function addMarkdownTableRow(input: string) {
  const formatted = formatMarkdownTable(input);
  const lines = formatted.split(/\r\n|\r|\n/);
  const firstRow = lines[0] ?? "";
  const columnCount = firstRow.replace(/^\|/, "").replace(/\|$/, "").split("|").length;
  return [...lines, `| ${Array.from({ length: columnCount }, () => "").join(" | ")} |`].join("\n");
}

function addMarkdownTableColumn(input: string) {
  const lines = input
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("|"));
  if (lines.length < 2) return input;
  const next = lines.map((line, index) => {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    cells.push(index === 1 ? "---" : "");
    return `| ${cells.join(" | ")} |`;
  });
  return formatMarkdownTable(next.join("\n"));
}

function findSearchRanges(content: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = content.toLowerCase();
  const ranges: Array<{ from: number; to: number }> = [];
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    ranges.push({ from: found, to: found + needle.length });
    index = found + Math.max(needle.length, 1);
  }
  return ranges;
}

function currentLinkTarget(documentPath: string | null) {
  return documentPath ? fileName(documentPath).replace(/\.(md|markdown|mdown)$/i, "") : "当前笔记";
}

function extractBlockIds(content: string) {
  const ids = new Set<string>();
  for (const match of content.matchAll(/\^([A-Za-z0-9_-]+)/g)) {
    ids.add(match[1]);
  }
  return Array.from(ids).sort((left, right) => left.localeCompare(right));
}

function formatAssistantChatArchive(messages: AssistantMessage[]) {
  const body = messages
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : "AI";
      return `## ${speaker}\n\n${message.content.trim()}`;
    })
    .join("\n\n");
  return `# AI 对话记录\n\n${body}\n`;
}

export default function App() {
  const editorViewRef = useRef<EditorView | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const markdownActionRef = useRef<(action: MarkdownAction) => void>(() => {});
  const appMenuActionRef = useRef<(action: string) => void>(() => {});
  const initialTabRef = useRef<DocumentTab | null>(null);
  if (!initialTabRef.current) {
    initialTabRef.current = createUntitledTab();
  }
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [initialTabRef.current as DocumentTab]);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => (initialTabRef.current as DocumentTab).id);
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
  const [historySnapshots, setHistorySnapshots] = useState<HistorySnapshot[]>([]);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(() => readRecentFiles());
  const [settings, setSettings] = useState(() => readSettings());
  const [assistantCatalog, setAssistantCatalog] = useState<AssistantCatalog>(defaultAssistantCatalog);
  const [knownModifiedMs, setKnownModifiedMs] = useState<number | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalChange | null>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchMatch, setActiveSearchMatch] = useState(0);
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
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [featureAreaOpen, setFeatureAreaOpen] = useState(true);
  const [splitOrientation, setSplitOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [nameDialog, setNameDialog] = useState<(NameDialogState & { kind: "new" | "rename" | "wiki" | "git" }) | null>(null);
  const [tagRenameOpen, setTagRenameOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);

  const isDirty = !readOnly && content !== savedContent;
  const hasOpenTab = activeTabId !== null;
  const nativeRuntime = isNativeRuntime();
  const searchRanges = useMemo(() => findSearchRanges(content, search), [content, search]);
  const matches = searchRanges.length;
  const visibleEndLine =
    visibleLineCount === 0 ? 0 : Math.min(lineCount, visibleStartLine + visibleLineCount - 1);
  const canPageBack = isLarge && visibleStartLine > 1;
  const canPageForward = isLarge && visibleEndLine < lineCount;
  const editableFrontmatter = useMemo(() => readEditableFrontmatter(content), [content]);
  const blockIds = useMemo(() => extractBlockIds(content), [content]);

  const extensions = useEditorExtensions(isLarge, readOnly, visibleStartLine, workspace?.files ?? [], blockIds);
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

  function applyTab(tab: DocumentTab) {
    setContent(tab.content);
    setSavedContent(tab.savedContent);
    setPath(tab.path);
    setByteSize(tab.byteSize);
    setLineCount(tab.lineCount);
    setKnownModifiedMs(tab.knownModifiedMs);
    setExternalChange(null);
    setIsLarge(tab.isLarge);
    setReadOnly(tab.readOnly);
    setVisibleStartLine(tab.visibleStartLine);
    setVisibleLineCount(tab.visibleLineCount);
    setSearch(tab.search);
    setSearchOpen(Boolean(tab.search.trim()));
    setHistorySnapshots([]);
  }

  function openTab(tab: DocumentTab) {
    setTabs((currentTabs) => {
      const existing = tab.path
        ? currentTabs.find((item) => item.path === tab.path)
        : currentTabs.find((item) => item.id === tab.id);
      if (existing) {
        setActiveTabId(existing.id);
        applyTab(existing);
        return currentTabs;
      }
      setActiveTabId(tab.id);
      applyTab(tab);
      return [...currentTabs, tab];
    });
  }

  function applyDocument(document: MarkdownDocument) {
    openTab(tabFromDocument(document));
  }

  function replaceActiveTabWithDocument(document: MarkdownDocument) {
    const nextTab = { ...tabFromDocument(document), search };
    setActiveTabId(nextTab.id);
    applyTab(nextTab);
    setTabs((currentTabs) => {
      const nextTabs = currentTabs
        .filter((tab) => tab.id !== nextTab.id || tab.id === activeTabId)
        .map((tab) => (tab.id === activeTabId ? nextTab : tab));
      return nextTabs.some((tab) => tab.id === nextTab.id) ? nextTabs : [...nextTabs, nextTab];
    });
  }

  function handleSelectTab(tabId: string) {
    setTabContextMenu(null);
    if (tabId === activeTabId) return;
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    setActiveTabId(tab.id);
    applyTab(tab);
  }

  function handleCloseTab(tabId: string) {
    setTabContextMenu(null);
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const isOnlyTab = tabs.length === 1;
    const isBlankUntitled =
      !tab.path && tab.content === emptyDocument && tab.savedContent === emptyDocument;
    const shouldConfirm = !isBlankUntitled && !tab.readOnly && tab.content !== tab.savedContent;
    if (shouldConfirm && !window.confirm(`关闭未保存的标签 ${fileName(tab.path)}？`)) {
      return;
    }

    if (isOnlyTab) {
      const nextTab = createUntitledTab();
      setActiveTabId(null);
      applyTab(nextTab);
      setTabs([]);
      return;
    }

    setTabs((currentTabs) => {
      const index = currentTabs.findIndex((item) => item.id === tabId);
      const nextTabs = currentTabs.filter((item) => item.id !== tabId);
      if (tabId !== activeTabId) return nextTabs;

      const nextActiveTab = nextTabs[index] ?? nextTabs[index - 1] ?? createUntitledTab();
      if (nextTabs.length === 0) {
        setActiveTabId(nextActiveTab.id);
        applyTab(nextActiveTab);
        return [nextActiveTab];
      }
      setActiveTabId(nextActiveTab.id);
      applyTab(nextActiveTab);
      return nextTabs;
    });
  }

  function handleTabContextMenu(event: MouseEvent, tabId: string) {
    event.preventDefault();
    setTabContextMenu({ tabId, x: event.clientX, y: event.clientY });
  }

  function handleRenameTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    setTabContextMenu(null);
    if (!tab) return;
    if (tab.id !== activeTabId) {
      setActiveTabId(tab.id);
      applyTab(tab);
    }
    window.setTimeout(() => {
      void handleRenameCurrentFile();
    }, 0);
  }

  function clearKnowledge() {
    setDocumentKnowledge(null);
    setKnowledgeLint(null);
    setQueryContext(null);
    setAssistantDraft(null);
  }

  useEffect(() => {
    setTabs((currentTabs) => {
      let changed = false;
      const nextTabs = currentTabs.map((tab) => {
        if (!activeTabId || tab.id !== activeTabId) return tab;
        const nextTab = {
          ...tab,
          content,
          savedContent,
          path,
          byteSize,
          lineCount,
          knownModifiedMs,
          isLarge,
          readOnly,
          visibleStartLine,
          visibleLineCount,
          search,
        };
        changed =
          tab.content !== nextTab.content ||
          tab.savedContent !== nextTab.savedContent ||
          tab.path !== nextTab.path ||
          tab.byteSize !== nextTab.byteSize ||
          tab.lineCount !== nextTab.lineCount ||
          tab.knownModifiedMs !== nextTab.knownModifiedMs ||
          tab.isLarge !== nextTab.isLarge ||
          tab.readOnly !== nextTab.readOnly ||
          tab.visibleStartLine !== nextTab.visibleStartLine ||
          tab.visibleLineCount !== nextTab.visibleLineCount ||
          tab.search !== nextTab.search;
        return changed ? nextTab : tab;
      });
      return changed ? nextTabs : currentTabs;
    });
  }, [
    activeTabId,
    content,
    savedContent,
    path,
    byteSize,
    lineCount,
    knownModifiedMs,
    isLarge,
    readOnly,
    visibleStartLine,
    visibleLineCount,
    search,
  ]);

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

  async function handleLoadHistorySnapshots(showNotice = true) {
    if (!path) {
      setHistorySnapshots([]);
      if (showNotice) setNotice({ tone: "error", message: "请先保存或打开一个 Markdown 文件。" });
      return;
    }
    try {
      const snapshots = await invokeCommand<HistorySnapshot[]>("list_history_snapshots", {
        path,
        rootPath: workspace?.rootPath,
        limit: 8,
      });
      setHistorySnapshots(snapshots);
      if (showNotice) {
        setNotice({
          tone: "info",
          message: snapshots.length
            ? `找到 ${snapshots.length.toLocaleString()} 个保存快照。`
            : "当前文件暂无保存快照。",
        });
      }
    } catch (error) {
      if (showNotice) setNotice({ tone: "error", message: String(error) });
    }
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
    openTab(createUntitledTab());
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
      replaceActiveTabWithDocument(document);
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
    if (current.kind === "git") void commitGitWithMessage(value);
  }

  async function handleOpen() {
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

  async function handleRenameWorkspaceTag(oldTag: string, newTag: string) {
    if (!workspace) {
      setNotice({ tone: "error", message: "请先打开工作区。" });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await invokeCommand<TagRenameResult>("rename_workspace_tag", {
        rootPath: workspace.rootPath,
        oldTag,
        newTag,
      });
      await handleRefreshWorkspace(false);
      setTagRenameOpen(false);
      setNotice({
        tone: "info",
        message: `已将 #${oldTag} 重命名为 #${newTag}，更新 ${result.filesChanged.toLocaleString()} 个文件、${result.replacements.toLocaleString()} 处。`,
      });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshGitStatus(showNotice = true) {
    if (!workspace) {
      setGitStatus(null);
      if (showNotice) setNotice({ tone: "error", message: "请先打开工作区。" });
      return;
    }

    try {
      const status = await invokeCommand<GitStatus>("git_workspace_status", {
        rootPath: workspace.rootPath,
        currentPath: path,
      });
      setGitStatus(status);
      if (showNotice) {
        setNotice({
          tone: status.isRepository ? "info" : "error",
          message: status.isRepository
            ? `Git 状态已刷新，${status.changes.length.toLocaleString()} 个改动。`
            : "当前工作区不是 Git 仓库。",
        });
      }
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    }
  }

  async function handleGitCommit() {
    if (!workspace) {
      setNotice({ tone: "error", message: "请先打开工作区。" });
      return;
    }
    setNameDialog({
      kind: "git",
      title: "提交 Git 改动",
      label: "提交信息",
      defaultValue: "Update notes",
      confirmLabel: "提交",
    });
  }

  async function commitGitWithMessage(message: string) {
    if (!workspace) return;
    if (!message?.trim()) return;

    setBusy(true);
    setNotice(null);
    try {
      const status = await invokeCommand<GitStatus>("git_commit_workspace", {
        rootPath: workspace.rootPath,
        message,
      });
      setGitStatus(status);
      setNotice({ tone: "info", message: "Git 提交已完成。" });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function openPath(pathToOpen: string, displayName: string) {
    if (pathToOpen === path) return;
    const existingTab = tabs.find((tab) => tab.path === pathToOpen);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      applyTab(existingTab);
      return;
    }

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

  async function handleOpenDailyNote() {
    if (!workspace) {
      setNotice({ tone: "error", message: "请先打开工作区。" });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const date = todayIsoDate();
      const document = await invokeCommand<MarkdownDocument>("open_daily_note", {
        rootPath: workspace.rootPath,
        date,
      });
      applyDocument(document);
      rememberDocument(document.path);
      await handleRefreshWorkspace(false);
      setLibrarySection("all-notes");
      setNotice({ tone: "info", message: `已打开今日笔记 ${date}.md。` });
    } catch (error) {
      setNotice({ tone: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenSearchMatch(match: SearchMatch) {
    await openPath(match.path, `${match.relativePath}:${match.lineNumber}`);
  }

  async function handleOpenHistorySnapshot(snapshot: HistorySnapshot) {
    await openPath(snapshot.path, `快照 ${snapshot.name}`);
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
        rootPath: workspace?.rootPath,
        content,
      });
      if (!result) return;
      if (!activeTabId) {
        const savedTab: DocumentTab = {
          ...createUntitledTab(),
          id: result.path,
          path: result.path,
          content,
          savedContent: content,
          byteSize: result.byteSize,
          lineCount: result.lineCount,
          knownModifiedMs: result.modifiedMs,
        };
        setTabs([savedTab]);
        setActiveTabId(savedTab.id);
      }
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
      void handleLoadHistorySnapshots(false);
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

  async function handleExportDocx() {
    setBusy(true);
    setNotice(null);
    try {
      const exportedPath = await invokeCommand<string | null>("export_markdown_docx", {
        path,
        content,
      });
      if (!exportedPath) return;
      setNotice({ tone: "info", message: `已导出 DOCX 到 ${fileName(exportedPath)}。` });
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

  async function handleSaveAssistantChat() {
    if (!workspace || assistantMessages.length === 0) {
      setNotice({ tone: "error", message: "请先打开工作区并开始一段 AI 对话。" });
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const savedPath = await invokeCommand<string>("save_wiki_draft", {
        rootPath: workspace.rootPath,
        title: `AI 对话 ${new Date().toISOString().slice(0, 10)}`,
        content: formatAssistantChatArchive(assistantMessages),
      });
      appendAssistantEvent({
        label: "对话已保存",
        detail: fileName(savedPath),
        tone: "info",
      });
      await handleRefreshWorkspace(false);
      setLibrarySection("inbox");
      setNotice({ tone: "info", message: `已将 AI 对话保存到 ${fileName(savedPath)}。` });
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
    if (!activeTabId) {
      const nextTab = { ...createUntitledTab(), content: nextContent };
      setTabs([nextTab]);
      setActiveTabId(nextTab.id);
    }
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
      if (action === "table") handleChange(`${content.trimEnd()}\n\n${markdownTableTemplate()}`);
      if (action === "block-id") handleChange(`${content.trimEnd()} ${createBlockId()}\n`);
      if (action === "block-ref") {
        const id = createBlockId();
        handleChange(`${content.trimEnd()}\n\n[[${currentLinkTarget(path)}#${id}]]\n`);
      }
      return;
    }

    const selection = view.state.selection.main;
    const selectedText = view.state.doc.sliceString(selection.from, selection.to);

    if (action === "fold-all") {
      foldAll(view);
      view.focus();
      return;
    }
    if (action === "unfold-all") {
      unfoldAll(view);
      view.focus();
      return;
    }
    if (action === "fold-current") {
      foldCode(view);
      view.focus();
      return;
    }
    if (action === "unfold-current") {
      unfoldCode(view);
      view.focus();
      return;
    }

    if (["h1", "h2", "h3", "h4", "h5", "h6", "no-heading"].includes(action)) {
      const line = view.state.doc.lineAt(selection.from);
      const level = action === "no-heading" ? 0 : Number(action.slice(1));
      const marker = level > 0 ? `${"#".repeat(level)} ` : "";
      const nextLine = `${marker}${line.text.replace(/^#{1,6}\s+/, "")}`;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: nextLine },
        selection: { anchor: line.from + nextLine.length },
      });
      view.focus();
      return;
    }

    if (action === "unordered-list" || action === "ordered-list" || action === "task-list") {
      const fromLine = view.state.doc.lineAt(selection.from);
      const toLine = view.state.doc.lineAt(selection.to);
      const lines = view.state.doc.sliceString(fromLine.from, toLine.to).split(/\r\n|\r|\n/);
      const insert = lines
        .map((line, index) => {
          const stripped = line.replace(/^\s*(?:[-*+]\s+|\d+\.\s+|\[[ xX]\]\s+)/, "");
          if (action === "ordered-list") return `${index + 1}. ${stripped || "列表项"}`;
          if (action === "task-list") return `- [ ] ${stripped || "待办"}`;
          return `- ${stripped || "列表项"}`;
        })
        .join("\n");
      view.dispatch({
        changes: { from: fromLine.from, to: toLine.to, insert },
        selection: { anchor: fromLine.from + insert.length },
      });
      view.focus();
      return;
    }

    if (action === "table") {
      const insert = selectedText || markdownTableTemplate();
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: "已插入 Markdown 表格。" });
      return;
    }

    if (action === "math-block") {
      const insert = `$$\n${selectedText || "a^2 + b^2 = c^2"}\n$$`;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: "已插入数学块。" });
      return;
    }

    if (action === "footnote") {
      const insert = selectedText || "[^1]\n\n[^1]: 脚注内容";
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: "已插入脚注。" });
      return;
    }

    if (action === "fold-block") {
      const insert = `<details>\n<summary>${selectedText ? "标题" : "折叠标题"}</summary>\n\n${
        selectedText || "折叠内容"
      }\n\n</details>`;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: "已插入折叠块。" });
      return;
    }

    if (action === "format-table") {
      const fromLine = view.state.doc.lineAt(selection.from);
      const toLine = view.state.doc.lineAt(selection.to);
      let from = selection.from;
      let to = selection.to;
      let source = selectedText;
      if (!source) {
        let startLineNumber = fromLine.number;
        let endLineNumber = toLine.number;
        while (startLineNumber > 1 && view.state.doc.line(startLineNumber - 1).text.includes("|")) {
          startLineNumber -= 1;
        }
        while (endLineNumber < view.state.doc.lines && view.state.doc.line(endLineNumber + 1).text.includes("|")) {
          endLineNumber += 1;
        }
        const startLine = view.state.doc.line(startLineNumber);
        const endLine = view.state.doc.line(endLineNumber);
        from = startLine.from;
        to = endLine.to;
        source = view.state.doc.sliceString(from, to);
      }
      const insert = formatMarkdownTable(source);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: "Markdown 表格已对齐。" });
      return;
    }

    if (action === "table-row" || action === "table-column" || action === "csv-table") {
      const fromLine = view.state.doc.lineAt(selection.from);
      const toLine = view.state.doc.lineAt(selection.to);
      let from = selection.from;
      let to = selection.to;
      let source = selectedText;
      if (!source) {
        let startLineNumber = fromLine.number;
        let endLineNumber = toLine.number;
        while (startLineNumber > 1 && view.state.doc.line(startLineNumber - 1).text.includes("|")) {
          startLineNumber -= 1;
        }
        while (endLineNumber < view.state.doc.lines && view.state.doc.line(endLineNumber + 1).text.includes("|")) {
          endLineNumber += 1;
        }
        const startLine = view.state.doc.line(startLineNumber);
        const endLine = view.state.doc.line(endLineNumber);
        from = startLine.from;
        to = endLine.to;
        source = view.state.doc.sliceString(from, to);
      }
      const insert =
        action === "table-row"
          ? addMarkdownTableRow(source)
          : action === "table-column"
            ? addMarkdownTableColumn(source)
            : csvToMarkdownTable(source);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
      view.focus();
      setNotice({
        tone: "info",
        message:
          action === "table-row"
            ? "已添加表格行。"
            : action === "table-column"
              ? "已添加表格列。"
              : "已将 CSV 转为 Markdown 表格。",
      });
      return;
    }

    if (action === "block-id") {
      const line = view.state.doc.lineAt(selection.from);
      const id = createBlockId();
      const prefix = line.text.trim() ? " " : "";
      view.dispatch({
        changes: { from: line.to, to: line.to, insert: `${prefix}${id}` },
        selection: { anchor: line.to + prefix.length + id.length },
      });
      view.focus();
      setNotice({ tone: "info", message: `已插入块 ID ${id}。` });
      return;
    }

    if (action === "block-ref") {
      const id = selectedText.trim().replace(/^#?/, "") || createBlockId();
      const blockId = id.startsWith("^") ? id : `^${id}`;
      const insert = `[[${currentLinkTarget(path)}#${blockId}]]`;
      view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
      });
      view.focus();
      setNotice({ tone: "info", message: `已插入块引用 ${blockId}。` });
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
    if (action === "highlight" || action === "annotation") wrapSelection("==", "==", "高亮文本");
    if (action === "strikethrough") wrapSelection("~~", "~~", "删除线文本");
    if (action === "math-inline") wrapSelection("$", "$", "x");
    if (action === "comment") wrapSelection("<!-- ", " -->", "注释");
    if (action === "code" || action === "code-block") {
      if (action === "code-block" || selectedText.includes("\n")) {
        wrapSelection("```markdown\n", "\n```", selectedText || "code");
      } else {
        wrapSelection("`", "`", "代码");
      }
    }
    if (action === "link" || action === "markdown-link") {
      wrapSelection("[", "](https://example.com)", "链接文本");
    }
  }

  function handleAppMenuAction(action: string) {
    if (action === "insert-attachment") {
      void handleImportAttachment();
      return;
    }
    if (action === "focus-document-search") {
      setSearchOpen(true);
      return;
    }
    if (action === "view-preview") {
      setEditorMode("preview");
      return;
    }
    if (action === "view-source") {
      setEditorMode("edit");
      return;
    }
    if (action === "toggle-left-panel") {
      setLeftPanelOpen((open) => !open);
      return;
    }
    if (action === "toggle-right-panel") {
      setRightPanelOpen((open) => !open);
      return;
    }
    if (action === "toggle-feature-area") {
      setFeatureAreaOpen((open) => !open);
      return;
    }
    if (action === "split-vertical") {
      setSplitOrientation("vertical");
      setEditorMode("split");
      return;
    }
    if (action === "split-horizontal") {
      setSplitOrientation("horizontal");
      setEditorMode("split");
      return;
    }
    if (action === "navigate-back") {
      if (canPageBack) handlePreviousWindow();
      return;
    }
    if (action === "navigate-forward") {
      if (canPageForward) handleNextWindow();
      return;
    }
    if (action === "reload") {
      window.location.reload();
      return;
    }
    if (action === "toggle-developer-tools") {
      setNotice({ tone: "info", message: "开发者工具请通过 Tauri/WebView 调试入口打开。" });
    }
  }

  useEffect(() => {
    markdownActionRef.current = applyMarkdownAction;
    appMenuActionRef.current = handleAppMenuAction;
  });

  useEffect(() => {
    if (!nativeRuntime) return;
    let cancelled = false;
    const disposers: Array<() => void> = [];

    void listen<string>("lmd://markdown-action", (event) => {
      markdownActionRef.current(event.payload as MarkdownAction);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    });

    void listen<string>("lmd://app-menu-action", (event) => {
      appMenuActionRef.current(event.payload);
    }).then((dispose) => {
      if (cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    });

    return () => {
      cancelled = true;
      disposers.forEach((dispose) => dispose());
    };
  }, [nativeRuntime]);

  useEffect(() => {
    if (!nativeRuntime) return;
    void invokeCommand("update_native_menu_state", {
      state: {
        editorMode,
        leftPanelOpen,
        rightPanelOpen,
        featureAreaOpen,
        splitOrientation,
      },
    }).catch(() => {
      // Menu synchronization is best-effort; editing must not fail if the native menu is unavailable.
    });
  }, [editorMode, featureAreaOpen, leftPanelOpen, nativeRuntime, rightPanelOpen, splitOrientation]);

  useEffect(() => {
    if (!tabContextMenu) return;
    function closeContextMenu() {
      setTabContextMenu(null);
    }
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [tabContextMenu]);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);

  useEffect(() => {
    if (activeSearchMatch >= matches) setActiveSearchMatch(Math.max(0, matches - 1));
  }, [activeSearchMatch, matches]);

  function closeDocumentSearch() {
    setSearchOpen(false);
    setSearch("");
    setActiveSearchMatch(0);
    editorViewRef.current?.focus();
  }

  function goToSearchMatch(direction: "previous" | "next") {
    if (matches === 0) return;
    const nextIndex =
      direction === "next"
        ? (activeSearchMatch + 1) % matches
        : (activeSearchMatch - 1 + matches) % matches;
    setActiveSearchMatch(nextIndex);
    const range = searchRanges[nextIndex];
    if (!range) return;
    if (editorMode === "preview") setEditorMode("edit");
    window.setTimeout(() => {
      const view = editorViewRef.current;
      if (!view) return;
      view.dispatch({
        selection: EditorSelection.range(range.from, range.to),
        effects: EditorView.scrollIntoView(range.from, { y: "center" }),
      });
      view.focus();
    }, 0);
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

  useEffect(() => {
    if (!isNativeRuntime()) return;
    let cancelled = false;

    async function loadKeys() {
      const entries = await Promise.all(
        assistantCatalog.providers
          .filter((provider) => provider.apiKeyEnv)
          .map(async (provider) => {
            const apiKey = await invokeCommand<string | null>("load_assistant_api_key", {
              provider: provider.id,
            }).catch(() => null);
            return [provider.id, apiKey] as const;
          }),
      );
      if (cancelled) return;
      const assistantApiKeys = Object.fromEntries(
        entries.filter((entry): entry is readonly [AssistantProvider, string] => Boolean(entry[1])),
      ) as Partial<Record<AssistantProvider, string>>;
      if (Object.keys(assistantApiKeys).length === 0) return;
      setSettings((currentSettings) => ({ ...currentSettings, assistantApiKeys }));
    }

    void loadKeys();
    return () => {
      cancelled = true;
    };
  }, [assistantCatalog]);

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
    onFocusDocumentSearch: () => {
      setSearchOpen(true);
    },
    onSetEditorMode: setEditorMode,
  });

  useExternalChangePolling({
    path,
    knownModifiedMs,
    intervalMs: settings.externalCheckSeconds * 1000,
    onExternalChange: setExternalChange,
  });

  useEffect(() => {
    if (!path) {
      setHistorySnapshots([]);
      return;
    }
    void handleLoadHistorySnapshots(false);
  }, [path, workspace?.rootPath]);

  useEffect(() => {
    if (!workspace) {
      setGitStatus(null);
      return;
    }
    void handleRefreshGitStatus(false);
  }, [workspace?.rootPath, path]);

  function handleSettingsChange(nextSettings: typeof settings) {
    const previousApiKeys = settings.assistantApiKeys;
    setSettings(nextSettings);
    if (isNativeRuntime()) {
      writeSettingsWithoutApiKeys(nextSettings);
      for (const provider of assistantCatalog.providers) {
        if (!provider.apiKeyEnv) continue;
        const nextKey = nextSettings.assistantApiKeys[provider.id] ?? "";
        const previousKey = previousApiKeys[provider.id] ?? "";
        if (nextKey === previousKey) continue;
        const command = nextKey.trim() ? "save_assistant_api_key" : "delete_assistant_api_key";
        void invokeCommand(command, {
          provider: provider.id,
          apiKey: nextKey,
        }).catch((error) => {
          setNotice({ tone: "error", message: String(error) });
        });
      }
      return;
    }
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
      id: "daily",
      label: "打开今日笔记",
      hint: "创建或打开 daily/YYYY-MM-DD.md",
      disabled: busy || !workspace,
      run: () => void handleOpenDailyNote(),
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
      id: "block-ref",
      label: "插入块引用",
      hint: "[[note#^block-id]]",
      disabled: busy || readOnly,
      run: () => applyMarkdownAction("block-ref"),
    },
    {
      id: "history",
      label: "查看保存快照",
      hint: "列出当前文件最近保存前版本",
      disabled: busy || !path,
      run: () => void handleLoadHistorySnapshots(),
    },
    {
      id: "git-status",
      label: "刷新 Git 状态",
      hint: "查看改动、diff 和最近提交",
      disabled: busy || !workspace,
      run: () => void handleRefreshGitStatus(),
    },
    {
      id: "rename-tag",
      label: "重命名标签",
      hint: "级联更新工作区内 #tag 和 Front Matter tags",
      disabled: busy || !workspace,
      run: () => setTagRenameOpen(true),
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
    {
      id: "export-docx",
      label: "导出 DOCX",
      hint: "需要本机 pandoc",
      disabled: busy,
      run: () => void handleExportDocx(),
    },
  ];

  return (
    <main
      className={`app-shell ${leftPanelOpen ? "left-open" : "left-closed"} ${
        rightPanelOpen ? "right-open" : "right-closed"
      }`}
    >
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
      <TagRenameDialog
        open={tagRenameOpen}
        busy={busy}
        onCancel={() => setTagRenameOpen(false)}
        onSubmit={(oldTag, newTag) => void handleRenameWorkspaceTag(oldTag, newTag)}
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
          onOpenDailyNote={() => void handleOpenDailyNote()}
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
          onExportDocx={() => void handleExportDocx()}
        />

        <WorkspaceListPanel
          busy={busy}
          workspace={workspace}
          librarySection={librarySection}
          workspaceFiles={workspaceFiles}
          workspaceQuery={workspaceQuery}
          workspaceMatches={workspaceMatches}
          workspaceSearchActive={workspaceSearchActive}
          historySnapshots={historySnapshots}
          gitStatus={gitStatus}
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
          onRefreshHistorySnapshots={() => void handleLoadHistorySnapshots()}
          onOpenHistorySnapshot={(snapshot) => void handleOpenHistorySnapshot(snapshot)}
          onRefreshGitStatus={() => void handleRefreshGitStatus()}
          onGitCommit={() => void handleGitCommit()}
          onOpenRecentFile={(recentPath, name) => void openPath(recentPath, name)}
          onRemoveRecentFile={handleRemoveRecentFile}
          onSettingsChange={handleSettingsChange}
        />
      </div>

      <section className="editor-pane">
        {tabs.length > 0 && (
          <div className="document-tabs" role="tablist" aria-label="打开的笔记">
            {tabs.map((tab) => {
                const dirty = !tab.readOnly && tab.content !== tab.savedContent;
                return (
                  <div
                    key={tab.id}
                    className={`document-tab ${tab.id === activeTabId ? "active" : ""} ${dirty ? "dirty" : ""}`}
                    role="presentation"
                    onContextMenu={(event) => handleTabContextMenu(event, tab.id)}
                  >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === activeTabId}
                    onClick={() => handleSelectTab(tab.id)}
                    title={tab.path ?? "未命名"}
                  >
                    <span>{fileName(tab.path)}</span>
                    {dirty && <strong aria-label="未保存">*</strong>}
                  </button>
                  <button
                    type="button"
                    className="tab-close-button"
                    onClick={() => handleCloseTab(tab.id)}
                    aria-label={`关闭 ${fileName(tab.path)}`}
                    title="关闭"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tabContextMenu && (
          <div
            className="tab-context-menu"
            role="menu"
            aria-label="标签页菜单"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            {(() => {
              const tab = tabs.find((item) => item.id === tabContextMenu.tabId);
              const canRename = Boolean(
                tab?.path && !tab.readOnly && tab.content === tab.savedContent && !busy,
              );
              return (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleRenameTab(tabContextMenu.tabId)}
                    disabled={!canRename}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleCloseTab(tabContextMenu.tabId)}
                  >
                    关闭
                  </button>
                </>
              );
            })()}
          </div>
        )}

        {!hasOpenTab ? (
          <div className="empty-editor-state" aria-label="缺省页">
            <div>
              <h1>没有打开的笔记</h1>
              <p>新建或打开一个 Markdown 文件开始记录。</p>
            </div>
            <div className="empty-editor-actions">
              <button type="button" onClick={() => void handleNew()} disabled={busy}>
                新建
              </button>
              <button type="button" onClick={() => void handleOpen()} disabled={busy}>
                打开
              </button>
              <button type="button" onClick={() => void handleOpenDailyNote()} disabled={busy || !workspace}>
                今日笔记
              </button>
            </div>
          </div>
        ) : (
          <>
            {featureAreaOpen && (!nativeRuntime || isLarge) && (
              <EditorToolbar
                isLarge={isLarge}
                canFormat={!readOnly && !busy}
                showInlineFormat={!nativeRuntime}
                busy={busy}
                canPageBack={canPageBack}
                canPageForward={canPageForward}
                onPreviousWindow={handlePreviousWindow}
                onNextWindow={handleNextWindow}
                onMarkdownAction={applyMarkdownAction}
              />
            )}

            {searchOpen && (
              <div className="document-findbar" role="search" aria-label="文档查找">
                <label className="document-findbar-input">
                  <span>查找</span>
                  <input
                    ref={searchInputRef}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setActiveSearchMatch(0);
                    }}
                    placeholder="查找..."
                  />
                </label>
                <span className="document-findbar-count" aria-label="匹配数量">
                  {search.trim() ? `${matches === 0 ? 0 : activeSearchMatch + 1}/${matches}` : "0"}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => goToSearchMatch("previous")}
                  disabled={matches === 0}
                  aria-label="上一个匹配"
                  title="上一个匹配"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => goToSearchMatch("next")}
                  disabled={matches === 0}
                  aria-label="下一个匹配"
                  title="下一个匹配"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={closeDocumentSearch}
                  aria-label="关闭查找"
                  title="关闭查找"
                >
                  ×
                </button>
              </div>
            )}

            <NoticeStack
              notice={notice}
              externalChange={externalChange}
              busy={busy}
              onDismissNotice={() => setNotice(null)}
              onReloadCurrentFile={() => void handleReloadCurrentFile()}
            />

            <div className={`document-workspace ${editorMode}`}>
              {readOnly && (
                <div className="document-status-strip" role="status">
                  只读：第 {visibleStartLine.toLocaleString()}-{visibleEndLine.toLocaleString()} 行
                </div>
              )}
              <div className={`document-main ${editorMode} split-${splitOrientation}`}>
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
          </>
        )}
      </section>

      <aside className="right-companion inspector-rail" aria-label="检查器" aria-hidden={!rightPanelOpen}>
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
            hasCurrentContent={hasOpenTab && Boolean(content.trim())}
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
            onSaveChat={() => void handleSaveAssistantChat()}
            onInsertDraft={insertAssistantDraft}
            onReplaceSelection={replaceSelectionWithAssistantDraft}
          />
        )}
      </aside>
    </main>
  );
}
