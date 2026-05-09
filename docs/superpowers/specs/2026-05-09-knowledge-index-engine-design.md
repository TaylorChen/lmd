# LMD Knowledge Index Engine Design

## Goal

Upgrade LMD's knowledge workspace from file scanning plus JSON cache into a persistent local index that can support Obsidian-like navigation first, then graph, RAG, and LLM-Wiki workflows later.

The first milestone is deliberately narrow:

- preserve Markdown files as the source of truth
- keep the current UI behavior working
- replace repeated full-workspace relationship scans with a queryable local index
- model documents, blocks, links, backlinks, tags, aliases, and lint findings
- make future graph and RAG work depend on stable indexed data instead of ad hoc parsing

This milestone does not implement embeddings, vector search, automatic graph extraction, or autonomous wiki generation. Those should build on this index after it is reliable.

## Current State

Knowledge behavior is currently concentrated in `src-tauri/src/workspace.rs`.

The existing implementation can:

- initialize `notes/`, `sources/`, `wiki/`, `wiki/inbox/`, and `.lmd/knowledge/`
- scan Markdown files under the workspace
- build `.lmd/knowledge/index.json`
- extract wiki links, tags, frontmatter, backlinks, unresolved links, and simple query context
- save AI drafts into `wiki/inbox/`
- run simple workspace search with `path:`, `#tag`, and `block:^id`

The main limitations are:

- every important query still depends on file scanning or stale JSON snapshots
- no durable table model for blocks, links, aliases, or graph edges
- no file-change index invalidation beyond coarse refreshes
- search is not a proper indexed search engine
- graph and RAG cannot safely build on the current cache shape

## Architecture

Add a new Rust module:

```text
src-tauri/src/knowledge/
  mod.rs
  db.rs
  parser.rs
  indexer.rs
  search.rs
  graph.rs
  lint.rs
  types.rs
```

Responsibilities:

- `db.rs`: open, migrate, and query the SQLite database
- `parser.rs`: parse Markdown into a structured document model
- `indexer.rs`: scan or incrementally index workspace files
- `search.rs`: indexed workspace search and filters
- `graph.rs`: graph-ready node/edge queries derived from indexed data
- `lint.rs`: unresolved links, orphan pages, and index coverage checks
- `types.rs`: serializable command result types shared by Tauri commands

Keep `workspace.rs` as the compatibility layer for existing Tauri commands during the migration. It should delegate knowledge-specific work to the new module instead of growing further.

## Storage

Store the index inside the workspace:

```text
.lmd/
  knowledge/
    lmd.db
    manifest.json
```

`lmd.db` is derived state. It must be rebuildable from Markdown files. The app should never require this database to understand the user's content.

Use SQLite with:

- `rusqlite` for access
- FTS5 for full-text search
- WAL mode for safer local writes
- schema migrations through an internal `schema_migrations` table

Recommended Cargo dependencies:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
sha2 = "0.10"
uuid = { version = "1", features = ["v4"] }
pulldown-cmark = "0.12"
```

`pulldown-cmark` is enough for the first version. If later table editing or exact source-span fidelity requires richer Markdown AST behavior, switch the parser boundary internally without changing command APIs.

## Schema

Initial schema:

```sql
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  relative_path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT,
  source_kind TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  modified_ms INTEGER,
  content_hash TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE frontmatter (
  document_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (document_id, key, value)
);

CREATE TABLE aliases (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL
);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  block_id TEXT,
  heading_path TEXT,
  content TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL,
  from_block_id TEXT,
  target_raw TEXT NOT NULL,
  label TEXT NOT NULL,
  anchor TEXT,
  is_embed INTEGER NOT NULL DEFAULT 0,
  is_block_reference INTEGER NOT NULL DEFAULT 0,
  target_document_id TEXT,
  target_block_id TEXT,
  link_type TEXT NOT NULL
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL UNIQUE,
  parent_normalized_name TEXT
);

CREATE TABLE document_tags (
  document_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (document_id, tag_id)
);

CREATE VIRTUAL TABLE document_fts USING fts5(
  title,
  content,
  tags,
  relative_path,
  content='',
  tokenize='unicode61'
);
```

Indexes:

```sql
CREATE INDEX idx_documents_kind ON documents(source_kind);
CREATE INDEX idx_documents_modified ON documents(modified_ms);
CREATE INDEX idx_blocks_document ON blocks(document_id);
CREATE INDEX idx_blocks_block_id ON blocks(block_id);
CREATE INDEX idx_links_from_document ON links(from_document_id);
CREATE INDEX idx_links_target_document ON links(target_document_id);
CREATE INDEX idx_links_target_block ON links(target_block_id);
CREATE INDEX idx_aliases_normalized ON aliases(normalized_alias);
CREATE INDEX idx_tags_parent ON tags(parent_normalized_name);
```

## Parsing Rules

The indexer should parse each Markdown file into:

- frontmatter fields
- canonical title
- aliases from `aliases`, `alias`, or `aka`
- tags from frontmatter and body `#tag`
- headings and heading path
- blocks with line ranges
- explicit block IDs like `^block-id`
- wiki links:
  - `[[note]]`
  - `[[note|label]]`
  - `[[note#heading]]`
  - `[[note#^block-id]]`
  - `![[note]]`
  - `![[note#^block-id]]`
