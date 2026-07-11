use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::workspace::{
    Backlink, DocumentKnowledge, FrontmatterField, KnowledgeLink, KnowledgeLintIssue,
    KnowledgeLintReport, QueryContext, QueryContextItem, SearchMatch, WorkspaceFile,
    MAX_SEARCH_RESULTS,
};

const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeIndexStatus {
    pub(crate) document_count: usize,
    pub(crate) indexed_count: usize,
    pub(crate) removed_count: usize,
    pub(crate) database_path: String,
}

#[derive(Debug, Clone)]
struct ParsedDocument {
    path: String,
    relative_path: String,
    name: String,
    title: Option<String>,
    source_kind: String,
    byte_size: u64,
    modified_ms: Option<i64>,
    content_hash: String,
    frontmatter: Vec<FrontmatterField>,
    aliases: Vec<String>,
    tags: Vec<String>,
    blocks: Vec<ParsedBlock>,
    links: Vec<ParsedLink>,
    content: String,
}

#[derive(Debug, Clone)]
struct ParsedBlock {
    stable_id: String,
    block_id: Option<String>,
    heading_path: Option<String>,
    content: String,
    line_start: usize,
    line_end: usize,
    content_hash: String,
}

#[derive(Debug, Clone)]
struct ParsedLink {
    stable_id: String,
    from_block_id: Option<String>,
    target_raw: String,
    label: String,
    anchor: Option<String>,
    is_embed: bool,
    is_block_reference: bool,
    link_type: String,
    resolved_document_id: Option<String>,
    resolved_block_id: Option<String>,
}

#[derive(Debug, Clone)]
struct IndexedDocument {
    id: String,
    path: String,
    relative_path: String,
    name: String,
    source_kind: String,
    frontmatter: Vec<FrontmatterField>,
    tags: Vec<String>,
}

#[derive(Debug, Clone)]
struct IndexedLink {
    target_raw: String,
    label: String,
    anchor: Option<String>,
    is_block_reference: bool,
    target_document_id: Option<String>,
}

#[derive(Debug, Clone)]
struct LinkTarget {
    id: String,
    relative_path: String,
    name: String,
    title: Option<String>,
}

pub(crate) fn ensure_index(
    root: &Path,
    files: &[WorkspaceFile],
) -> Result<KnowledgeIndexStatus, String> {
    let db_path = db_path(root);
    let mut connection = open_database(root)?;
    migrate(&connection)?;
    let known_paths = files
        .iter()
        .map(|file| file.relative_path.clone())
        .collect::<HashSet<_>>();
    let removed_count = remove_deleted_documents(&mut connection, &known_paths)?;
    let parsed = parse_workspace_files(files)?;
    let indexed_count = upsert_documents(&mut connection, parsed)?;
    resolve_all_links(&mut connection)?;
    let document_count = count_documents(&connection)?;
    Ok(KnowledgeIndexStatus {
        document_count,
        indexed_count,
        removed_count,
        database_path: db_path.to_string_lossy().to_string(),
    })
}

pub(crate) fn rebuild_index(
    root: &Path,
    files: &[WorkspaceFile],
) -> Result<KnowledgeIndexStatus, String> {
    let db_path = db_path(root);
    if db_path.exists() {
        fs::remove_file(&db_path)
            .map_err(|error| format!("Could not remove {}: {error}", db_path.display()))?;
    }
    ensure_index(root, files)
}

pub(crate) fn document_knowledge(
    root: &Path,
    files: &[WorkspaceFile],
    current_path: &Path,
    current_content: Option<&str>,
) -> Result<DocumentKnowledge, String> {
    ensure_index(root, files)?;
    let connection = open_database(root)?;
    let current_key = current_path.to_string_lossy().to_string();
    let mut current = load_document_by_path(&connection, &current_key)?.ok_or_else(|| {
        format!(
            "Current document is not inside workspace: {}",
            current_path.display()
        )
    })?;

    let current_links = if let Some(content) = current_content {
        let file = files
            .iter()
            .find(|file| file.path == current_key)
            .ok_or_else(|| {
                format!(
                    "Current document is not inside workspace: {}",
                    current_path.display()
                )
            })?;
        let mut parsed = parse_file_with_content(file, content.to_string())?;
        let resolver = build_resolver(&connection)?;
        resolve_links_for_document(&mut parsed, &resolver);
        current.frontmatter = parsed.frontmatter;
        current.tags = parsed.tags;
        parsed
            .links
            .iter()
            .map(|link| indexed_link_from_parsed(link))
            .collect::<Vec<_>>()
    } else {
        load_links_for_document(&connection, &current.id)?
    };

    let backlinks = load_backlinks(&connection, &current.id)?;
    let outgoing_links = current_links
        .iter()
        .map(|link| to_knowledge_link(&connection, link))
        .collect::<Result<Vec<_>, _>>()?;
    let unresolved_links = outgoing_links
        .iter()
        .filter(|link| link.resolved_path.is_none())
        .cloned()
        .collect::<Vec<_>>();
    let related_wiki_pages = backlinks
        .iter()
        .filter(|link| link.source_kind == "wiki")
        .cloned()
        .collect::<Vec<_>>();
    let mut source_references = outgoing_links
        .iter()
        .filter(|link| link.source_kind == Some("source".to_string()))
        .filter_map(|link| {
            Some(Backlink {
                path: link.resolved_path.clone()?,
                relative_path: link.resolved_relative_path.clone()?,
                name: link
                    .resolved_name
                    .clone()
                    .unwrap_or_else(|| link.label.clone()),
                source_kind: "source".to_string(),
                label: link.label.clone(),
            })
        })
        .collect::<Vec<_>>();
    source_references.extend(
        backlinks
            .iter()
            .filter(|link| link.source_kind == "source")
            .cloned(),
    );
    source_references.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    source_references.dedup_by(|left, right| left.path == right.path);

    Ok(DocumentKnowledge {
        current_path: current.path,
        current_relative_path: current.relative_path,
        frontmatter: current.frontmatter,
        tags: current.tags,
        outgoing_links,
        backlinks,
        unresolved_links,
        related_wiki_pages,
        source_references,
    })
}

