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

export type SearchMatch = {
  path: string;
  relativePath: string;
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
};

export type RecentFile = {
  path: string;
  name: string;
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
};

export type EditorMode = "edit" | "split" | "preview";

export type AppSettings = {
  defaultEditorMode: EditorMode;
  searchResultLimit: number;
  externalCheckSeconds: number;
};
