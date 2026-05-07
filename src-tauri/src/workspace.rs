use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize, Serializer};
use serde_json::{json, Value};

const MAX_WORKSPACE_FILES: usize = 5000;
pub(crate) const MAX_SEARCH_RESULTS: usize = 200;
const DEFAULT_AGENTS_MD: &str = r#"# LMD Knowledge Workspace Rules

## Purpose

Maintain a durable Markdown wiki for this local workspace.

## Source Of Truth

- `sources/` contains raw source material.
- `notes/` contains user-authored notes and drafts.
- `wiki/` contains durable knowledge pages maintained with review.

Do not silently rewrite source material. Prefer creating or updating pages in `wiki/`.

## Required Pages

- `wiki/index.md` is the main knowledge entry point.
- `wiki/log.md` records meaningful ingest and maintenance activity.

## Linking

- Prefer standard Markdown links or `[[Wiki Links]]` where supported by the editor workflow.
- Keep page titles specific and stable.
- Link new wiki pages from `wiki/index.md` when they represent durable knowledge.

## Review

- Treat LLM output as draft material unless the user explicitly approves a direct save.
- Preserve user-authored notes as first-class content.
"#;
const DEFAULT_INDEX_MD: &str = r#"# Knowledge Index

This workspace is ready for a local knowledge workflow.

## Areas

- [Inbox](inbox/)
- [Concepts](concepts/)
- [Entities](entities/)
- [Syntheses](syntheses/)
- [Source Pages](sources/)

## Notes

Add durable topic pages here as the wiki grows.
"#;
const DEFAULT_LOG_MD: &str = r#"# Knowledge Log