pub(crate) fn knowledge_lint_report(
    root: &Path,
    files: &[WorkspaceFile],
) -> Result<KnowledgeLintReport, String> {
    ensure_index(root, files)?;
    let connection = open_database(root)?;
    let mut issues = Vec::new();

    let mut unresolved = connection
        .prepare(
            "SELECT d.path, d.relative_path, l.target_raw
             FROM links l
             JOIN documents d ON d.id = l.from_document_id
             WHERE l.target_document_id IS NULL
             ORDER BY d.relative_path, l.target_raw",
        )
        .map_err(|error| error.to_string())?;
    let rows = unresolved
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (path, relative_path, target) = row.map_err(|error| error.to_string())?;
        issues.push(KnowledgeLintIssue {
            kind: "unresolved_link".to_string(),
            severity: "warning".to_string(),
            path,
            relative_path,
            message: format!("Unresolved link: {target}"),
        });
    }

    let index_id = connection
        .query_row(
            "SELECT id FROM documents WHERE relative_path = 'wiki/index.md'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let linked_from_index = if let Some(index_id) = index_id {
        load_links_for_document(&connection, &index_id)?
            .into_iter()
            .filter_map(|link| link.target_document_id)
            .collect::<HashSet<_>>()
    } else {
        HashSet::new()
    };

    let mut wiki_documents = connection
        .prepare(
            "SELECT id, path, relative_path FROM documents
             WHERE source_kind = 'wiki'
             ORDER BY relative_path",
        )
        .map_err(|error| error.to_string())?;
    let rows = wiki_documents
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (id, path, relative_path) = row.map_err(|error| error.to_string())?;
        if matches!(relative_path.as_str(), "wiki/index.md" | "wiki/log.md") {
            continue;
        }
        let inbound = connection
            .query_row(
                "SELECT COUNT(*) FROM links WHERE target_document_id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        if inbound == 0 {
            issues.push(KnowledgeLintIssue {
                kind: "orphan_wiki_page".to_string(),
                severity: "warning".to_string(),
                path: path.clone(),
                relative_path: relative_path.clone(),
                message: "Wiki page has no backlinks.".to_string(),
            });
        }
        if !linked_from_index.contains(&id) {
            issues.push(KnowledgeLintIssue {
                kind: "not_in_index".to_string(),
                severity: "info".to_string(),
                path,
                relative_path,
                message: "Wiki page is not linked from wiki/index.md.".to_string(),
            });
        }
    }

    issues.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| left.kind.cmp(&right.kind))
    });
    Ok(KnowledgeLintReport { issues })
}

pub(crate) fn search_workspace(
    root: &Path,
    files: &[WorkspaceFile],
    query: &str,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    ensure_index(root, files)?;
    let connection = open_database(root)?;
    let max_results = max_results.min(MAX_SEARCH_RESULTS);
    let parsed = parse_search_query(query);
    let candidate_ids = candidate_document_ids(&connection, &parsed)?;
    let mut matches = Vec::new();

    for id in candidate_ids {
        let document = load_document_by_id(&connection, &id)?
            .ok_or_else(|| format!("Indexed document is missing while searching: {id}"))?;
        if parsed
            .path_filters
            .iter()
            .any(|filter| !document.relative_path.to_ascii_lowercase().contains(filter))
        {
            continue;
        }
        if parsed.tag_filters.iter().any(|tag| {
            !document
                .tags
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(tag))
        }) {
            continue;
        }
        let mut has_all_blocks = true;
        for block in &parsed.block_filters {
            if !document_has_block(&connection, &id, block)? {
                has_all_blocks = false;
                break;
            }
        }
        if !has_all_blocks {
            continue;
        }

        let content = fs::read_to_string(&document.path)
            .map_err(|error| format!("Could not search {}: {error}", document.path))?;
        collect_line_matches(
            &document,
            &content,
            &parsed.content_terms,
            max_results,
            &mut matches,
        );
        if matches.len() >= max_results {
            break;
        }
    }

    Ok(matches)
}

pub(crate) fn query_context(
    root: &Path,
    files: &[WorkspaceFile],
    current_path: &Path,
    current_content: Option<&str>,
) -> Result<QueryContext, String> {
    let knowledge = document_knowledge(root, files, current_path, current_content)?;
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    push_context_item(
        root,
        &mut items,
        &mut seen,
        &knowledge.current_path,
        "current_document",
    )?;
    for link in &knowledge.outgoing_links {
        if link.source_kind == Some("wiki".to_string()) {
            if let Some(path) = &link.resolved_path {
                push_context_item(root, &mut items, &mut seen, path, "linked_wiki")?;
            }
        } else if link.source_kind == Some("source".to_string()) {
            if let Some(path) = &link.resolved_path {
                push_context_item(root, &mut items, &mut seen, path, "source_reference")?;
            }
        }
    }
    for backlink in &knowledge.backlinks {
        push_context_item(root, &mut items, &mut seen, &backlink.path, "backlink")?;
    }
    let index_path = root.join("wiki/index.md");
    if index_path.is_file() {
        push_context_item(
            root,
            &mut items,
            &mut seen,
            &index_path.to_string_lossy(),
            "index_hint",
        )?;
    }

    Ok(QueryContext {
        current_path: knowledge.current_path,
        current_relative_path: knowledge.current_relative_path,
        items,
    })
}

