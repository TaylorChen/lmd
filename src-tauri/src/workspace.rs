use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use serde::{Serialize, Serializer};
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

#[derive(Debug)]
pub(crate) struct WorkspaceKnowledge {
    pub(crate) is_initialized: bool,
    pub(crate) notes_path: String,
    pub(crate) sources_path: String,
    pub(crate) wiki_path: String,
    pub(crate) schema_path: String,
    pub(crate) manifest_path: String,
}

#[derive(Debug, Serialize, Clone)]
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

#[derive(Debug, Clone)]
struct IndexedDocument {
    path: String,
    relative_path: String,
    name: String,
    source_kind: String,
    frontmatter: Vec<FrontmatterField>,
    tags: Vec<String>,
    links: Vec<ResolvedLink>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndexSnapshot {
    generated_at: String,
    document_count: usize,
    documents: Vec<KnowledgeIndexDocument>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnowledgeIndexDocument {
    path: String,
    relative_path: String,
    name: String,
    source_kind: String,
    tags: Vec<String>,
    frontmatter: Vec<FrontmatterField>,
    resolved_link_count: usize,
    unresolved_link_count: usize,
}

#[derive(Debug, Clone)]
struct ResolvedLink {
    target: String,
    label: String,
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
    let indexed = index_workspace_documents(&files, current_path, current_content)?;
    let current_key = current_path.to_string_lossy().to_string();

    let current = indexed
        .iter()
        .find(|document| document.path == current_key)
        .ok_or_else(|| format!("Current document is not inside workspace: {}", current_path.display()))?;

    let backlinks = collect_backlinks(&indexed, &current.path);
    let unresolved_links = current
        .links
        .iter()
        .filter(|link| link.resolved_path.is_none())
        .map(to_knowledge_link)
        .collect::<Vec<_>>();
    let outgoing_links = current.links.iter().map(to_knowledge_link).collect::<Vec<_>>();
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
                name: link.resolved_name.clone().unwrap_or_else(|| link.label.clone()),
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
    let indexed = index_workspace_documents(&files, &root.join("__lmd_none__.md"), None)?;
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
    fs::create_dir_all(root)
        .map_err(|error| format!("Could not create workspace root {}: {error}", root.display()))?;

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
        let manifest_text = serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("Could not encode manifest {}: {error}", manifest_path.display()))?;
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
    let snapshot = KnowledgeIndexSnapshot {
        generated_at: format!("{:?}", std::time::SystemTime::now()),
        document_count: indexed.len(),
        documents: indexed
            .into_iter()
            .map(|document| {
                let resolved_link_count = document
                    .links
                    .iter()
                    .filter(|link| link.resolved_path.is_some())
                    .count();
                let unresolved_link_count = document.links.len().saturating_sub(resolved_link_count);

                KnowledgeIndexDocument {
                    path: document.path,
                    relative_path: document.relative_path,
                    name: document.name,
                    source_kind: document.source_kind,
                    tags: document.tags,
                    frontmatter: document.frontmatter,
                    resolved_link_count,
                    unresolved_link_count,
                }
            })
            .collect(),
    };
    let cache_path = root.join(".lmd/knowledge/index.json");
    let json = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("Could not encode {}: {error}", cache_path.display()))?;
    fs::write(&cache_path, format!("{json}\n"))
        .map_err(|error| format!("Could not write {}: {error}", cache_path.display()))
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
            return (normalize_frontmatter_fields(fields), offset + line_with_break);
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
            current_value = vec![value.trim().trim_matches('"').trim_matches('\'').to_string()];
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
                    tags.entry(normalized.to_ascii_lowercase()).or_insert(normalized);
                }
            }
        }
    }

    for tag in extract_inline_tags(body) {
        let normalized = normalize_tag(&tag);
        if !normalized.is_empty() {
            tags.entry(normalized.to_ascii_lowercase()).or_insert(normalized);
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
            let cleaned = tag
                .trim_matches(|character: char| !character.is_alphanumeric() && character != '-' && character != '_');
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
        self.by_relative_without_ext
            .insert(strip_extension(&normalize_lookup_key(&target.relative_path)), target.clone());
        self.by_stem
            .entry(strip_extension(&normalize_lookup_key(&file.name)))
            .or_default()
            .push(target);
    }

    fn resolve_link(&self, target: &str, label: &str) -> ResolvedLink {
        let target_without_anchor = target.split('#').next().unwrap_or(target).trim();
        let lookup = normalize_lookup_key(target_without_anchor);
        let resolved = self
            .by_relative
            .get(&lookup)
            .cloned()
            .or_else(|| self.by_relative_without_ext.get(&strip_extension(&lookup)).cloned())
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
            resolved_path: resolved.as_ref().map(|item| item.path.clone()),
            resolved_relative_path: resolved.as_ref().map(|item| item.relative_path.clone()),
            resolved_name: resolved.as_ref().map(|item| item.name.clone()),
            source_kind: resolved.as_ref().map(|item| item.source_kind.clone()),
        }
    }
}

fn normalize_lookup_key(value: &str) -> String {
    value.replace('\\', "/")
        .trim_start_matches("./")
        .trim()
        .to_ascii_lowercase()
}

fn strip_extension(value: &str) -> String {
    if let Some((stem, _)) = value.rsplit_once('.') {
        if !stem.contains('/') {
            return stem.to_string();
        }

        let path = Path::new(value);
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
            let parent = path.parent().and_then(|parent| parent.to_str()).unwrap_or("");
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

    let needle = query.to_ascii_lowercase();
    let mut matches = Vec::new();

    for file in scan_workspace(root)? {
        let path = PathBuf::from(&file.path);
        let bytes = fs::read(&path)
            .map_err(|error| format!("Could not search {}: {error}", path.display()))?;
        let content = String::from_utf8_lossy(&bytes);

        for (line_index, line) in content.lines().enumerate() {
            let haystack = line.to_ascii_lowercase();
            if let Some(match_start) = haystack.find(&needle) {
                matches.push(SearchMatch {
                    path: file.path.clone(),
                    relative_path: file.relative_path.clone(),
                    line_number: line_index + 1,
                    line_text: line.chars().take(240).collect(),
                    match_start,
                    match_end: match_start + query.len(),
                });

                if matches.len() >= max_results {
                    return Ok(matches);
                }
            }
        }
    }

    Ok(matches)
}
