use std::path::PathBuf;

mod document;
mod workspace;

#[derive(Default)]
struct AppState {
    documents: document::DocumentCache,
}

#[tauri::command]
fn document_stats(content: String) -> document::DocumentStats {
    document::stats_for(&content)
}

#[tauri::command]
fn file_metadata(path: String) -> Result<document::FileMetadata, String> {
    document::file_metadata(&PathBuf::from(path))
}

#[tauri::command]
fn open_markdown_file(
    state: tauri::State<'_, AppState>,
) -> Result<Option<document::MarkdownDocument>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .add_filter("All files", &["*"])
        .pick_file()
    else {
        return Ok(None);
    };

    document::open_markdown_path(&state.documents, &path).map(Some)
}

#[tauri::command]
fn open_markdown_path(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<document::MarkdownDocument, String> {
    document::open_markdown_path(&state.documents, &PathBuf::from(path))
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
) -> Result<document::LineRange, String> {
    let path = PathBuf::from(path);
    let index = document::cached_or_build_index(&state.documents, &path)?;
    document::read_line_range(&path, &index, start_line, line_count)
}

#[tauri::command]
fn save_markdown_file(
    state: tauri::State<'_, AppState>,
    path: Option<String>,
    content: String,
) -> Result<Option<document::SaveResult>, String> {
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

    document::save_markdown_file(&state.documents, &target_path, &content).map(Some)
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
    use super::document::{build_index, read_line_range};
    use super::workspace::{scan_workspace, search_workspace_files};
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