fn open_database(root: &Path) -> Result<Connection, String> {
    let path = db_path(root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let connection = Connection::open(&path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Could not enable WAL for {}: {error}", path.display()))?;
    Ok(connection)
}

fn db_path(root: &Path) -> PathBuf {
    root.join(".lmd/knowledge/lmd.db")
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at INTEGER NOT NULL
            );
            ",
        )
        .map_err(|error| error.to_string())?;
    let current_version = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?;
    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS documents (
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
            CREATE TABLE IF NOT EXISTS frontmatter (
              document_id TEXT NOT NULL,
              key TEXT NOT NULL,
              value TEXT NOT NULL,
              PRIMARY KEY (document_id, key, value)
            );
            CREATE TABLE IF NOT EXISTS aliases (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              alias TEXT NOT NULL,
              normalized_alias TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS blocks (
              id TEXT PRIMARY KEY,
              document_id TEXT NOT NULL,
              block_id TEXT,
              heading_path TEXT,
              content TEXT NOT NULL,
              line_start INTEGER NOT NULL,
              line_end INTEGER NOT NULL,
              content_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS links (
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
            CREATE TABLE IF NOT EXISTS tags (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              normalized_name TEXT NOT NULL UNIQUE,
              parent_normalized_name TEXT
            );
            CREATE TABLE IF NOT EXISTS document_tags (
              document_id TEXT NOT NULL,
              tag_id TEXT NOT NULL,
              PRIMARY KEY (document_id, tag_id)
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
              document_id UNINDEXED,
              title,
              content,
              tags,
              relative_path,
              tokenize='unicode61'
            );
            CREATE INDEX IF NOT EXISTS idx_documents_kind ON documents(source_kind);
            CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_ms);
            CREATE INDEX IF NOT EXISTS idx_blocks_document ON blocks(document_id);
            CREATE INDEX IF NOT EXISTS idx_blocks_block_id ON blocks(block_id);
            CREATE INDEX IF NOT EXISTS idx_links_from_document ON links(from_document_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_document ON links(target_document_id);
            CREATE INDEX IF NOT EXISTS idx_links_target_block ON links(target_block_id);
            CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON aliases(normalized_alias);
            CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_normalized_name);
            ",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR REPLACE INTO schema_migrations(version, applied_at) VALUES (?1, ?2)",
            params![SCHEMA_VERSION, now_secs()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn parse_workspace_files(files: &[WorkspaceFile]) -> Result<Vec<ParsedDocument>, String> {
    files
        .iter()
        .map(|file| {
            let content = fs::read_to_string(&file.path)
                .map_err(|error| format!("Could not read {}: {error}", file.path))?;
            parse_file_with_content(file, content)
        })
        .collect()
}

fn parse_file_with_content(
    file: &WorkspaceFile,
    content: String,
) -> Result<ParsedDocument, String> {
    let normalized_content = content.replace("\r\n", "\n").replace('\r', "\n");
    let metadata = fs::metadata(&file.path).ok();
    let modified_ms = metadata
        .as_ref()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_ms);
    let (frontmatter, body_start) = parse_frontmatter(&normalized_content);
    let body = &normalized_content[body_start..];
    let title = title_for_document(&frontmatter, body, &file.name);
    let aliases = collect_aliases(&frontmatter);
    let tags = collect_tags(&frontmatter, body);
    let blocks = parse_blocks(&file.relative_path, body, body_start);
    let links = extract_links(&file.relative_path, body, &blocks);
    Ok(ParsedDocument {
        path: file.path.clone(),
        relative_path: file.relative_path.clone(),
        name: file.name.clone(),
        title,
        source_kind: source_kind_for_path(&file.relative_path).to_string(),
        byte_size: metadata
            .map(|metadata| metadata.len())
            .unwrap_or(file.byte_size),
        modified_ms,
        content_hash: hash_text(&normalized_content),
        frontmatter,
        aliases,
        tags,
        blocks,
        links,
        content: normalized_content,
    })
}

fn upsert_documents(
    connection: &mut Connection,
    mut documents: Vec<ParsedDocument>,
) -> Result<usize, String> {
    let resolver = Resolver::from_documents(&documents);
    for document in &mut documents {
        resolve_links_for_document(document, &resolver);
    }

    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut indexed_count = 0usize;
    for document in documents {
        let existing_hash = tx
            .query_row(
                "SELECT content_hash FROM documents WHERE id = ?1",
                params![document_id(&document.relative_path)],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if existing_hash.as_deref() == Some(document.content_hash.as_str()) {
            continue;
        }
        indexed_count += 1;
        upsert_document(&tx, &document)?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(indexed_count)
}

fn upsert_document(connection: &Connection, document: &ParsedDocument) -> Result<(), String> {
    let id = document_id(&document.relative_path);
    connection
        .execute(
            "INSERT INTO documents(id, path, relative_path, name, title, source_kind, byte_size, modified_ms, content_hash, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               path = excluded.path,
               relative_path = excluded.relative_path,
               name = excluded.name,
               title = excluded.title,
               source_kind = excluded.source_kind,
               byte_size = excluded.byte_size,
               modified_ms = excluded.modified_ms,
               content_hash = excluded.content_hash,
               indexed_at = excluded.indexed_at",
            params![
                id,
                document.path,
                document.relative_path,
                document.name,
                document.title,
                document.source_kind,
                document.byte_size as i64,
                document.modified_ms,
                document.content_hash,
                now_secs()
            ],
        )
        .map_err(|error| error.to_string())?;

    for table in ["frontmatter", "aliases", "blocks", "document_tags"] {
        connection
            .execute(
                &format!("DELETE FROM {table} WHERE document_id = ?1"),
                params![id],
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute("DELETE FROM links WHERE from_document_id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM document_fts WHERE document_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;

    for field in &document.frontmatter {
        connection
            .execute(
                "INSERT OR IGNORE INTO frontmatter(document_id, key, value) VALUES (?1, ?2, ?3)",
                params![id, field.key, field.value],
            )
            .map_err(|error| error.to_string())?;
    }
    for alias in &document.aliases {
        connection
            .execute(
                "INSERT INTO aliases(id, document_id, alias, normalized_alias) VALUES (?1, ?2, ?3, ?4)",
                params![stable_id("alias", &format!("{}:{alias}", document.relative_path)), id, alias, normalize_lookup_key(alias)],
            )
            .map_err(|error| error.to_string())?;
    }
    for block in &document.blocks {
        connection
            .execute(
                "INSERT INTO blocks(id, document_id, block_id, heading_path, content, line_start, line_end, content_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    block.stable_id,
                    id,
                    block.block_id,
                    block.heading_path,
                    block.content,
                    block.line_start as i64,
                    block.line_end as i64,
                    block.content_hash
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    for tag in &document.tags {
        let normalized = normalize_tag(tag);
        let tag_id = stable_id("tag", &normalized);
        let parent = normalized
            .rsplit_once('/')
            .map(|(parent, _)| parent.to_string());
        connection
            .execute(
                "INSERT INTO tags(id, name, normalized_name, parent_normalized_name)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, parent_normalized_name = excluded.parent_normalized_name",
                params![tag_id, tag, normalized, parent],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT OR IGNORE INTO document_tags(document_id, tag_id) VALUES (?1, ?2)",
                params![id, tag_id],
            )
            .map_err(|error| error.to_string())?;
    }
    for link in &document.links {
        connection
            .execute(
                "INSERT INTO links(id, from_document_id, from_block_id, target_raw, label, anchor, is_embed, is_block_reference, target_document_id, target_block_id, link_type)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    link.stable_id,
                    id,
                    link.from_block_id,
                    link.target_raw,
                    link.label,
                    link.anchor,
                    if link.is_embed { 1 } else { 0 },
                    if link.is_block_reference { 1 } else { 0 },
                    link.resolved_document_id,
                    link.resolved_block_id,
                    link.link_type,
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT INTO document_fts(document_id, title, content, tags, relative_path) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id,
                document.title,
                document.content,
                document.tags.join(" "),
                document.relative_path
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn remove_deleted_documents(
    connection: &mut Connection,
    known_paths: &HashSet<String>,
) -> Result<usize, String> {
    let existing = {
        let mut statement = connection
            .prepare("SELECT id, relative_path FROM documents")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut removed = 0usize;
    for (id, relative_path) in existing {
        if known_paths.contains(&relative_path) {
            continue;
        }
        removed += 1;
        for table in ["frontmatter", "aliases", "blocks", "document_tags"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE document_id = ?1"),
                params![id],
            )
            .map_err(|error| error.to_string())?;
        }
        tx.execute("DELETE FROM links WHERE from_document_id = ?1", params![id])
            .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM links WHERE target_document_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute(
            "DELETE FROM document_fts WHERE document_id = ?1",
            params![id],
        )
        .map_err(|error| error.to_string())?;
        tx.execute("DELETE FROM documents WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(removed)
}

fn resolve_all_links(connection: &mut Connection) -> Result<(), String> {
    let resolver = build_resolver(connection)?;
    let links = {
        let mut statement = connection
            .prepare("SELECT id, target_raw, anchor FROM links")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let tx = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (id, target_raw, anchor) in links {
        let resolved = resolver.resolve(&target_raw, anchor.as_deref());
        tx.execute(
            "UPDATE links SET target_document_id = ?1, target_block_id = ?2 WHERE id = ?3",
            params![resolved.document_id, resolved.block_id, id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())
}

fn count_documents(connection: &Connection) -> Result<usize, String> {
    connection
        .query_row("SELECT COUNT(*) FROM documents", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|count| count as usize)
        .map_err(|error| error.to_string())
}

fn load_resolver_targets(connection: &Connection) -> Result<Vec<LinkTarget>, String> {
    let mut statement = connection
        .prepare("SELECT id, relative_path, name, title FROM documents")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(LinkTarget {
                id: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                title: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_document_by_path(
    connection: &Connection,
    path: &str,
) -> Result<Option<IndexedDocument>, String> {
    let id = connection
        .query_row(
            "SELECT id FROM documents WHERE path = ?1",
            params![path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    id.map(|id| load_document_by_id(connection, &id))
        .transpose()
        .map(Option::flatten)
}

fn load_document_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<IndexedDocument>, String> {
    let mut document = connection
        .query_row(
            "SELECT id, path, relative_path, name, source_kind FROM documents WHERE id = ?1",
            params![id],
            |row| {
                Ok(IndexedDocument {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    relative_path: row.get(2)?,
                    name: row.get(3)?,
                    source_kind: row.get(4)?,
                    frontmatter: Vec::new(),
                    tags: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(document) = document.as_mut() else {
        return Ok(None);
    };
    document.frontmatter = load_frontmatter(connection, id)?;
    document.tags = load_tags(connection, id)?;
    Ok(Some(document.clone()))
}

fn load_frontmatter(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<FrontmatterField>, String> {
    let mut statement = connection
        .prepare("SELECT key, value FROM frontmatter WHERE document_id = ?1 ORDER BY key, value")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok(FrontmatterField {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_tags(connection: &Connection, document_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT t.name FROM tags t
             JOIN document_tags dt ON dt.tag_id = t.id
             WHERE dt.document_id = ?1
             ORDER BY t.normalized_name",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_links_for_document(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<IndexedLink>, String> {
    let mut statement = connection
        .prepare(
            "SELECT target_raw, label, anchor, is_block_reference, target_document_id
             FROM links WHERE from_document_id = ?1 ORDER BY target_raw",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok(IndexedLink {
                target_raw: row.get(0)?,
                label: row.get(1)?,
                anchor: row.get(2)?,
                is_block_reference: row.get::<_, i64>(3)? == 1,
                target_document_id: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_backlinks(connection: &Connection, document_id: &str) -> Result<Vec<Backlink>, String> {
    let mut statement = connection
        .prepare(
            "SELECT d.path, d.relative_path, d.name, d.source_kind, l.label
             FROM links l
             JOIN documents d ON d.id = l.from_document_id
             WHERE l.target_document_id = ?1
             ORDER BY d.relative_path",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![document_id], |row| {
            Ok(Backlink {
                path: row.get(0)?,
                relative_path: row.get(1)?,
                name: row.get(2)?,
                source_kind: row.get(3)?,
                label: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn to_knowledge_link(connection: &Connection, link: &IndexedLink) -> Result<KnowledgeLink, String> {
    let target = link
        .target_document_id
        .as_deref()
        .map(|id| load_document_by_id(connection, id))
        .transpose()?
        .flatten();
    Ok(KnowledgeLink {
        target: link.target_raw.clone(),
        label: link.label.clone(),
        anchor: link.anchor.clone(),
        is_block_reference: link.is_block_reference,
        resolved_path: target.as_ref().map(|item| item.path.clone()),
        resolved_relative_path: target.as_ref().map(|item| item.relative_path.clone()),
        resolved_name: target.as_ref().map(|item| item.name.clone()),
        source_kind: target.as_ref().map(|item| item.source_kind.clone()),
    })
}

fn indexed_link_from_parsed(link: &ParsedLink) -> IndexedLink {
    IndexedLink {
        target_raw: link.target_raw.clone(),
        label: link.label.clone(),
        anchor: link.anchor.clone(),
        is_block_reference: link.is_block_reference,
        target_document_id: link.resolved_document_id.clone(),
    }
}

#[derive(Default)]
struct Resolver {
    by_relative: HashMap<String, Vec<LinkTarget>>,
    by_without_ext: HashMap<String, Vec<LinkTarget>>,
    by_stem: HashMap<String, Vec<LinkTarget>>,
    by_title: HashMap<String, Vec<LinkTarget>>,
    by_alias: HashMap<String, Vec<LinkTarget>>,
    block_by_document_and_id: HashMap<(String, String), String>,
}

struct Resolved {
    document_id: Option<String>,
    block_id: Option<String>,
}

impl Resolver {
    fn from_documents(documents: &[ParsedDocument]) -> Self {
        let mut resolver = Self::default();
        for document in documents {
            let target = LinkTarget {
                id: document_id(&document.relative_path),
                relative_path: document.relative_path.clone(),
                name: document.name.clone(),
                title: document.title.clone(),
            };
            resolver.add_target(target, &document.aliases);
            for block in &document.blocks {
                if let Some(block_id) = &block.block_id {
                    resolver.block_by_document_and_id.insert(
                        (
                            document_id(&document.relative_path),
                            normalize_lookup_key(block_id),
                        ),
                        block.stable_id.clone(),
                    );
                }
            }
        }
        resolver
    }

    fn from_targets(targets: &[LinkTarget]) -> Self {
        let mut resolver = Self::default();
        for target in targets {
            resolver.add_target(target.clone(), &[]);
        }
        resolver
    }

    fn add_target(&mut self, target: LinkTarget, aliases: &[String]) {
        self.by_relative
            .entry(normalize_lookup_key(&target.relative_path))
            .or_default()
            .push(target.clone());
        self.by_without_ext
            .entry(strip_extension(&normalize_lookup_key(
                &target.relative_path,
            )))
            .or_default()
            .push(target.clone());
        self.by_stem
            .entry(strip_extension(&normalize_lookup_key(&target.name)))
            .or_default()
            .push(target.clone());
        if let Some(title) = &target.title {
            self.by_title
                .entry(normalize_lookup_key(title))
                .or_default()
                .push(target.clone());
        }
        for alias in aliases {
            self.by_alias
                .entry(normalize_lookup_key(alias))
                .or_default()
                .push(target.clone());
        }
    }

    fn resolve(&self, target: &str, anchor: Option<&str>) -> Resolved {
        let (target_without_anchor, parsed_anchor) = split_link_anchor(target);
        let anchor = anchor.or(parsed_anchor);
        let lookup = normalize_lookup_key(target_without_anchor);
        let document = self
            .single(&self.by_relative, &lookup)
            .or_else(|| self.single(&self.by_without_ext, &strip_extension(&lookup)))
            .or_else(|| self.single(&self.by_stem, &strip_extension(&lookup)))
            .or_else(|| self.single(&self.by_title, &lookup))
            .or_else(|| self.single(&self.by_alias, &lookup));
        let document_id = document.as_ref().map(|target| target.id.clone());
        let block_id = document_id.as_ref().and_then(|document_id| {
            anchor
                .map(|anchor| anchor.trim_start_matches('^'))
                .filter(|anchor| !anchor.is_empty())
                .and_then(|anchor| {
                    self.block_by_document_and_id
                        .get(&(document_id.clone(), normalize_lookup_key(anchor)))
                        .cloned()
                })
        });
        Resolved {
            document_id,
            block_id,
        }
    }

    fn single(&self, map: &HashMap<String, Vec<LinkTarget>>, key: &str) -> Option<LinkTarget> {
        map.get(key)
            .and_then(|targets| (targets.len() == 1).then(|| targets[0].clone()))
    }
}

fn build_resolver(connection: &Connection) -> Result<Resolver, String> {
    let targets = load_resolver_targets(connection)?;
    let mut resolver = Resolver::from_targets(&targets);
    let aliases = {
        let mut statement = connection
            .prepare("SELECT document_id, alias FROM aliases")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let target_by_id = targets
        .into_iter()
        .map(|target| (target.id.clone(), target))
        .collect::<HashMap<_, _>>();
    for (document_id, alias) in aliases {
        if let Some(target) = target_by_id.get(&document_id) {
            resolver
                .by_alias
                .entry(normalize_lookup_key(&alias))
                .or_default()
                .push(target.clone());
        }
    }
    let blocks = {
        let mut statement = connection
            .prepare("SELECT id, document_id, block_id FROM blocks WHERE block_id IS NOT NULL")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    for (block_row_id, document_id, block_id) in blocks {
        resolver
            .block_by_document_and_id
            .insert((document_id, normalize_lookup_key(&block_id)), block_row_id);
    }
    Ok(resolver)
}

fn resolve_links_for_document(document: &mut ParsedDocument, resolver: &Resolver) {
    for link in &mut document.links {
        let resolved = resolver.resolve(&link.target_raw, link.anchor.as_deref());
        link.resolved_document_id = resolved.document_id;
        link.resolved_block_id = resolved.block_id;
    }
}

fn parse_frontmatter(content: &str) -> (Vec<FrontmatterField>, usize) {
    if !content.starts_with("---\n") {
        return (Vec::new(), 0);
    }
    let mut offset = 4usize;
    let mut fields = Vec::new();
    let mut current_key = String::new();
    let mut current_value = Vec::new();
    for line in content[4..].lines() {
        let line_with_break = line.len() + 1;
        if line.trim() == "---" {
            if !current_key.is_empty() {
                fields.push(FrontmatterField {
                    key: current_key.clone(),
                    value: current_value.join("\n").trim().to_string(),
                });
            }
            return (
                normalize_frontmatter_fields(fields),
                offset + line_with_break,
            );
        }
        if let Some(rest) = line.strip_prefix("- ") {
            if !current_key.is_empty() {
                current_value.push(rest.trim().to_string());
            }
        } else if let Some((key, value)) = line.split_once(':') {
            if !current_key.is_empty() {
                fields.push(FrontmatterField {
                    key: current_key.clone(),
                    value: current_value.join("\n").trim().to_string(),
                });
            }
            current_key = key.trim().to_string();
            current_value = vec![value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()];
        }
        offset += line_with_break;
    }
    (Vec::new(), 0)
}

fn normalize_frontmatter_fields(fields: Vec<FrontmatterField>) -> Vec<FrontmatterField> {
    fields
        .into_iter()
        .filter(|field| !field.key.trim().is_empty() && !field.value.trim().is_empty())
        .collect()
}

fn title_for_document(frontmatter: &[FrontmatterField], body: &str, name: &str) -> Option<String> {
    frontmatter
        .iter()
        .find(|field| field.key.eq_ignore_ascii_case("title"))
        .map(|field| field.value.clone())
        .or_else(|| {
            body.lines().find_map(|line| {
                line.trim()
                    .strip_prefix("# ")
                    .map(|value| value.trim().to_string())
            })
        })
        .or_else(|| name.rsplit_once('.').map(|(stem, _)| stem.to_string()))
}

fn collect_aliases(frontmatter: &[FrontmatterField]) -> Vec<String> {
    let mut aliases = BTreeMap::new();
    for field in frontmatter {
        if matches!(
            field.key.to_ascii_lowercase().as_str(),
            "alias" | "aliases" | "aka"
        ) {
            for value in split_list_values(&field.value) {
                let normalized = normalize_lookup_key(&value);
                if !normalized.is_empty() {
                    aliases.entry(normalized).or_insert(value);
                }
            }
        }
    }
    aliases.into_values().collect()
}

fn collect_tags(frontmatter: &[FrontmatterField], body: &str) -> Vec<String> {
    let mut tags = BTreeMap::<String, String>::new();
    for field in frontmatter {
        if field.key.eq_ignore_ascii_case("tags") {
            for value in split_list_values(&field.value) {
                let normalized = normalize_tag(&value);
                if !normalized.is_empty() {
                    tags.entry(normalized.clone())
                        .or_insert(value.trim_start_matches('#').to_string());
                }
            }
        }
    }
    for tag in extract_inline_tags(body) {
        let normalized = normalize_tag(&tag);
        if !normalized.is_empty() {
            tags.entry(normalized).or_insert(tag);
        }
    }
    tags.into_values().collect()
}

fn split_list_values(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed[1..trimmed.len() - 1]
            .split(',')
            .map(clean_list_value)
            .filter(|value| !value.is_empty())
            .collect();
    }
    trimmed
        .split('\n')
        .flat_map(|line| line.split(','))
        .map(clean_list_value)
        .filter(|value| !value.is_empty())
        .collect()
}

fn clean_list_value(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("- ")
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    for token in body.split_whitespace() {
        if let Some(tag) = token.strip_prefix('#') {
            let cleaned = tag.trim_matches(|character: char| {
                !character.is_alphanumeric() && !matches!(character, '-' | '_' | '/')
            });
            if !cleaned.is_empty() {
                tags.insert(cleaned.to_string());
            }
        }
    }
    let mut values = tags.into_iter().collect::<Vec<_>>();
    values.sort_by_key(|value| value.to_ascii_lowercase());
    values
}

fn parse_blocks(relative_path: &str, body: &str, body_start: usize) -> Vec<ParsedBlock> {
    let mut blocks = Vec::new();
    let mut heading_stack: Vec<(usize, String)> = Vec::new();
    let mut current = Vec::new();
    let mut current_start = 1usize;
    let mut byte_offset = body_start;
    for (line_index, line) in body.lines().enumerate() {
        let line_number = line_index + 1;
        if let Some((level, heading)) = parse_heading(line) {
            flush_block(
                relative_path,
                &mut blocks,
                &mut current,
                current_start,
                line_number.saturating_sub(1),
                &heading_stack,
            );
            heading_stack.retain(|(existing, _)| *existing < level);
            heading_stack.push((level, heading));
            current_start = line_number;
            current.push(line.to_string());
        } else if line.trim().is_empty() {
            flush_block(
                relative_path,
                &mut blocks,
                &mut current,
                current_start,
                line_number.saturating_sub(1),
                &heading_stack,
            );
            current_start = line_number + 1;
        } else {
            if current.is_empty() {
                current_start = line_number;
            }
            current.push(line.to_string());
        }
        byte_offset += line.len() + 1;
    }
    let end_line = body.lines().count();
    flush_block(
        relative_path,
        &mut blocks,
        &mut current,
        current_start,
        end_line,
        &heading_stack,
    );
    if blocks.is_empty() && !body.trim().is_empty() {
        let content = body.trim().to_string();
        blocks.push(make_block(
            relative_path,
            1,
            end_line.max(1),
            None,
            content,
            &[],
        ));
    }
    let _ = byte_offset;
    blocks
}

fn parse_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let level = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&level) || !trimmed[level..].starts_with(' ') {
        return None;
    }
    Some((level, trimmed[level..].trim().to_string()))
}

fn flush_block(
    relative_path: &str,
    blocks: &mut Vec<ParsedBlock>,
    current: &mut Vec<String>,
    line_start: usize,
    line_end: usize,
    heading_stack: &[(usize, String)],
) {
    if current.is_empty() {
        return;
    }
    let content = current.join("\n");
    if !content.trim().is_empty() {
        blocks.push(make_block(
            relative_path,
            line_start,
            line_end.max(line_start),
            explicit_block_id(&content),
            content,
            heading_stack,
        ));
    }
    current.clear();
}

fn make_block(
    relative_path: &str,
    line_start: usize,
    line_end: usize,
    block_id: Option<String>,
    content: String,
    heading_stack: &[(usize, String)],
) -> ParsedBlock {
    let content_hash = hash_text(&content);
    ParsedBlock {
        stable_id: stable_id(
            "block",
            &format!("{relative_path}:{line_start}:{content_hash}"),
        ),
        block_id,
        heading_path: (!heading_stack.is_empty()).then(|| {
            heading_stack
                .iter()
                .map(|(_, heading)| heading.clone())
                .collect::<Vec<_>>()
                .join(" / ")
        }),
        content,
        line_start,
        line_end,
        content_hash,
    }
}

fn explicit_block_id(content: &str) -> Option<String> {
    content.split_whitespace().find_map(|token| {
        token
            .strip_prefix('^')
            .map(|value| {
                value.trim_matches(|character: char| {
                    !character.is_alphanumeric() && !matches!(character, '-' | '_')
                })
            })
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn extract_links(relative_path: &str, body: &str, blocks: &[ParsedBlock]) -> Vec<ParsedLink> {
    let mut links = Vec::new();
    let mut start = 0usize;
    while let Some(open) = body[start..].find("[[") {
        let absolute_open = start + open;
        let begin = absolute_open + 2;
        let Some(close) = body[begin..].find("]]") else {
            break;
        };
        let end = begin + close;
        let raw = body[begin..end].trim();
        if !raw.is_empty() {
            let is_embed = absolute_open > 0 && body.as_bytes()[absolute_open - 1] == b'!';
            let (target, label) = if let Some((target, label)) = raw.split_once('|') {
                (target.trim().to_string(), label.trim().to_string())
            } else {
                (raw.to_string(), raw.to_string())
            };
            let (_, anchor) = split_link_anchor(&target);
            let line_number = body[..absolute_open]
                .bytes()
                .filter(|byte| *byte == b'\n')
                .count()
                + 1;
            let from_block_id = blocks
                .iter()
                .find(|block| line_number >= block.line_start && line_number <= block.line_end)
                .map(|block| block.stable_id.clone());
            links.push(ParsedLink {
                stable_id: stable_id("link", &format!("{relative_path}:{absolute_open}:{raw}")),
                from_block_id,
                target_raw: target.clone(),
                label: if label.is_empty() {
                    target.clone()
                } else {
                    label
                },
                anchor: anchor.map(ToOwned::to_owned),
                is_embed,
                is_block_reference: anchor
                    .map(|value| value.trim_start_matches('#').starts_with('^'))
                    .unwrap_or(false),
                link_type: "wiki".to_string(),
                resolved_document_id: None,
                resolved_block_id: None,
            });
        }
        start = end + 2;
    }
    links
}

#[derive(Default)]
struct ParsedSearchQuery {
    content_terms: Vec<String>,
    tag_filters: Vec<String>,
    path_filters: Vec<String>,
    block_filters: Vec<String>,
}

fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let mut parsed = ParsedSearchQuery::default();
    for token in query.split_whitespace() {
        if let Some(path_filter) = token
            .strip_prefix("path:")
            .filter(|value| !value.is_empty())
        {
            parsed.path_filters.push(path_filter.to_ascii_lowercase());
        } else if let Some(block_filter) = token
            .strip_prefix("block:")
            .filter(|value| !value.is_empty())
        {
            parsed
                .block_filters
                .push(block_filter.trim_start_matches('^').to_ascii_lowercase());
        } else if token.starts_with('#') && token.len() > 1 {
            parsed
                .tag_filters
                .push(normalize_tag(token).to_ascii_lowercase());
        } else {
            parsed.content_terms.push(token.to_ascii_lowercase());
        }
    }
    parsed
}

fn candidate_document_ids(
    connection: &Connection,
    query: &ParsedSearchQuery,
) -> Result<Vec<String>, String> {
    if query.content_terms.is_empty() {
        let mut statement = connection
            .prepare("SELECT id FROM documents ORDER BY relative_path")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        return rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string());
    }
    let fts_query = query
        .content_terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut statement = connection
        .prepare(
            "SELECT document_id FROM document_fts
             WHERE document_fts MATCH ?1
             ORDER BY rank",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![fts_query], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let mut ids = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    for id in substring_candidate_document_ids(connection, &query.content_terms)? {
        if !ids.iter().any(|candidate| candidate == &id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn substring_candidate_document_ids(
    connection: &Connection,
    content_terms: &[String],
) -> Result<Vec<String>, String> {
    if content_terms.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("SELECT document_id, title, content, tags, relative_path FROM document_fts ORDER BY relative_path")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, title, content, tags, relative_path) = row.map_err(|error| error.to_string())?;
        let haystack = format!("{title}\n{content}\n{tags}\n{relative_path}").to_ascii_lowercase();
        if content_terms.iter().all(|term| haystack.contains(term)) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn document_has_block(
    connection: &Connection,
    document_id: &str,
    block: &str,
) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM blocks WHERE document_id = ?1 AND LOWER(block_id) = ?2",
            params![document_id, block],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|error| error.to_string())
}

fn collect_line_matches(
    document: &IndexedDocument,
    content: &str,
    content_terms: &[String],
    max_results: usize,
    matches: &mut Vec<SearchMatch>,
) {
    if content_terms.is_empty() {
        matches.push(SearchMatch {
            path: document.path.clone(),
            relative_path: document.relative_path.clone(),
            line_number: 1,
            line_text: content
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(240)
                .collect(),
            match_start: 0,
            match_end: 0,
        });
        return;
    }
    for (line_index, line) in content.lines().enumerate() {
        let haystack = line.to_ascii_lowercase();
        if content_terms.iter().all(|term| haystack.contains(term)) {
            let match_start = content_terms
                .first()
                .and_then(|term| haystack.find(term))
                .unwrap_or(0);
            matches.push(SearchMatch {
                path: document.path.clone(),
                relative_path: document.relative_path.clone(),
                line_number: line_index + 1,
                line_text: line.chars().take(240).collect(),
                match_start,
                match_end: match_start + content_terms.first().map(|term| term.len()).unwrap_or(0),
            });
            if matches.len() >= max_results {
                break;
            }
        }
    }
}

fn push_context_item(
    root: &Path,
    items: &mut Vec<QueryContextItem>,
    seen: &mut HashSet<String>,
    path: &str,
    reason: &str,
) -> Result<(), String> {
    if !seen.insert(path.to_string()) {
        return Ok(());
    }
    let content =
        fs::read_to_string(path).map_err(|error| format!("Could not read {path}: {error}"))?;
    let path_buf = PathBuf::from(path);
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled")
        .to_string();
    let relative_path = path_buf
        .strip_prefix(root)
        .unwrap_or(&path_buf)
        .to_string_lossy()
        .to_string();
    let source_kind = source_kind_for_path(&relative_path).to_string();
    items.push(QueryContextItem {
        path: path.to_string(),
        relative_path,
        name,
        source_kind,
        reason: reason.to_string(),
        excerpt: excerpt_for_content(&content),
    });
    Ok(())
}

fn excerpt_for_content(content: &str) -> String {
    content
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(280)
        .collect()
}

fn document_id(relative_path: &str) -> String {
    stable_id("document", &normalize_lookup_key(relative_path))
}

fn stable_id(namespace: &str, value: &str) -> String {
    format!("{namespace}-{}", hash_text(value))
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn normalize_lookup_key(value: &str) -> String {
    // NFC-normalize so a typed `[[café]]` (NFC) matches a macOS filename (NFD) whose
    // bytes differ but render identically. Without this, links to files with accented
    // or CJK-adjacent characters silently fail to resolve.
    value
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim()
        .to_ascii_lowercase()
        .nfc()
        .collect()
}

fn normalize_tag(value: &str) -> String {
    value
        .trim()
        .trim_start_matches('#')
        .to_ascii_lowercase()
        .nfc()
        .collect()
}

fn split_link_anchor(target: &str) -> (&str, Option<&str>) {
    target
        .split_once('#')
        .map(|(path, anchor)| (path.trim(), Some(anchor.trim().trim_start_matches('^'))))
        .unwrap_or((target.trim(), None))
}

fn strip_extension(value: &str) -> String {
    let path = Path::new(value);
    if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
        let parent = path
            .parent()
            .and_then(|parent| parent.to_str())
            .unwrap_or("");
        if parent.is_empty() {
            stem.to_string()
        } else {
            format!("{parent}/{stem}")
        }
    } else {
        value.to_string()
    }
}

fn source_kind_for_path(relative_path: &str) -> &'static str {
    if relative_path.starts_with("wiki/") {
        "wiki"
    } else if relative_path.starts_with("sources/") {
        "source"
    } else {
        "note"
    }
}

fn system_time_ms(value: SystemTime) -> Option<i64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::{normalize_lookup_key, normalize_tag};

    #[test]
    fn lookup_key_matches_across_unicode_forms() {
        // "café" written as NFC (é = U+00E9) and NFD (e + U+0301 combining accent).
        let nfc = "café";
        let nfd = "cafe\u{0301}";
        assert_ne!(nfc, nfd, "the two forms must differ byte-wise");
        assert_eq!(normalize_lookup_key(nfc), normalize_lookup_key(nfd));
        assert_eq!(normalize_tag(nfc), normalize_tag(nfd));
    }
}
