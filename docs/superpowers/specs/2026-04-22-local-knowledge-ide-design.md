# LMD Local Knowledge IDE Design

## Goal

Evolve LMD from a local-first Markdown editor into a local personal knowledge IDE that can:

- keep user-authored Markdown as the primary source of truth
- manage immutable raw sources separately from authored notes
- maintain a persistent Markdown wiki as the LLM-assisted knowledge layer
- support `ingest`, `query`, and `lint` workflows over that wiki
- embed LLM-assisted writing and knowledge maintenance without turning the product into a generic chat client

This design assumes a single-user local knowledge base. It does not target collaboration, cloud sync, or multi-user permissions.

## Product Position

LMD should become a local Markdown IDE for knowledge work, not a note database, not a graph-first novelty app, and not an agent orchestration platform.

The product is composed of three layers:

1. Raw sources
   - imported source material such as Markdown, text, PDF, HTML, and similar files
   - treated as immutable factual input
2. Persistent wiki
   - Markdown pages maintained with LLM assistance
   - contains concepts, entities, syntheses, source summaries, indexes, and logs
3. Schema and runtime rules
   - rules that guide how the wiki is updated, linked, named, linted, and queried

The editor remains important, but the primary differentiator is the durable wiki layer and its maintenance workflow.

## Design Principles

- User-authored content is first-class and must remain understandable outside the app.
- Raw sources are not silently rewritten by the system.
- Wiki pages are durable Markdown assets, not opaque vector-only artifacts.
- All derived knowledge artifacts should be rebuildable.
- AI output defaults to draft, insert, append, or save-as-new-page flows rather than silent overwrite.
- `index.md` and `log.md` are central navigation assets, not incidental metadata.
- Graph and semantic retrieval are supporting capabilities, not the system center.
- The app must still function as a usable Markdown editor when any LLM integration is unavailable.

## Scope

This design covers:

- workspace structure for a local knowledge base
- knowledge runtime responsibilities inside LMD
- integration boundaries for an external `llm-wiki` style workflow
- UI additions for knowledge navigation and assisted writing
- milestone-based implementation plan

This design does not cover:

- cloud sync
- collaborative editing
- user accounts or permissions
- broad plugin systems
- full agent autonomy over the workspace

## Workspace Model

LMD should recognize a knowledge workspace with the following structure:

```text
workspace/
  notes/                     # user-authored notes and drafts
  sources/                   # imported factual sources
  wiki/                      # persistent LLM-assisted knowledge layer
    index.md                 # curated global entry point
    log.md                   # append-only or mostly append-only activity log
    inbox/                   # newly generated or review-needed pages
    entities/                # named entity pages
    concepts/                # concept/topic pages
    syntheses/               # comparison and synthesis pages
    sources/                 # source summary pages
  .lmd/
    knowledge/
      manifest.json          # workspace knowledge runtime state
      index.json             # cached structural index
      cache/                 # temporary runtime cache
      tasks/                 # task state and logs
  AGENTS.md                  # schema and maintenance instructions
```

`notes/` and `wiki/` are both editable Markdown, but they serve different purposes:

- `notes/` is where the user writes directly
- `wiki/` is where the system maintains durable knowledge pages

`sources/` should be treated as read-only input from the app's perspective unless the user explicitly edits a source file as a normal document.

## Core Assets

### `wiki/index.md`

This file is the main human-readable directory of the knowledge base.

Responsibilities:

- list major topic areas
- link to important entity, concept, and synthesis pages
- provide a stable entry point for manual browsing and query context assembly
- remain concise enough to scan

The system may update this file, but updates should be conservative and auditable.

### `wiki/log.md`

This file records meaningful knowledge-base maintenance activity.

Responsibilities:

- record source ingestion events
- record creation or major updates of wiki pages
- record lint findings worth user attention
- provide a chronological trail for review

The log should be append-first and readable as ordinary Markdown.

### `AGENTS.md`

This file is the schema and maintenance contract for the workspace.

Responsibilities:

- define page naming rules
- define linking expectations
- define required or optional frontmatter
- define how new pages should be placed in `wiki/`
- define how `index.md` and `log.md` should be updated
- define lint rules and severity expectations

LMD should ship a default template and allow the user to edit it.

## Data Model

LMD still needs an internal structural index even if an external `llm-wiki` process is used.

Minimum structural entities:

- `DocumentRecord`
  - `path`
  - `title`
  - `source_kind` (`note`, `source`, `wiki`)
  - `headings`
  - `tags`
  - `wikilinks`
  - `markdown_links`
  - `modified_at`
  - `frontmatter`

- `LinkEdge`
  - `from_path`
  - `to_path`
  - `kind` (`wiki`, `markdown`, `tag`, `heading`)
  - `anchor`
  - `label`