- standard Markdown links where the target points to local Markdown

Resolution order for `[[target]]`:

1. exact relative path
2. exact file stem
3. title match
4. alias match
5. case-insensitive fallback

If multiple documents match, keep the link unresolved and return ambiguity in lint results. Do not silently choose a random target.

## Indexing Flow

Workspace open:

```text
open workspace
  -> ensure .lmd/knowledge/lmd.db
  -> run migrations
  -> scan Markdown files
  -> compare path + modified_ms + byte_size + content_hash
  -> reindex changed files
  -> remove deleted files from index
  -> resolve links after document pass
  -> rebuild FTS rows for changed documents
```

Document save:

```text
save document
  -> write Markdown file
  -> reindex one document
  -> resolve links touching this document
  -> refresh current document knowledge
```

Rename:

```text
rename file
  -> filesystem rename
  -> update documents.path / relative_path
  -> re-resolve inbound and outbound links
  -> keep the existing tab bound to the new path
```

Full rebuild:

```text
delete lmd.db or run rebuild command
  -> rescan all Markdown
  -> rebuild all tables from source files
```

## Tauri Commands

Add or update commands:

```rust
initialize_knowledge_index(root_path: String) -> Result<KnowledgeIndexStatus, String>
rebuild_knowledge_index(root_path: String) -> Result<KnowledgeIndexStatus, String>
index_document(root_path: String, path: String, content: Option<String>) -> Result<KnowledgeIndexStatus, String>
document_knowledge(root_path: String, path: String, current_content: Option<String>) -> Result<DocumentKnowledge, String>
knowledge_lint_report(root_path: String) -> Result<KnowledgeLintReport, String>
search_workspace(root_path: String, query: String, max_results: usize) -> Result<Vec<SearchMatch>, String>
resolve_wiki_link(root_path: String, from_path: String, target: String) -> Result<LinkResolution, String>
create_wiki_page_for_link(root_path: String, target: String) -> Result<String, String>
list_tags(root_path: String) -> Result<Vec<TagNode>, String>
```

Existing command names should remain stable where the frontend already uses them. Internally they can delegate to the new engine.

## Frontend Changes

Keep the current layout. Add only the UI required to expose the stronger index:

- knowledge panel reads indexed backlinks/outgoing links/tags instead of scan results
- unresolved links section shows ambiguous and missing targets
- clicking a wiki link opens the resolved document
- unresolved link offers "create page"
- tag list can be rendered as a hierarchy when parent paths exist
- search results come from indexed search

Do not introduce a graph canvas in this milestone. The graph query API can exist, but visible graph UI belongs to the next milestone.

## Migration Strategy

This must be backward compatible:

- existing workspaces with `.lmd/knowledge/index.json` continue to open
- when `lmd.db` is missing, create it automatically
- keep writing `manifest.json`
- stop treating `index.json` as the authoritative cache after the SQLite index is stable
- leave all Markdown files untouched except when the user explicitly creates, saves, renames, or edits a file

During transition, `workspace.rs` can fall back to the old JSON cache if SQLite initialization fails. The UI should surface a warning but continue as a Markdown editor.

## Error Handling

Expected failures:

- database cannot be opened
- migration fails
- Markdown file cannot be read
- link target is ambiguous
- workspace root moved or deleted

Behavior:

- database errors should not block basic file editing
- indexing errors should be shown in the knowledge panel or notice stack
- ambiguous links should be lint warnings, not hard errors
- full rebuild should be available as a recovery action

## Testing

Rust unit tests:

- initializes SQLite schema
- indexes documents, blocks, frontmatter, aliases, tags, and links
- resolves links by path, stem, title, alias, and block ID
- marks ambiguous links unresolved
- removes deleted documents from index
- updates links after file rename
- searches by plain text, `path:`, `#tag`, and `block:^id`
- reports unresolved links, orphan wiki pages, and pages not linked from `wiki/index.md`

Frontend tests:

- clicking a resolved wiki link opens a document
- creating a missing wiki link creates and opens the new page
- tag hierarchy renders without breaking existing flat tag display
- search still works from the sidebar and document search remains separate

Manual verification:

1. Open an existing workspace.
2. Confirm `.lmd/knowledge/lmd.db` is created.
3. Open a document with `[[wiki-link]]`, tags, and block IDs.
4. Confirm the knowledge panel shows backlinks, unresolved links, tags, and block references.
5. Create a missing link page from the UI.
6. Rename an open file and confirm tabs plus backlinks remain valid.
7. Search with `path:wiki`, `#tag`, and `block:^id`.

## Milestone Exit Criteria

Milestone 1 is complete when:

- current visible knowledge features work from SQLite-backed data
- existing workspaces migrate automatically
- full rebuild is possible
- search and document knowledge no longer depend on full scans for every query
- tests cover the indexer, resolver, search, lint, and rename paths
- no user Markdown content is rewritten during indexing

## Next Milestones

After this milestone:

1. Graph milestone: expose graph nodes/edges and add current-document graph UI.
2. RAG milestone: add chunks, embeddings, hybrid retrieval, and cited answers.
3. LLM-Wiki milestone: generate source-backed wiki candidates with human review.