- Workspace initialized.
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceFile {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) name: String,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workspace {
    pub(crate) root_path: String,
    pub(crate) files: Vec<WorkspaceFile>,
    pub(crate) knowledge: WorkspaceKnowledge,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchMatch {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) line_number: usize,
    pub(crate) line_text: String,
    pub(crate) match_start: usize,
    pub(crate) match_end: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TagRenameResult {
    pub(crate) files_changed: usize,
    pub(crate) replacements: usize,
}

#[derive(Debug)]
pub(crate) struct WorkspaceKnowledge {
    pub(crate) is_initialized: bool,
    pub(crate) notes_path: String,
    pub(crate) sources_path: String,
    pub(crate) wiki_path: String,
    pub(crate) schema_path: String,
    pub(crate) manifest_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FrontmatterField {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeLink {
    pub(crate) target: String,
    pub(crate) label: String,
    pub(crate) anchor: Option<String>,
    pub(crate) is_block_reference: bool,
    pub(crate) resolved_path: Option<String>,
    pub(crate) resolved_relative_path: Option<String>,
    pub(crate) resolved_name: Option<String>,
    pub(crate) source_kind: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Backlink {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) name: String,
    pub(crate) source_kind: String,
    pub(crate) label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentKnowledge {
    pub(crate) current_path: String,
    pub(crate) current_relative_path: String,
    pub(crate) frontmatter: Vec<FrontmatterField>,
    pub(crate) tags: Vec<String>,
    pub(crate) outgoing_links: Vec<KnowledgeLink>,
    pub(crate) backlinks: Vec<Backlink>,
    pub(crate) unresolved_links: Vec<KnowledgeLink>,
    pub(crate) related_wiki_pages: Vec<Backlink>,
    pub(crate) source_references: Vec<Backlink>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeLintIssue {
    pub(crate) kind: String,
    pub(crate) severity: String,
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeLintReport {
    pub(crate) issues: Vec<KnowledgeLintIssue>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryContextItem {
    pub(crate) path: String,
    pub(crate) relative_path: String,
    pub(crate) name: String,
    pub(crate) source_kind: String,
    pub(crate) reason: String,
    pub(crate) excerpt: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QueryContext {
    pub(crate) current_path: String,
    pub(crate) current_relative_path: String,
    pub(crate) items: Vec<QueryContextItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantDraft {
    pub(crate) title: String,
    pub(crate) content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct IndexedDocument {
    path: String,
    relative_path: String,
    name: String,
    source_kind: String,
    frontmatter: Vec<FrontmatterField>,
    tags: Vec<String>,
    links: Vec<ResolvedLink>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndexSnapshot {
    generated_at: String,
    document_count: usize,
    documents: Vec<IndexedDocument>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ResolvedLink {
    target: String,
    label: String,
    anchor: Option<String>,
    is_block_reference: bool,
    resolved_path: Option<String>,
    resolved_relative_path: Option<String>,
    resolved_name: Option<String>,
    source_kind: Option<String>,
}

impl Serialize for WorkspaceKnowledge {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct WorkspaceKnowledgeView<'a> {
            is_initialized: bool,
            notes_path: &'a str,
            sources_path: &'a str,
            wiki_path: &'a str,
            schema_path: &'a str,
            manifest_path: &'a str,
        }

        WorkspaceKnowledgeView {
            is_initialized: self.is_initialized,
            notes_path: &self.notes_path,
            sources_path: &self.sources_path,
            wiki_path: &self.wiki_path,
            schema_path: &self.schema_path,
            manifest_path: &self.manifest_path,
        }
        .serialize(serializer)
    }
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "txt"
            )
        })
        .unwrap_or(false)
}

fn should_skip_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            name.starts_with('.')
                || matches!(
                    name,
                    "node_modules" | "target" | "dist" | "build" | ".git" | ".superpowers"
                )
        })
        .unwrap_or(false)
}

pub(crate) fn scan_workspace(root: &Path) -> Result<Vec<WorkspaceFile>, String> {
    let mut files = Vec::new();
    let mut pending = VecDeque::from([root.to_path_buf()]);

    while let Some(dir) = pending.pop_front() {
        let entries = fs::read_dir(&dir)
            .map_err(|error| format!("Could not read directory {}: {error}", dir.display()))?;

        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

            if file_type.is_dir() {
                if !should_skip_dir(&path) {
                    pending.push_back(path);
                }
                continue;
            }

            if !file_type.is_file() || !is_markdown_path(&path) {
                continue;
            }

            let metadata = entry
                .metadata()
                .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled")
                .to_string();

            files.push(WorkspaceFile {
                path: path.to_string_lossy().to_string(),
                relative_path,
                name,
                byte_size: metadata.len(),
            });

            if files.len() >= MAX_WORKSPACE_FILES {
                break;
            }
        }

        if files.len() >= MAX_WORKSPACE_FILES {
            break;
        }
    }

    files.sort_by(|left, right| {
        left.relative_path
            .to_ascii_lowercase()
            .cmp(&right.relative_path.to_ascii_lowercase())
    });
    Ok(files)
}

pub(crate) fn document_knowledge(
    root: &Path,
    current_path: &Path,
    current_content: Option<&str>,
) -> Result<DocumentKnowledge, String> {
    let files = scan_workspace(root)?;
    let indexed = if current_content.is_some() {
        index_workspace_documents(&files, current_path, current_content)?
    } else {
        load_or_build_index_cache(root, &files)?
    };
    let current_key = current_path.to_string_lossy().to_string();

    let current = indexed
        .iter()
        .find(|document| document.path == current_key)
        .ok_or_else(|| {
            format!(
                "Current document is not inside workspace: {}",
                current_path.display()
            )
        })?;

    let backlinks = collect_backlinks(&indexed, &current.path);
    let unresolved_links = current
        .links
        .iter()
        .filter(|link| link.resolved_path.is_none())
        .map(to_knowledge_link)
        .collect::<Vec<_>>();
    let outgoing_links = current
        .links
        .iter()
        .map(to_knowledge_link)
        .collect::<Vec<_>>();
    let related_wiki_pages = backlinks
        .iter()
        .filter(|link| link.source_kind == "wiki")
        .cloned()
        .collect::<Vec<_>>();
    let mut source_references = current
        .links
        .iter()
        .filter(|link| link.source_kind.as_deref() == Some("source"))
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
    source_references.sort_by(|left, right| {
        left.relative_path
            .to_ascii_lowercase()
            .cmp(&right.relative_path.to_ascii_lowercase())
    });
    source_references.dedup_by(|left, right| left.path == right.path);

    Ok(DocumentKnowledge {
        current_path: current.path.clone(),
        current_relative_path: current.relative_path.clone(),
        frontmatter: current.frontmatter.clone(),
        tags: current.tags.clone(),
        outgoing_links,
        backlinks,
        unresolved_links,
        related_wiki_pages,
        source_references,
    })
}

pub(crate) fn knowledge_lint_report(root: &Path) -> Result<KnowledgeLintReport, String> {
    let files = scan_workspace(root)?;
    let indexed = load_or_build_index_cache(root, &files)?;
    let index_path = root.join("wiki/index.md").to_string_lossy().to_string();
    let linked_from_index = indexed
        .iter()
        .find(|document| document.path == index_path)
        .map(|document| {
            document
                .links
                .iter()
                .filter_map(|link| link.resolved_path.clone())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut issues = Vec::new();

    for document in &indexed {
        for link in &document.links {
            if link.resolved_path.is_none() {
                issues.push(KnowledgeLintIssue {
                    kind: "unresolved_link".to_string(),
                    severity: "warning".to_string(),
                    path: document.path.clone(),
                    relative_path: document.relative_path.clone(),
                    message: format!("Unresolved link: {}", link.target),
                });
            }
        }
    }

    for document in &indexed {
        if document.source_kind != "wiki" {
            continue;
        }

        if matches!(
            document.relative_path.as_str(),
            "wiki/index.md" | "wiki/log.md"
        ) {
            continue;
        }

        let has_backlinks = indexed.iter().any(|candidate| {
            candidate
                .links
                .iter()
                .any(|link| link.resolved_path.as_deref() == Some(document.path.as_str()))
        });
        if !has_backlinks {
            issues.push(KnowledgeLintIssue {
                kind: "orphan_wiki_page".to_string(),
                severity: "warning".to_string(),
                path: document.path.clone(),
                relative_path: document.relative_path.clone(),
                message: "Wiki page has no backlinks.".to_string(),
            });
        }

        if !linked_from_index.contains(&document.path) {
            issues.push(KnowledgeLintIssue {
                kind: "not_in_index".to_string(),
                severity: "info".to_string(),
                path: document.path.clone(),
                relative_path: document.relative_path.clone(),
                message: "Wiki page is not linked from wiki/index.md.".to_string(),
            });
        }
    }

    issues.sort_by(|left, right| {
        left.relative_path
            .to_ascii_lowercase()
            .cmp(&right.relative_path.to_ascii_lowercase())
            .then_with(|| left.kind.cmp(&right.kind))
    });

    Ok(KnowledgeLintReport { issues })
}

pub(crate) fn query_context(
    root: &Path,
    current_path: &Path,
    current_content: Option<&str>,
) -> Result<QueryContext, String> {
    let files = scan_workspace(root)?;
    let indexed = if current_content.is_some() {
        index_workspace_documents(&files, current_path, current_content)?
    } else {
        load_or_build_index_cache(root, &files)?
    };
    let current_key = current_path.to_string_lossy().to_string();
    let current = indexed
        .iter()
        .find(|document| document.path == current_key)
        .ok_or_else(|| {
            format!(
                "Current document is not inside workspace: {}",
                current_path.display()
            )
        })?;
    let current_text = match current_content {
        Some(content) => content.to_string(),
        None => fs::read_to_string(current_path)
            .map_err(|error| format!("Could not read {}: {error}", current_path.display()))?,
    };

    let mut items = vec![QueryContextItem {
        path: current.path.clone(),
        relative_path: current.relative_path.clone(),
        name: current.name.clone(),
        source_kind: current.source_kind.clone(),
        reason: "current_document".to_string(),
        excerpt: excerpt_for_content(&current_text),
    }];

    let mut seen = HashSet::from([current.path.clone()]);
    for (reason, allowed_kind) in [
        ("linked_wiki", Some("wiki")),
        ("source_reference", Some("source")),
        ("backlink", None),
        ("index_hint", Some("wiki")),
    ] {
        for item in
            collect_context_candidates(root, &indexed, current, reason, allowed_kind, &mut seen)?
        {
            items.push(item);
        }
    }

    Ok(QueryContext {
        current_path: current.path.clone(),
        current_relative_path: current.relative_path.clone(),
        items,
    })
}

pub(crate) fn save_wiki_draft(root: &Path, title: &str, content: &str) -> Result<String, String> {
    let file_name = format!("{}.md", draft_file_stem(title));
    let inbox_path = root.join("wiki/inbox");
    fs::create_dir_all(&inbox_path)
        .map_err(|error| format!("Could not create {}: {error}", inbox_path.display()))?;
    let target_path = inbox_path.join(file_name);
    let draft_content = format_wiki_draft(title, content);
    fs::write(&target_path, draft_content)
        .map_err(|error| format!("Could not write {}: {error}", target_path.display()))?;
    append_to_knowledge_log(root, &target_path)?;
    ensure_inbox_entry_in_index(root, &target_path)?;
    Ok(target_path.to_string_lossy().to_string())
}

pub(crate) fn inspect_workspace(root: &Path) -> WorkspaceKnowledge {
    let notes_path = root.join("notes");
    let sources_path = root.join("sources");
    let wiki_path = root.join("wiki");
    let schema_path = root.join("AGENTS.md");
    let manifest_path = root.join(".lmd/knowledge/manifest.json");
    let index_path = wiki_path.join("index.md");
    let log_path = wiki_path.join("log.md");

    let is_initialized = notes_path.is_dir()
        && sources_path.is_dir()
        && wiki_path.is_dir()
        && schema_path.is_file()
        && manifest_path.is_file()
        && index_path.is_file()
        && log_path.is_file();

    WorkspaceKnowledge {
        is_initialized,
        notes_path: notes_path.to_string_lossy().to_string(),
        sources_path: sources_path.to_string_lossy().to_string(),
        wiki_path: wiki_path.to_string_lossy().to_string(),
        schema_path: schema_path.to_string_lossy().to_string(),
        manifest_path: manifest_path.to_string_lossy().to_string(),
    }
}

pub(crate) fn load_workspace(root: &Path) -> Result<Workspace, String> {
    let files = scan_workspace(root)?;
    let knowledge = inspect_workspace(root);

    if knowledge.is_initialized {
        write_knowledge_index_cache(root, &files)?;
    }

    Ok(Workspace {
        root_path: root.to_string_lossy().to_string(),
        files,
        knowledge,
    })
}

pub(crate) fn initialize_knowledge_workspace(root: &Path) -> Result<Workspace, String> {
    fs::create_dir_all(root).map_err(|error| {
        format!(
            "Could not create workspace root {}: {error}",
            root.display()
        )
    })?;

    let notes_path = root.join("notes");
    let sources_path = root.join("sources");
    let wiki_path = root.join("wiki");
    let inbox_path = wiki_path.join("inbox");
    let entities_path = wiki_path.join("entities");
    let concepts_path = wiki_path.join("concepts");
    let syntheses_path = wiki_path.join("syntheses");
    let wiki_sources_path = wiki_path.join("sources");
    let knowledge_path = root.join(".lmd/knowledge");
    let cache_path = knowledge_path.join("cache");
    let tasks_path = knowledge_path.join("tasks");
    let schema_path = root.join("AGENTS.md");
    let manifest_path = knowledge_path.join("manifest.json");
    let index_path = wiki_path.join("index.md");
    let log_path = wiki_path.join("log.md");

    for directory in [
        &notes_path,
        &sources_path,
        &wiki_path,
        &inbox_path,
        &entities_path,
        &concepts_path,
        &syntheses_path,
        &wiki_sources_path,
        &knowledge_path,
        &cache_path,
        &tasks_path,
    ] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    }

    write_if_missing(&schema_path, DEFAULT_AGENTS_MD)?;
    write_if_missing(&index_path, DEFAULT_INDEX_MD)?;
    write_if_missing(&log_path, DEFAULT_LOG_MD)?;

    if !manifest_path.exists() {
        let manifest = default_manifest(root, &schema_path);
        let manifest_text = serde_json::to_string_pretty(&manifest).map_err(|error| {
            format!(
                "Could not encode manifest {}: {error}",
                manifest_path.display()
            )
        })?;
        fs::write(&manifest_path, format!("{manifest_text}\n"))
            .map_err(|error| format!("Could not write {}: {error}", manifest_path.display()))?;
    }

    load_workspace(root)
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    fs::write(path, content).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn default_manifest(root: &Path, schema_path: &Path) -> Value {
    json!({
        "workspaceRoot": root.to_string_lossy().to_string(),
        "schemaPath": schema_path.to_string_lossy().to_string(),
        "lastIndexedAt": Value::Null,
        "lastIngestAt": Value::Null,
        "lastQueryAt": Value::Null,
        "lastLintAt": Value::Null,
        "lastCompileStatus": "idle",
        "integrationMode": "external_command",
        "indexVersion": 1
    })
}

fn write_knowledge_index_cache(root: &Path, files: &[WorkspaceFile]) -> Result<(), String> {
    let indexed = index_workspace_documents(files, &root.join("__lmd_none__.md"), None)?;
    write_index_snapshot(root, indexed)
}

fn write_index_snapshot(root: &Path, indexed: Vec<IndexedDocument>) -> Result<(), String> {
    let snapshot = KnowledgeIndexSnapshot {
        generated_at: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        ),
        document_count: indexed.len(),
        documents: indexed,
    };
    let cache_path = root.join(".lmd/knowledge/index.json");
    if let Some(parent) = cache_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("Could not encode {}: {error}", cache_path.display()))?;
    fs::write(&cache_path, format!("{json}\n"))
        .map_err(|error| format!("Could not write {}: {error}", cache_path.display()))
}

fn load_or_build_index_cache(
    root: &Path,
    files: &[WorkspaceFile],
) -> Result<Vec<IndexedDocument>, String> {
    if let Some(indexed) = load_knowledge_index_cache(root)? {
        return Ok(indexed);
    }

    let indexed = index_workspace_documents(files, &root.join("__lmd_none__.md"), None)?;
    write_index_snapshot(root, indexed.clone())?;
    Ok(indexed)
}

fn load_knowledge_index_cache(root: &Path) -> Result<Option<Vec<IndexedDocument>>, String> {
    let cache_path = root.join(".lmd/knowledge/index.json");
    if !cache_path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&cache_path)
        .map_err(|error| format!("Could not read {}: {error}", cache_path.display()))?;
    let snapshot = serde_json::from_str::<KnowledgeIndexSnapshot>(&raw)
        .map_err(|error| format!("Could not decode {}: {error}", cache_path.display()))?;
    Ok(Some(snapshot.documents))
}

fn collect_context_candidates(
    root: &Path,
    indexed: &[IndexedDocument],
    current: &IndexedDocument,
    reason: &str,
    allowed_kind: Option<&str>,
    seen: &mut HashSet<String>,
) -> Result<Vec<QueryContextItem>, String> {
    let current_backlinks = collect_backlinks(indexed, &current.path);
    let mut candidates = Vec::new();

    match reason {
        "linked_wiki" | "source_reference" => {
            for link in &current.links {
                let Some(path) = &link.resolved_path else {
                    continue;
                };
                if seen.contains(path) {
                    continue;
                }
                if let Some(kind) = allowed_kind {
                    if link.source_kind.as_deref() != Some(kind) {
                        continue;
                    }
                }
                if let Some(document) = indexed.iter().find(|document| document.path == *path) {
                    candidates.push(build_query_context_item(root, document, reason)?);
                    seen.insert(path.clone());
                }
            }
        }
        "backlink" => {
            for backlink in current_backlinks {
                if seen.contains(&backlink.path) {
                    continue;
                }
                if let Some(document) = indexed
                    .iter()
                    .find(|document| document.path == backlink.path)
                {
                    candidates.push(build_query_context_item(root, document, reason)?);
                    seen.insert(backlink.path);
                }
            }
        }
        "index_hint" => {
            let index_path = root.join("wiki/index.md").to_string_lossy().to_string();
            if !seen.contains(&index_path) {
                if let Some(document) = indexed.iter().find(|document| document.path == index_path)
                {
                    candidates.push(build_query_context_item(root, document, reason)?);
                    seen.insert(index_path);
                }
            }
        }
        _ => {}
    }

    Ok(candidates)
}

fn build_query_context_item(
    _root: &Path,
    document: &IndexedDocument,
    reason: &str,
) -> Result<QueryContextItem, String> {
    let content = fs::read_to_string(&document.path)
        .map_err(|error| format!("Could not read {}: {error}", document.path))?;
    Ok(QueryContextItem {
        path: document.path.clone(),
        relative_path: document.relative_path.clone(),
        name: document.name.clone(),
        source_kind: document.source_kind.clone(),
        reason: reason.to_string(),
        excerpt: excerpt_for_content(&content),
    })
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

fn slugify_title(title: &str) -> String {
    let mut slug = String::new();
    let mut previous_dash = false;

    for character in title.chars() {
        let next = if character.is_alphanumeric() {
            previous_dash = false;
            character.to_lowercase().next().unwrap_or(character)
        } else if !previous_dash {
            previous_dash = true;
            '-'
        } else {
            continue;
        };
        slug.push(next);
    }

    slug.trim_matches('-')
        .to_string()
        .chars()
        .take(64)
        .collect()
}

fn draft_file_stem(title: &str) -> String {
    let slug = slugify_title(title);
    if !slug.is_empty() {
        return slug;
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("ai-draft-{timestamp}")
}

fn format_wiki_draft(title: &str, content: &str) -> String {
    let date = format!(
        "{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    format!(
        "---\ntitle: {title}\nstatus: draft\ncreatedAt: {date}\n---\n\n{}",
        content.trim()
    )
}

fn append_to_knowledge_log(root: &Path, target_path: &Path) -> Result<(), String> {
    let log_path = root.join("wiki/log.md");
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let relative_path = target_path
        .strip_prefix(root)
        .unwrap_or(target_path)
        .to_string_lossy()
        .to_string();
    let mut log = fs::read_to_string(&log_path).unwrap_or_else(|_| "# Knowledge Log\n".to_string());
    if !log.ends_with('\n') {
        log.push('\n');
    }
    log.push_str(&format!(
        "- Saved assistant draft: [{relative_path}]({relative_path})\n"
    ));
    fs::write(&log_path, log)
        .map_err(|error| format!("Could not write {}: {error}", log_path.display()))
}

fn ensure_inbox_entry_in_index(root: &Path, target_path: &Path) -> Result<(), String> {
    let index_path = root.join("wiki/index.md");
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }
    let relative_path = target_path
        .strip_prefix(root.join("wiki"))
        .unwrap_or(target_path)
        .to_string_lossy()
        .to_string();
    let link_line = format!(
        "- [{0}]({1})",
        Path::new(&relative_path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("draft"),
        relative_path
    );
    let mut index =
        fs::read_to_string(&index_path).unwrap_or_else(|_| DEFAULT_INDEX_MD.to_string());
    if !index.contains("## Inbox") {
        if !index.ends_with('\n') {
            index.push('\n');
        }
        index.push_str("\n## Inbox\n\n");
    }
    if !index.contains(&link_line) {
        if !index.ends_with('\n') {
            index.push('\n');
        }
        index.push_str(&format!("{link_line}\n"));
    }
    fs::write(&index_path, index)
        .map_err(|error| format!("Could not write {}: {error}", index_path.display()))
}

fn index_workspace_documents(
    files: &[WorkspaceFile],
    current_path: &Path,
    current_content: Option<&str>,
) -> Result<Vec<IndexedDocument>, String> {
    let current_key = current_path.to_string_lossy().to_string();
    let mut docs = Vec::new();
    let mut resolver = LinkResolver::default();

    for file in files {
        resolver.add(file, source_kind_for_path(&file.relative_path));
    }

    for file in files {
        let raw_content = if file.path == current_key {
            current_content
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| fs::read_to_string(&file.path).unwrap_or_default())
        } else {
            fs::read_to_string(&file.path)
                .map_err(|error| format!("Could not read {}: {error}", file.path))?
        };
        let normalized_content = raw_content.replace("\r\n", "\n").replace('\r', "\n");

        let (frontmatter, body_start) = parse_frontmatter(&normalized_content);
        let body = &normalized_content[body_start..];
        let source_kind = source_kind_for_path(&file.relative_path).to_string();
        let tags = collect_tags(&frontmatter, body);
        let links = extract_wikilinks(body)
            .into_iter()
            .map(|(target, label)| resolver.resolve_link(&target, &label))
            .collect::<Vec<_>>();

        docs.push(IndexedDocument {
            path: file.path.clone(),
            relative_path: file.relative_path.clone(),
            name: file.name.clone(),
            source_kind,
            frontmatter,
            tags,
            links,
        });
    }

    Ok(docs)
}

fn collect_backlinks(indexed: &[IndexedDocument], current_path: &str) -> Vec<Backlink> {
    let mut backlinks = indexed
        .iter()
        .filter_map(|document| {
            document
                .links
                .iter()
                .find(|link| link.resolved_path.as_deref() == Some(current_path))
                .map(|link| Backlink {
                    path: document.path.clone(),
                    relative_path: document.relative_path.clone(),
                    name: document.name.clone(),
                    source_kind: document.source_kind.clone(),
                    label: link.label.clone(),
                })
        })
        .collect::<Vec<_>>();

    backlinks.sort_by(|left, right| {
        left.relative_path
            .to_ascii_lowercase()
            .cmp(&right.relative_path.to_ascii_lowercase())
    });
    backlinks
}

fn to_knowledge_link(link: &ResolvedLink) -> KnowledgeLink {
    KnowledgeLink {
        target: link.target.clone(),
        label: link.label.clone(),
        anchor: link.anchor.clone(),
        is_block_reference: link.is_block_reference,
        resolved_path: link.resolved_path.clone(),
        resolved_relative_path: link.resolved_relative_path.clone(),
        resolved_name: link.resolved_name.clone(),
        source_kind: link.source_kind.clone(),
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

fn parse_frontmatter(content: &str) -> (Vec<FrontmatterField>, usize) {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if !normalized.starts_with("---\n") {
        return (Vec::new(), 0);
    }

    let mut offset = 4usize;
    let mut fields = Vec::new();
    let mut current_key = String::new();
    let mut current_value = Vec::new();

    for line in normalized[4..].lines() {
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

fn collect_tags(frontmatter: &[FrontmatterField], body: &str) -> Vec<String> {
    let mut tags = BTreeMap::<String, String>::new();

    for field in frontmatter {
        if field.key.eq_ignore_ascii_case("tags") {
            for value in split_tag_values(&field.value) {
                let normalized = normalize_tag(&value);
                if !normalized.is_empty() {
                    tags.entry(normalized.to_ascii_lowercase())
                        .or_insert(normalized);
                }
            }
        }
    }

    for tag in extract_inline_tags(body) {
        let normalized = normalize_tag(&tag);
        if !normalized.is_empty() {
            tags.entry(normalized.to_ascii_lowercase())
                .or_insert(normalized);
        }
    }

    tags.into_values().collect()
}

fn split_tag_values(value: &str) -> Vec<String> {
    let trimmed = value.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return trimmed[1..trimmed.len() - 1]
            .split(',')
            .map(|part| part.trim().trim_matches('"').trim_matches('\'').to_string())
            .filter(|part| !part.is_empty())
            .collect();
    }

    trimmed
        .split('\n')
        .flat_map(|line| line.split(','))
        .map(|part| part.trim().trim_matches('"').trim_matches('\'').to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn normalize_tag(value: &str) -> String {
    value.trim().trim_start_matches('#').to_string()
}

fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = HashSet::new();
    for token in body.split_whitespace() {
        if let Some(tag) = token.strip_prefix('#') {
            let cleaned = tag.trim_matches(|character: char| {
                !character.is_alphanumeric() && character != '-' && character != '_'
            });
            if !cleaned.is_empty() {
                tags.insert(cleaned.to_string());
            }
        }
    }
    let mut values = tags.into_iter().collect::<Vec<_>>();
    values.sort_by(|left, right| left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()));
    values
}

fn extract_wikilinks(body: &str) -> Vec<(String, String)> {
    let mut links = Vec::new();
    let mut start = 0usize;

    while let Some(open) = body[start..].find("[[") {
        let begin = start + open + 2;
        let Some(close) = body[begin..].find("]]") else {
            break;
        };
        let end = begin + close;
        let raw = body[begin..end].trim();
        if !raw.is_empty() {
            let (target, label) = if let Some((target, label)) = raw.split_once('|') {
                (target.trim().to_string(), label.trim().to_string())
            } else {
                (raw.to_string(), raw.to_string())
            };
            links.push((target, label));
        }
        start = end + 2;
    }

    links
}

#[derive(Default)]
struct LinkResolver {
    by_relative: HashMap<String, ResolverTarget>,
    by_relative_without_ext: HashMap<String, ResolverTarget>,
    by_stem: HashMap<String, Vec<ResolverTarget>>,
}

#[derive(Clone)]
struct ResolverTarget {
    path: String,
    relative_path: String,
    name: String,
    source_kind: String,
}

impl LinkResolver {
    fn add(&mut self, file: &WorkspaceFile, source_kind: &str) {
        let target = ResolverTarget {
            path: file.path.clone(),
            relative_path: file.relative_path.clone(),
            name: file.name.clone(),
            source_kind: source_kind.to_string(),
        };

        self.by_relative
            .insert(normalize_lookup_key(&target.relative_path), target.clone());
        self.by_relative_without_ext.insert(
            strip_extension(&normalize_lookup_key(&target.relative_path)),
            target.clone(),
        );
        self.by_stem
            .entry(strip_extension(&normalize_lookup_key(&file.name)))
            .or_default()
            .push(target);
    }

    fn resolve_link(&self, target: &str, label: &str) -> ResolvedLink {
        let (target_without_anchor, anchor) = split_link_anchor(target);
        let lookup = normalize_lookup_key(target_without_anchor);
        let resolved = self
            .by_relative
            .get(&lookup)
            .cloned()
            .or_else(|| {
                self.by_relative_without_ext
                    .get(&strip_extension(&lookup))
                    .cloned()
            })
            .or_else(|| {
                let stem = strip_extension(&lookup);
                self.by_stem.get(&stem).and_then(|targets| {
                    if targets.len() == 1 {
                        targets.first().cloned()
                    } else {
                        None
                    }
                })
            });

        ResolvedLink {
            target: target.to_string(),
            label: if label.trim().is_empty() {
                target.to_string()
            } else {
                label.to_string()
            },
            anchor: anchor.map(ToOwned::to_owned),
            is_block_reference: anchor
                .map(|value| value.trim_start_matches('#').starts_with('^'))
                .unwrap_or(false),
            resolved_path: resolved.as_ref().map(|item| item.path.clone()),
            resolved_relative_path: resolved.as_ref().map(|item| item.relative_path.clone()),
            resolved_name: resolved.as_ref().map(|item| item.name.clone()),
            source_kind: resolved.as_ref().map(|item| item.source_kind.clone()),
        }
    }
}

fn normalize_lookup_key(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim()
        .to_ascii_lowercase()
}

fn split_link_anchor(target: &str) -> (&str, Option<&str>) {
    target
        .split_once('#')
        .map(|(path, anchor)| (path.trim(), Some(anchor.trim())))
        .unwrap_or((target.trim(), None))
}

fn strip_extension(value: &str) -> String {
    if let Some((stem, _)) = value.rsplit_once('.') {
        if !stem.contains('/') {
            return stem.to_string();
        }

        let path = Path::new(value);
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
            let parent = path
                .parent()
                .and_then(|parent| parent.to_str())
                .unwrap_or("");
            return if parent.is_empty() {
                stem.to_string()
            } else {
                format!("{parent}/{stem}")
            };
        }
    }

    value.to_string()
}

pub(crate) fn search_workspace_files(
    root: &Path,
    query: &str,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut content_terms = Vec::new();
    let mut tag_filters = Vec::new();
    let mut path_filters = Vec::new();
    for token in query.split_whitespace() {
        if let Some(path_filter) = token
            .strip_prefix("path:")
            .filter(|value| !value.is_empty())
        {
            path_filters.push(path_filter.to_ascii_lowercase());
        } else if let Some(block_filter) = token
            .strip_prefix("block:")
            .filter(|value| !value.is_empty())
        {
            let block = block_filter.trim_start_matches('^');
            content_terms.push(format!("^{block}").to_ascii_lowercase());
        } else if token.starts_with('#') && token.len() > 1 {
            tag_filters.push(token.trim_start_matches('#').to_ascii_lowercase());
        } else {
            content_terms.push(token.to_ascii_lowercase());
        }
    }
    let mut matches = Vec::new();

    for file in scan_workspace(root)? {
        let relative_path = file.relative_path.to_ascii_lowercase();
        if path_filters
            .iter()
            .any(|path_filter| !relative_path.contains(path_filter))
        {
            continue;
        }

        let path = PathBuf::from(&file.path);
        let bytes = fs::read(&path)
            .map_err(|error| format!("Could not search {}: {error}", path.display()))?;
        let content = String::from_utf8_lossy(&bytes);
        let normalized_content = content.to_ascii_lowercase();
        if tag_filters.iter().any(|tag| {
            let hash_tag = format!("#{tag}");
            let frontmatter_tag = format!(" {tag}");
            !normalized_content.contains(&hash_tag)
                && !normalized_content.contains(&frontmatter_tag)
        }) {
            continue;
        }

        if content_terms.is_empty() {
            let line_text = content
                .lines()
                .next()
                .unwrap_or("")
                .chars()
                .take(240)
                .collect();
            matches.push(SearchMatch {
                path: file.path.clone(),
                relative_path: file.relative_path.clone(),
                line_number: 1,
                line_text,
                match_start: 0,
                match_end: 0,
            });

            if matches.len() >= max_results {
                return Ok(matches);
            }
            continue;
        }

        for (line_index, line) in content.lines().enumerate() {
            let haystack = line.to_ascii_lowercase();
            if content_terms.iter().all(|term| haystack.contains(term)) {
                let match_start = content_terms
                    .first()
                    .and_then(|term| haystack.find(term))
                    .unwrap_or(0);
                matches.push(SearchMatch {
                    path: file.path.clone(),
                    relative_path: file.relative_path.clone(),
                    line_number: line_index + 1,
                    line_text: line.chars().take(240).collect(),
                    match_start,
                    match_end: match_start
                        + content_terms.first().map(|term| term.len()).unwrap_or(0),
                });

                if matches.len() >= max_results {
                    return Ok(matches);
                }
            }
        }
    }

    Ok(matches)
}

pub(crate) fn rename_workspace_tag(
    root: &Path,
    old_tag: &str,
    new_tag: &str,
) -> Result<TagRenameResult, String> {
    let old_tag = normalize_tag(old_tag);
    let new_tag = normalize_tag(new_tag);
    if old_tag.is_empty() || new_tag.is_empty() {
        return Err("标签不能为空。".to_string());
    }
    if old_tag.eq_ignore_ascii_case(&new_tag) {
        return Ok(TagRenameResult {
            files_changed: 0,
            replacements: 0,
        });
    }

    let mut files_changed = 0usize;
    let mut replacements = 0usize;
    for file in scan_workspace(root)? {
        let path = PathBuf::from(&file.path);
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
        let (next_content, count) = replace_tag_occurrences(&content, &old_tag, &new_tag);
        if count == 0 {
            continue;
        }
        fs::write(&path, next_content)
            .map_err(|error| format!("Could not write {}: {error}", path.display()))?;
        files_changed += 1;
        replacements += count;
    }

    Ok(TagRenameResult {
        files_changed,
        replacements,
    })
}

fn replace_tag_occurrences(content: &str, old_tag: &str, new_tag: &str) -> (String, usize) {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let (frontmatter, body_start) = parse_frontmatter(&normalized);
    let mut replacements = 0usize;
    let mut output = String::new();

    if body_start > 0 {
        let frontmatter_text = &normalized[..body_start];
        let (next_frontmatter, count) = replace_frontmatter_tag(frontmatter_text, old_tag, new_tag);
        output.push_str(&next_frontmatter);
        replacements += count;
    }

    let body = &normalized[body_start..];
    let (next_body, count) = replace_inline_tag(body, old_tag, new_tag);
    output.push_str(&next_body);
    replacements += count;

    if frontmatter.is_empty() && body_start == 0 {
        return (next_body, replacements);
    }
    (output, replacements)
}

fn replace_frontmatter_tag(content: &str, old_tag: &str, new_tag: &str) -> (String, usize) {
    let mut replacements = 0usize;
    let mut in_tags_block = false;
    let mut lines = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("---") {
            in_tags_block = false;
            lines.push(line.to_string());
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(':') {
            in_tags_block = key.trim().eq_ignore_ascii_case("tags") && value.trim().is_empty();
            if key.trim().eq_ignore_ascii_case("tags") && !value.trim().is_empty() {
                let (next_value, count) = replace_tag_value_list(value, old_tag, new_tag);
                replacements += count;
                let prefix = line.split_once(':').map(|(left, _)| left).unwrap_or("tags");
                lines.push(format!("{prefix}:{next_value}"));
                continue;
            }
        }

        if in_tags_block && trimmed.starts_with('-') {
            let value = trimmed.trim_start_matches('-').trim();
            if normalize_tag(value).eq_ignore_ascii_case(old_tag) {
                let indent = line
                    .chars()
                    .take_while(|character| character.is_whitespace())
                    .collect::<String>();
                lines.push(format!("{indent}- {new_tag}"));
                replacements += 1;
                continue;
            }
        }

        lines.push(line.to_string());
    }

    let mut output = lines.join("\n");
    if content.ends_with('\n') {
        output.push('\n');
    }
    (output, replacements)
}

fn replace_tag_value_list(value: &str, old_tag: &str, new_tag: &str) -> (String, usize) {
    let mut replacements = 0usize;
    let next = value
        .split(',')
        .map(|part| {
            let leading = part
                .chars()
                .take_while(|character| character.is_whitespace())
                .collect::<String>();
            let trailing = part
                .chars()
                .rev()
                .take_while(|character| character.is_whitespace())
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            let core = part.trim();
            let prefix = core
                .chars()
                .take_while(|character| matches!(character, '[' | '"' | '\'' | '#'))
                .collect::<String>();
            let suffix = core
                .chars()
                .rev()
                .take_while(|character| matches!(character, ']' | '"' | '\''))
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            let tag = core
                .trim_start_matches('[')
                .trim_end_matches(']')
                .trim_matches('"')
                .trim_matches('\'');
            if normalize_tag(tag).eq_ignore_ascii_case(old_tag) {
                replacements += 1;
                format!("{leading}{prefix}{new_tag}{suffix}{trailing}")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(",");
    (next, replacements)
}

fn replace_inline_tag(content: &str, old_tag: &str, new_tag: &str) -> (String, usize) {
    let mut output = String::new();
    let mut replacements = 0usize;
    let chars = content.chars().collect::<Vec<_>>();
    let mut index = 0usize;

    while index < chars.len() {
        if chars[index] == '#' {
            let start = index + 1;
            let mut end = start;
            while end < chars.len()
                && (chars[end].is_alphanumeric() || matches!(chars[end], '-' | '_' | '/'))
            {
                end += 1;
            }
            let tag = chars[start..end].iter().collect::<String>();
            if normalize_tag(&tag).eq_ignore_ascii_case(old_tag) {
                output.push('#');
                output.push_str(new_tag);
                replacements += 1;
                index = end;
                continue;
            }
        }
        output.push(chars[index]);
        index += 1;
    }

    (output, replacements)
}
