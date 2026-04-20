use std::{
    collections::VecDeque,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;

const MAX_WORKSPACE_FILES: usize = 5000;
pub(crate) const MAX_SEARCH_RESULTS: usize = 200;

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
