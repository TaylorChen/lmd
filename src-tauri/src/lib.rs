use std::{
    collections::HashMap,
    fs::{self, File},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use memmap2::Mmap;
use serde::Serialize;

mod workspace;

const LARGE_FILE_THRESHOLD_BYTES: u64 = 5 * 1024 * 1024;
const DEFAULT_WINDOW_LINES: usize = 600;

#[derive(Debug, Clone)]
struct IndexedFile {
    byte_size: usize,
    modified: Option<SystemTime>,
    line_offsets: Vec<usize>,
}

#[derive(Default)]
struct AppState {
    indexed_files: Mutex<HashMap<String, IndexedFile>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocument {
    path: String,
    content: String,
    byte_size: usize,
    line_count: usize,
    modified_ms: Option<u64>,
    is_large: bool,
    read_only: bool,
    visible_start_line: usize,
    visible_line_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    path: String,
    byte_size: usize,
    line_count: usize,
    modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentStats {
    byte_size: usize,
    line_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    exists: bool,
    byte_size: Option<u64>,
    modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LineRange {
    content: String,
    start_line: usize,
    line_count: usize,
}

fn stats_for(content: &str) -> DocumentStats {
    DocumentStats {
        byte_size: content.len(),
        line_count: if content.is_empty() {
            0
        } else {
            content.lines().count()
        },
    }
}

fn system_time_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn metadata_modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata.modified().ok().and_then(system_time_ms)
}

fn build_index(path: &Path) -> Result<IndexedFile, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if metadata.len() == 0 {
        return Ok(IndexedFile {
            byte_size: 0,
            modified: metadata.modified().ok(),
            line_offsets: Vec::new(),
        });
    }

    let file =
        File::open(path).map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|error| format!("Could not map {}: {error}", path.display()))?;
    let bytes = &mmap[..];
    let mut line_offsets = Vec::new();

    if !bytes.is_empty() {
        line_offsets.push(0);
        for (index, byte) in bytes.iter().enumerate() {
            if *byte == b'\n' && index + 1 < bytes.len() {
                line_offsets.push(index + 1);
            }
        }
    }

    Ok(IndexedFile {
        byte_size: bytes.len(),
        modified: metadata.modified().ok(),
        line_offsets,
    })
}

fn read_line_range(
    path: &Path,
    index: &IndexedFile,
    start_line: usize,
    line_count: usize,
) -> Result<LineRange, String> {
    if index.line_offsets.is_empty() {
        return Ok(LineRange {
            content: String::new(),
            start_line: 0,
            line_count: 0,
        });
    }

    let start_line = start_line.clamp(1, index.line_offsets.len());
    let line_count = line_count.max(1);
    let start_index = start_line - 1;
    let end_line_exclusive = (start_index + line_count).min(index.line_offsets.len());
    let start_byte = index.line_offsets[start_index];
    let end_byte = index
        .line_offsets
        .get(end_line_exclusive)
        .copied()
        .unwrap_or(index.byte_size);

    let file =
        File::open(path).map_err(|error| format!("Could not open {}: {error}", path.display()))?;
    let mmap = unsafe { Mmap::map(&file) }
        .map_err(|error| format!("Could not map {}: {error}", path.display()))?;
    if end_byte > mmap.len() {
        return Err(format!(
            "File changed while reading {}; reload the document",
            path.display()
        ));
    }
    let content = String::from_utf8_lossy(&mmap[start_byte..end_byte]).to_string();

    Ok(LineRange {
        content,
        start_line,
        line_count: end_line_exclusive - start_index,
    })
}

fn cached_or_build_index(state: &AppState, path: &Path) -> Result<IndexedFile, String> {
    let key = path.to_string_lossy().to_string();
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let current_modified = metadata.modified().ok();

    if let Some(index) = state
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .get(&key)
        .cloned()
    {
        if index.byte_size == metadata.len() as usize && index.modified == current_modified {
            return Ok(index);
        }
    }

    let index = build_index(path)?;
    state
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .insert(key, index.clone());
    Ok(index)
}

fn open_markdown_path_inner(state: &AppState, path: &Path) -> Result<MarkdownDocument, String> {
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

    if metadata.len() > LARGE_FILE_THRESHOLD_BYTES {
        let index = build_index(path)?;
        let range = read_line_range(path, &index, 1, DEFAULT_WINDOW_LINES)?;
        state
            .indexed_files
            .lock()
            .map_err(|_| "Could not lock file index cache".to_string())?
            .insert(path.to_string_lossy().to_string(), index.clone());

        return Ok(MarkdownDocument {
            path: path.to_string_lossy().to_string(),
            content: range.content,
            byte_size: index.byte_size,
            line_count: index.line_offsets.len(),
            modified_ms: metadata_modified_ms(&metadata),
            is_large: true,
            read_only: true,
            visible_start_line: range.start_line,
            visible_line_count: range.line_count,
        });
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let stats = stats_for(&content);

    Ok(MarkdownDocument {
        path: path.to_string_lossy().to_string(),
        content,
        byte_size: stats.byte_size,
        line_count: stats.line_count,
        modified_ms: metadata_modified_ms(&metadata),
        is_large: false,
        read_only: false,
        visible_start_line: if stats.line_count == 0 { 0 } else { 1 },
        visible_line_count: stats.line_count,
    })
}

#[tauri::command]
fn document_stats(content: String) -> DocumentStats {
    stats_for(&content)
}

#[tauri::command]
fn file_metadata(path: String) -> Result<FileMetadata, String> {
    let path = PathBuf::from(path);
    match fs::metadata(&path) {
        Ok(metadata) => Ok(FileMetadata {
            exists: true,
            byte_size: Some(metadata.len()),
            modified_ms: metadata_modified_ms(&metadata),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileMetadata {
            exists: false,
            byte_size: None,
            modified_ms: None,
        }),
        Err(error) => Err(format!("Could not inspect {}: {error}", path.display())),
    }
}

#[tauri::command]
fn open_markdown_file(
    state: tauri::State<'_, AppState>,
) -> Result<Option<MarkdownDocument>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .add_filter("All files", &["*"])
        .pick_file()
    else {
        return Ok(None);
    };

    open_markdown_path_inner(&state, &path).map(Some)
}

#[tauri::command]
fn open_markdown_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<MarkdownDocument, String> {
    open_markdown_path_inner(&state, &PathBuf::from(path))
}

#[tauri::command]
fn open_workspace() -> Result<Option<workspace::Workspace>, String> {
    let Some(root_path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };

    let files = workspace::scan_workspace(&root_path)?;

    Ok(Some(workspace::Workspace {
        root_path: root_path.to_string_lossy().to_string(),
        files,
    }))
}

#[tauri::command]
fn refresh_workspace(root_path: String) -> Result<workspace::Workspace, String> {
    let root_path = PathBuf::from(root_path);
    let files = workspace::scan_workspace(&root_path)?;

    Ok(workspace::Workspace {
        root_path: root_path.to_string_lossy().to_string(),
        files,
    })
}

#[tauri::command]
fn search_workspace(
    root_path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<workspace::SearchMatch>, String> {
    let max_results = max_results
        .unwrap_or(workspace::MAX_SEARCH_RESULTS)
        .clamp(1, workspace::MAX_SEARCH_RESULTS);
    workspace::search_workspace_files(&PathBuf::from(root_path), &query, max_results)
}

#[tauri::command]
fn load_markdown_range(
    state: tauri::State<'_, AppState>,
    path: String,
    start_line: usize,
    line_count: usize,
) -> Result<LineRange, String> {
    let path = PathBuf::from(path);
    let index = cached_or_build_index(&state, &path)?;
    read_line_range(&path, &index, start_line, line_count)
}

#[tauri::command]
fn save_markdown_file(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
    content: String,
) -> Result<Option<SaveResult>, String> {
    let target_path = match path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => {
            let Some(path) = rfd::FileDialog::new()
                .add_filter("Markdown", &["md", "markdown"])
                .set_file_name("untitled.md")
                .save_file()
            else {
                return Ok(None);
            };
            path
        }
    };

    fs::write(&target_path, &content)
        .map_err(|error| format!("Could not save {}: {error}", target_path.display()))?;
    let metadata = fs::metadata(&target_path)
        .map_err(|error| format!("Could not inspect {}: {error}", target_path.display()))?;
    state
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .remove(&target_path.to_string_lossy().to_string());
    let stats = stats_for(&content);

    Ok(Some(SaveResult {
        path: target_path.to_string_lossy().to_string(),
        byte_size: stats.byte_size,
        line_count: stats.line_count,
        modified_ms: metadata_modified_ms(&metadata),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            document_stats,
            file_metadata,
            load_markdown_range,
            open_markdown_file,
            open_markdown_path,
            open_workspace,
            refresh_workspace,
            search_workspace,
            save_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running LMD");
}

#[cfg(test)]
mod tests {
    use super::workspace::{scan_workspace, search_workspace_files};
    use super::{build_index, read_line_range};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_markdown_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("lmd-{name}-{}-{nonce}.md", std::process::id()))
    }

    fn temp_workspace_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("lmd-{name}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn builds_line_offsets_for_markdown_file() {
        let path = temp_markdown_path("index");
        fs::write(&path, "alpha\nbeta\ngamma").expect("write test file");

        let index = build_index(&path).expect("build index");

        assert_eq!(index.byte_size, 16);
        assert_eq!(index.line_offsets, vec![0, 6, 11]);

        fs::remove_file(path).expect("remove test file");
    }

    #[test]
    fn reads_clamped_line_range_from_index() {
        let path = temp_markdown_path("range");
        fs::write(&path, "one\ntwo\nthree\nfour\n").expect("write test file");
        let index = build_index(&path).expect("build index");

        let range = read_line_range(&path, &index, 2, 2).expect("read range");
        assert_eq!(range.start_line, 2);
        assert_eq!(range.line_count, 2);
        assert_eq!(range.content, "two\nthree\n");

        let clamped = read_line_range(&path, &index, 99, 10).expect("read clamped range");
        assert_eq!(clamped.start_line, 4);
        assert_eq!(clamped.line_count, 1);
        assert_eq!(clamped.content, "four\n");

        fs::remove_file(path).expect("remove test file");
    }

    #[test]
    fn scans_workspace_markdown_files_and_skips_generated_dirs() {
        let root = temp_workspace_path("workspace");
        fs::create_dir_all(root.join("notes")).expect("create notes dir");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create skipped dir");
        fs::create_dir_all(root.join(".git")).expect("create hidden dir");
        fs::write(root.join("README.md"), "# readme").expect("write markdown");
        fs::write(root.join("notes/today.markdown"), "# today").expect("write markdown");
        fs::write(root.join("notes/plain.txt"), "plain").expect("write text");
        fs::write(root.join("notes/image.png"), "png").expect("write ignored file");
        fs::write(root.join("node_modules/pkg/ignored.md"), "# ignored")
            .expect("write ignored file");
        fs::write(root.join(".git/config.md"), "# ignored").expect("write ignored file");

        let files = scan_workspace(&root).expect("scan workspace");
        let relative_paths = files
            .iter()
            .map(|file| file.relative_path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            relative_paths,
            vec!["notes/plain.txt", "notes/today.markdown", "README.md"]
        );

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn searches_workspace_files_with_result_limit() {
        let root = temp_workspace_path("search");
        fs::create_dir_all(root.join("notes")).expect("create notes dir");
        fs::write(root.join("alpha.md"), "One needle\nTwo needle\n").expect("write markdown");
        fs::write(root.join("notes/beta.txt"), "No match\nNeedle here\n").expect("write text");

        let matches = search_workspace_files(&root, "needle", 2).expect("search workspace");

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].relative_path, "alpha.md");
        assert_eq!(matches[0].line_number, 1);
        assert_eq!(matches[0].match_start, 4);
        assert_eq!(matches[0].match_end, 10);
        assert_eq!(matches[1].relative_path, "alpha.md");
        assert_eq!(matches[1].line_number, 2);

        fs::remove_dir_all(root).expect("remove workspace");
    }
}
