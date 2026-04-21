use std::{
    collections::VecDeque,
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

    Ok(Workspace {
        root_path: root.to_string_lossy().to_string(),
        files,
        knowledge: inspect_workspace(root),
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
