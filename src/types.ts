export type MarkdownDocument = {
  path: string;
  content: string;
  byteSize: number;
  lineCount: number;
  modifiedMs: number | null;
  isLarge: boolean;
  readOnly: boolean;
  visibleStartLine: number;
  visibleLineCount: number;
};

export type SaveResult = {
  path: string;
  byteSize: number;
  lineCount: number;
  modifiedMs: number | null;
};

export type HistorySnapshot = {
  path: string;
  name: string;
  modifiedMs: number | null;
  byteSize: number;
};

export type AttachmentImportResult = {
  path: string;
  markdown: string;
};

export type DocumentStats = {
  byteSize: number;
  lineCount: number;
};

export type FileMetadata = {
  exists: boolean;
  byteSize: number | null;
  modifiedMs: number | null;
};

export type LineRange = {
  content: string;
  startLine: number;
  lineCount: number;
};

export type WorkspaceFile = {
  path: string;
  relativePath: string;
  name: string;
  byteSize: number;
};

export type DocumentHeading = {
  id: string;
  level: number;
  title: string;
  lineNumber: number;
  offset: number;
};

export type SidebarView = "tree" | "search" | "recent";

export type Workspace = {
  rootPath: string;
  files: WorkspaceFile[];
  knowledge: WorkspaceKnowledge;
};

export type WorkspaceKnowledge = {
  isInitialized: boolean;
  notesPath: string;
  sourcesPath: string;
  wikiPath: string;
  schemaPath: string;
  manifestPath: string;
};

export type FrontmatterField = {
  key: string;
  value: string;
};

export type KnowledgeLink = {
  target: string;
  label: string;
  anchor: string | null;
  isBlockReference: boolean;
  resolvedPath: string | null;
  resolvedRelativePath: string | null;
  resolvedName: string | null;
  sourceKind: "note" | "source" | "wiki" | null;
};

export type Backlink = {
  path: string;
  relativePath: string;
  name: string;
  sourceKind: "note" | "source" | "wiki";
  label: string;
};

export type DocumentKnowledge = {
  currentPath: string;
  currentRelativePath: string;
  frontmatter: FrontmatterField[];
  tags: string[];
  outgoingLinks: KnowledgeLink[];
  backlinks: Backlink[];
  unresolvedLinks: KnowledgeLink[];
  relatedWikiPages: Backlink[];
  sourceReferences: Backlink[];
};

export type KnowledgeLintIssue = {
  kind: "unresolved_link" | "orphan_wiki_page" | "not_in_index";
  severity: "info" | "warning" | "error";
  path: string;
  relativePath: string;
  message: string;
};

export type KnowledgeLintReport = {
  issues: KnowledgeLintIssue[];
};

export type KnowledgeIndexStatus = {
  documentCount: number;
  indexedCount: number;
  removedCount: number;
  databasePath: string;
};

export type QueryContextItem = {
  path: string;
  relativePath: string;
  name: string;
  sourceKind: "note" | "source" | "wiki";
  reason: "current_document" | "linked_wiki" | "source_reference" | "backlink" | "index_hint";
  excerpt: string;
};

export type QueryContext = {
  currentPath: string;
  currentRelativePath: string;
  items: QueryContextItem[];
};

export type AssistantDraft = {
  title: string;
  content: string;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type AssistantEvent = {
  label: string;
  detail: string;
  tone: "info" | "error";
};

export type AssistantProvider =
  | "deepseek"
  | "minimax"
  | "kimi"
  | "zhipu"
  | "ollama"
  | "lmstudio"
  | "external_command";

export type AssistantProviderInfo = {
  id: AssistantProvider;
  label: string;
  models: string[];
  baseUrl?: string;
  apiKeyEnv?: string;
};

export type AssistantCatalog = {
  defaultProvider: AssistantProvider;
  providers: AssistantProviderInfo[];
};

export type SearchMatch = {
  path: string;
  relativePath: string;
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
};

export type GitFileChange = {
  status: string;
  path: string;
};

export type GitCommit = {
  hash: string;
  subject: string;
  author: string;
  date: string;
};

export type GitStatus = {
  isRepository: boolean;
  branch: string | null;
  changes: GitFileChange[];
  currentFileDiff: string;
  recentCommits: GitCommit[];
};

export type TagRenameResult = {
  filesChanged: number;
  replacements: number;
};

export type RecentFile = {
  path: string;
  name: string;
};

export type RecentWorkspace = {
  path: string;
  name: string;
  openedAt: number;
};

export type DropPathInfo = {
  path: string;
  kind: "markdown" | "directory" | "unsupported";
};

export type ExternalChange =
  | {
      kind: "modified";
      modifiedMs: number | null;
      byteSize: number | null;
    }
  | {
      kind: "missing";
    };

export type Notice = {
  tone: "info" | "error";
  message: string;
  /** Undefined uses the default transient timeout; null keeps the notice visible. */
  dismissAfterMs?: number | null;
};

export type EditorMode = "edit" | "split" | "preview";

export type AppSettings = {
  defaultEditorMode: EditorMode;
  searchResultLimit: number;
  externalCheckSeconds: number;
  assistantProvider: AssistantProvider;
  assistantModel: string;
  assistantApiKeys: Partial<Record<AssistantProvider, string>>;
  assistantBaseUrls: Partial<Record<AssistantProvider, string>>;
  assistantExternalCommand: string;
  assistantExternalTimeoutSeconds: number;
};