- `KnowledgeIndex`
  - `documents`
  - `backlinks`
  - `unresolved_links`
  - `tag_index`
  - `page_kind_index`
  - `source_to_wiki_refs`

- `KnowledgeManifest`
  - `workspace_root`
  - `schema_path`
  - `last_indexed_at`
  - `last_ingest_at`
  - `last_query_at`
  - `last_lint_at`
  - `last_compile_status`
  - `integration_mode`
  - `index_version`

These objects should be rebuildable from workspace files plus runtime cache.

## Runtime Responsibilities Inside LMD

LMD should own the following runtime responsibilities:

1. workspace discovery and initialization
2. frontmatter, wikilink, tag, heading, and backlink indexing
3. local knowledge health checks
4. task orchestration for ingest, query, and lint actions
5. UI for knowledge browsing, review, and assisted writing
6. provider configuration and safe context assembly for LLM requests

LMD should not try to own a full autonomous research-agent runtime in the initial design.

## External `llm-wiki` Integration Boundary

The integration should be weakly coupled.

Preferred modes:

1. External command mode
   - LMD invokes a configured executable or script for `ingest`, `query`, and `lint`
   - results are read from `wiki/`, `.lmd/knowledge/`, and stdout/stderr logs
2. Local service mode
   - LMD talks to a local HTTP or IPC service that maintains the wiki

LMD should not assume a single implementation. The contract should be filesystem-first and task-oriented.

Minimum contract for integration:

- accept workspace root
- accept action type: `ingest`, `query`, `lint`
- accept optional target scope: source paths, wiki paths, or current document
- emit task progress
- write resulting pages into `wiki/`
- update or suggest updates to `index.md` and `log.md`
- expose errors in a form LMD can surface to the user

## Workflows

### Ingest

Purpose:

- turn selected source materials into durable wiki artifacts

Expected flow:

1. user imports or selects one or more files from `sources/`
2. LMD creates an ingest task
3. integration runtime produces or updates source summary pages and any related concept/entity pages
4. LMD refreshes structural index
5. LMD updates task status and surfaces reviewable outputs
6. `wiki/log.md` records the ingest event

### Query

Purpose:

- answer a question using the persistent wiki and selected local context

Expected flow:

1. user asks from the Assistant panel or from a document context
2. LMD resolves context from current selection, current document, linked wiki pages, and index hints
3. integration runtime returns an answer plus cited pages
4. user can copy, insert, append, or save the answer as a new wiki page
5. optional save action updates `wiki/index.md` and `wiki/log.md`

### Lint

Purpose:

- find structural and maintenance problems in the knowledge base

First lint set:

- broken or unresolved links
- orphan wiki pages
- missing backlinks where expected
- malformed or missing frontmatter for page types that require it
- pages not linked from `index.md`
- source pages with no downstream wiki references

Lint results should be reviewable, not silently auto-fixed.

## UI Architecture

The current app already has editor and preview modes. The new structure should add a knowledge-oriented right rail without burying editing.

### Main Layout

Recommended near-term layout:

- left rail: workspace tree, search, filters
- center: editor
- right rail tabs:
  - `Preview`
  - `Knowledge`
  - `Assistant`

This preserves the existing editor flow while creating a stable home for knowledge features.

### Knowledge Panel

First version should include:

- current document outgoing links
- backlinks
- tags
- related wiki pages
- source references
- unresolved links
- quick links to `wiki/index.md` and `wiki/log.md`

### Wiki Index Panel

This can be a focused view or a section inside the Knowledge panel.

Responsibilities:

- render the structure of `wiki/index.md`
- allow one-click navigation to major wiki pages
- show page counts by area if available

### Wiki Log Panel

Responsibilities:

- display recent ingest and maintenance events
- let the user open the affected page or source
- give visibility into what changed recently

### Lint Panel

Responsibilities:

- show grouped issues
- allow navigation to the relevant page
- mark whether an issue is informational, warning, or blocking

### Assistant Panel

The Assistant is not a generic chat tool. It is a context-aware writing and wiki-maintenance surface.

First actions should be grouped as:

- writing actions
  - rewrite
  - expand
  - compress
  - explain
  - translate
- wiki actions
  - summarize source into wiki page
  - compare topics and save synthesis page
  - answer and save as wiki page
  - propose links or related pages

All Assistant requests should visibly disclose context sources before execution.

## Context Assembly Rules

LLM context should be assembled from explicit, inspectable layers:

1. current selection
2. current document
3. linked wiki pages
4. index-guided related pages
5. user-selected source pages

The app should not silently upload the entire workspace by default.

User controls should include:

- which provider is active
- whether external network providers are allowed
- which directories may be used for context
- whether responses may be saved into `wiki/`

## Priorities

The implementation order should reflect actual product value:

1. workspace and wiki protocol
2. `index.md` and `log.md` support
3. schema template and editing
4. structural indexing and lint
5. knowledge navigation UI
6. Assistant save-to-wiki flows
7. local graph view
8. optional semantic retrieval

Graph visualization is useful but should remain secondary to navigable wiki structure and maintenance health.

## Milestones

### M1: Workspace And Wiki Protocol

Goal:

- establish the filesystem and runtime contract for a local knowledge workspace

Deliverables:

- workspace initialization flow
- `.lmd/knowledge/manifest.json`
- default `AGENTS.md`
- `wiki/index.md`
- `wiki/log.md`
- source, note, and wiki directory handling rules

Acceptance:

- user can initialize a knowledge workspace from LMD
- LMD recognizes and restores the workspace correctly
- `wiki/` is treated as a special knowledge area, not just another folder

### M2: Wiki Maintenance Runtime

Goal:

- make the workspace structurally useful even before advanced LLM integration

Deliverables:

- frontmatter parser
- wikilink parser
- backlink index
- unresolved link tracking
- lint engine v1
- index and log read/write helpers
- ingest/query/lint task skeleton

Acceptance:

- backlinks and unresolved links update after file edits and external changes
- lint results are visible and navigable
- `index.md` and `log.md` can be read, opened, and updated through controlled flows

### M3: Knowledge UI

Goal:

- expose the knowledge layer in a way that is useful during writing and review

Deliverables:

- right-rail Knowledge tab
- right-rail Lint section or tab
- index navigation view
- log timeline view
- current document relation view

Acceptance:

- user can inspect current document relations without leaving the editor
- user can navigate from lint issues to the relevant file
- user can open `index.md` and `log.md` quickly from the UI

### M4: Assistant And Wiki Actions

Goal:

- allow LLM-assisted writing and knowledge maintenance with explicit context

Deliverables:

- provider settings
- Assistant panel
- context source inspector
- save answer as wiki page
- summarize source into wiki page
- compare topics into synthesis page

Acceptance:

- assistant output can be inserted, appended, or saved as a new page
- saved outputs participate in index refresh and backlinks
- provider or network failure does not break core editing

### M5: Graph And Search Enhancements

Goal:

- improve exploration after the knowledge base becomes large enough

Deliverables:

- local graph view
- stronger Markdown search over wiki content
- optional hybrid search
- optional vector retrieval

Acceptance:

- local graph remains responsive on realistic personal knowledge workspaces
- search results can be traced back to actual wiki or source pages

## Technical Structure

Likely frontend additions:

- `src/lib/wiki.ts`
- `src/lib/schema.ts`
- `src/lib/knowledge.ts`
- `src/components/KnowledgePanel.tsx`
- `src/components/WikiIndexPanel.tsx`
- `src/components/WikiLogPanel.tsx`
- `src/components/LintPanel.tsx`
- `src/components/AssistantPanel.tsx`

Likely Rust additions:

- `src-tauri/src/wiki.rs`
- `src-tauri/src/frontmatter.rs`
- `src-tauri/src/indexer.rs`
- `src-tauri/src/lint.rs`
- `src-tauri/src/tasks.rs`
- `src-tauri/src/integration.rs`

Existing modules to evolve:

- `workspace.rs`
  - from file list scanning toward knowledge-aware workspace scanning
- `document.rs`
  - to expose more document metadata for knowledge workflows
- `export.rs`
  - eventually to support wiki-oriented export profiles
- frontend markdown utilities
  - from rendering-only helpers toward a parsing and rendering entry point

## Testing And Verification

Verification should grow with each milestone.

Core automated checks to preserve:

- `npm run build`
- `npm run test:e2e`
- `cd src-tauri && cargo test`

New test focus areas:

- workspace initialization for knowledge mode
- wikilink and frontmatter parsing
- backlink updates after rename, delete, and external change
- lint detection for broken links and orphan pages
- task state transitions for ingest, query, and lint
- Assistant context disclosure and save-to-wiki actions

Manual verification should include:

- creating and opening a knowledge workspace
- importing source material
- editing both `notes/` and `wiki/`
- checking that knowledge panels reflect current document relations
- saving an LLM answer as a wiki page and seeing it appear in navigation

## Risks

- letting the wiki layer silently diverge from user expectations
- allowing AI output to overwrite authored notes without review
- overfitting the app to one `llm-wiki` implementation
- introducing too much autonomy before review and lint loops are visible
- making graph and semantic retrieval features too early and diluting the core workflow

## Open Decisions

These should be resolved during implementation planning:

- exact `AGENTS.md` schema template
- whether `notes/` is mandatory or optional in knowledge mode
- whether `wiki/index.md` is mostly machine-maintained or partly curated by the user
- exact integration transport for external `llm-wiki`
- whether initial query flows use only structural retrieval or also simple local full-text ranking
