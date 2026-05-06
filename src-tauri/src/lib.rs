use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

mod assistant;
mod document;
mod export;
mod workspace;

#[cfg(target_os = "macos")]
const APP_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

#[derive(Default)]
struct AppState {
    documents: document::DocumentCache,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantStreamDelta {
    request_id: String,
    delta: String,
}

#[cfg(target_os = "macos")]
fn set_macos_application_icon() {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(main_thread) = MainThreadMarker::new() else {
        return;
    };

    let icon_data =
        unsafe { NSData::dataWithBytes_length(APP_ICON_PNG.as_ptr().cast(), APP_ICON_PNG.len()) };
    let Some(icon) = NSImage::initWithData(NSImage::alloc(), &icon_data) else {
        return;
    };
    let app = NSApplication::sharedApplication(main_thread);
    unsafe {
        app.setApplicationIconImage(Some(&icon));
    }
}

#[cfg(not(target_os = "macos"))]
fn set_macos_application_icon() {}

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

    workspace::load_workspace(&root_path).map(Some)
}

#[tauri::command]
fn refresh_workspace(root_path: String) -> Result<workspace::Workspace, String> {
    let root_path = PathBuf::from(root_path);
    workspace::load_workspace(&root_path)
}

#[tauri::command]
fn initialize_knowledge_workspace(root_path: String) -> Result<workspace::Workspace, String> {
    workspace::initialize_knowledge_workspace(&PathBuf::from(root_path))
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
fn document_knowledge(
    root_path: String,
    current_path: String,
    current_content: Option<String>,
) -> Result<workspace::DocumentKnowledge, String> {
    workspace::document_knowledge(
        &PathBuf::from(root_path),
        &PathBuf::from(current_path),
        current_content.as_deref(),
    )
}

#[tauri::command]
fn knowledge_lint_report(root_path: String) -> Result<workspace::KnowledgeLintReport, String> {
    workspace::knowledge_lint_report(&PathBuf::from(root_path))
}

#[tauri::command]
fn query_context(
    root_path: String,
    current_path: String,
    current_content: Option<String>,
) -> Result<workspace::QueryContext, String> {
    workspace::query_context(
        &PathBuf::from(root_path),
        &PathBuf::from(current_path),
        current_content.as_deref(),
    )
}

#[tauri::command]
async fn summarize_query_context(
    app: tauri::AppHandle,
    request_id: Option<String>,
    root_path: String,
    current_path: String,
    current_content: Option<String>,
    provider: Option<String>,
    model: Option<String>,
    task: Option<String>,
    prompt: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    external_command: Option<String>,
    external_timeout_seconds: Option<u64>,
) -> Result<workspace::AssistantDraft, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let full_current_content = match current_content {
            Some(content) => Some(content),
            None => std::fs::read_to_string(&current_path).ok(),
        };
        let context = workspace::query_context(
            &PathBuf::from(root_path),
            &PathBuf::from(&current_path),
            full_current_content.as_deref(),
        )?;
        let request = assistant::AssistantRequest {
            provider: provider.as_deref().unwrap_or(assistant::DEFAULT_PROVIDER),
            model: model.as_deref().unwrap_or(assistant::DEFAULT_MODEL),
            context: &context,
            current_content: full_current_content.as_deref(),
            task: task.as_deref(),
            prompt: prompt.as_deref(),
            api_key: api_key.as_deref(),
            base_url: base_url.as_deref(),
            external_command: external_command.as_deref(),
            external_timeout_seconds,
        };
        if let Some(request_id) = request_id {
            let mut emit_delta = |delta: &str| {
                let _ = app.emit(
                    "assistant-stream-delta",
                    AssistantStreamDelta {
                        request_id: request_id.clone(),
                        delta: delta.to_string(),
                    },
                );
            };
            assistant::summarize_query_context_stream(request, &mut emit_delta)
        } else {
            assistant::summarize_query_context(request)
        }
    })
    .await
    .map_err(|error| format!("Assistant task failed: {error}"))?
}

#[tauri::command]
async fn summarize_editor_context(
    app: tauri::AppHandle,
    request_id: Option<String>,
    current_path: Option<String>,
    current_relative_path: Option<String>,
    current_content: String,
    provider: Option<String>,
    model: Option<String>,
    task: Option<String>,
    prompt: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    external_command: Option<String>,
    external_timeout_seconds: Option<u64>,
) -> Result<workspace::AssistantDraft, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let context = workspace::QueryContext {
            current_path: current_path.unwrap_or_else(|| "untitled.md".to_string()),
            current_relative_path: current_relative_path
                .unwrap_or_else(|| "untitled.md".to_string()),
            items: Vec::new(),
        };

        let request = assistant::AssistantRequest {
            provider: provider.as_deref().unwrap_or(assistant::DEFAULT_PROVIDER),
            model: model.as_deref().unwrap_or(assistant::DEFAULT_MODEL),
            context: &context,
            current_content: Some(&current_content),
            task: task.as_deref(),
            prompt: prompt.as_deref(),
            api_key: api_key.as_deref(),
            base_url: base_url.as_deref(),
            external_command: external_command.as_deref(),
            external_timeout_seconds,
        };
        if let Some(request_id) = request_id {
            let mut emit_delta = |delta: &str| {
                let _ = app.emit(
                    "assistant-stream-delta",
                    AssistantStreamDelta {
                        request_id: request_id.clone(),
                        delta: delta.to_string(),
                    },
                );
            };
            assistant::summarize_query_context_stream(request, &mut emit_delta)
        } else {
            assistant::summarize_query_context(request)
        }
    })
    .await
    .map_err(|error| format!("Assistant task failed: {error}"))?
}

#[tauri::command]
fn assistant_catalog() -> assistant::AssistantCatalog {
    assistant::catalog()
}

#[tauri::command]
fn save_wiki_draft(root_path: String, title: String, content: String) -> Result<String, String> {
    workspace::save_wiki_draft(&PathBuf::from(root_path), &title, &content)
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

#[tauri::command]
fn create_markdown_file(
    state: tauri::State<'_, AppState>,
    root_path: String,
    directory: String,
    name: String,
    content: String,
) -> Result<document::SaveResult, String> {
    document::create_markdown_file(
        &state.documents,
        &PathBuf::from(root_path),
        &directory,
        &name,
        &content,
    )
}

#[tauri::command]
fn rename_markdown_file(
    state: tauri::State<'_, AppState>,
    path: String,
    new_name: String,
) -> Result<document::SaveResult, String> {
    document::rename_markdown_file(&state.documents, &PathBuf::from(path), &new_name)
}

#[tauri::command]
fn import_attachment(
    root_path: Option<String>,
    current_path: Option<String>,
) -> Result<Option<document::AttachmentImportResult>, String> {
    let Some(source_path) = rfd::FileDialog::new().pick_file() else {
        return Ok(None);
    };
    let root = root_path.as_deref().map(PathBuf::from);
    let current = current_path.as_deref().map(PathBuf::from);
    document::import_attachment(root.as_deref(), current.as_deref(), &source_path).map(Some)
}

#[tauri::command]
fn export_markdown_html(path: Option<String>, html: String) -> Result<Option<String>, String> {
    let default_name = path
        .as_deref()
        .and_then(|path| {
            PathBuf::from(path)
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "untitled".to_string());
    let Some(target_path) = rfd::FileDialog::new()
        .add_filter("HTML", &["html", "htm"])
        .set_file_name(format!("{default_name}.html"))
        .save_file()
    else {
        return Ok(None);
    };

    export::export_html_document(&target_path, &html).map(Some)
}

#[tauri::command]
fn export_markdown_pdf(path: Option<String>, content: String) -> Result<Option<String>, String> {
    let default_name = path
        .as_deref()
        .and_then(|path| {
            PathBuf::from(path)
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "untitled".to_string());
    let Some(target_path) = rfd::FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_file_name(format!("{default_name}.pdf"))
        .save_file()
    else {
        return Ok(None);
    };

    export::export_pdf(&target_path, &content).map(Some)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|_app| {
            set_macos_application_icon();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            document_stats,
            document_knowledge,
            export_markdown_html,
            export_markdown_pdf,
            assistant_catalog,
            create_markdown_file,
            file_metadata,
            import_attachment,
            load_markdown_range,
            initialize_knowledge_workspace,
            knowledge_lint_report,
            open_markdown_file,
            open_markdown_path,
            open_workspace,
            query_context,
            refresh_workspace,
            rename_markdown_file,
            save_wiki_draft,
            search_workspace,
            summarize_editor_context,
            summarize_query_context,
            save_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running LMD");
}

#[cfg(test)]
mod tests {
    use super::assistant::{
        catalog as assistant_catalog_state,
        summarize_query_context as summarize_assistant_query_context, AssistantRequest,
    };
    use super::document::{
        build_index, create_markdown_file, file_metadata, import_attachment, open_markdown_path,
        read_line_range, rename_markdown_file, save_markdown_file, DocumentCache,
    };
    use super::export::{export_html_document, export_pdf, pdf_document};
    use super::workspace::{
        document_knowledge, initialize_knowledge_workspace, knowledge_lint_report, load_workspace,
        query_context, save_wiki_draft, scan_workspace, search_workspace_files, QueryContext,
        QueryContextItem,
    };
    use serde_json::{json, to_value};
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::{
        env, fs,
        io::Write,
        path::PathBuf,
        thread,
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
    fn saves_and_reopens_real_markdown_file() {
        let cache = DocumentCache::default();
        let path = temp_markdown_path("save-open");
        let content = "# Saved\n\nBody text";

        let save_result = save_markdown_file(&cache, &path, content).expect("save markdown");
        let save_json = to_value(save_result).expect("serialize save result");
        assert_eq!(fs::read_to_string(&path).expect("read saved file"), content);
        assert_eq!(save_json["path"], path.to_string_lossy().to_string());
        assert_eq!(save_json["lineCount"], 3);
        assert!(save_json["modifiedMs"].as_u64().is_some());

        let opened = open_markdown_path(&cache, &path).expect("open saved markdown");
        let opened_json = to_value(opened).expect("serialize markdown document");
        assert_eq!(opened_json["content"], content);
        assert_eq!(opened_json["isLarge"], false);
        assert_eq!(opened_json["readOnly"], false);

        fs::remove_file(path).expect("remove saved file");
    }

    #[test]
    fn creates_renames_and_imports_workspace_files() {
        let workspace = temp_workspace_path("file-workflows");
        fs::create_dir_all(&workspace).unwrap();
        let cache = DocumentCache::default();

        let created =
            create_markdown_file(&cache, &workspace, "notes", "daily", "# Daily\n").unwrap();
        assert!(created.path.ends_with("notes/daily.md"));
        assert!(PathBuf::from(&created.path).is_file());

        let renamed =
            rename_markdown_file(&cache, &PathBuf::from(&created.path), "renamed.md").unwrap();
        assert!(renamed.path.ends_with("notes/renamed.md"));
        assert!(!PathBuf::from(&created.path).exists());

        let source = workspace.join("source.png");
        fs::write(&source, b"png").unwrap();
        let imported = import_attachment(
            Some(&workspace),
            Some(&PathBuf::from(&renamed.path)),
            &source,
        )
        .unwrap();
        assert!(PathBuf::from(&imported.path).is_file());
        assert_eq!(imported.markdown, "![source](../attachments/source.png)");

        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn exports_html_and_pdf_to_real_files() {
        let html_path = temp_workspace_path("export-html").with_extension("html");
        let pdf_path = temp_workspace_path("export-pdf").with_extension("pdf");
        let html = "<!doctype html><html><body><h1>Exported</h1></body></html>";

        let exported_html = export_html_document(&html_path, html).expect("export html");
        assert_eq!(exported_html, html_path.to_string_lossy().to_string());
        assert_eq!(fs::read_to_string(&html_path).expect("read html"), html);

        let exported_pdf = export_pdf(&pdf_path, "# Exported\n\nBody").expect("export pdf");
        let pdf_bytes = fs::read(&pdf_path).expect("read pdf");
        assert_eq!(exported_pdf, pdf_path.to_string_lossy().to_string());
        assert!(String::from_utf8_lossy(&pdf_bytes).starts_with("%PDF-1.4"));

        fs::remove_file(html_path).expect("remove html");
        fs::remove_file(pdf_path).expect("remove pdf");
    }

    #[test]
    fn reports_external_modification_and_missing_file_metadata() {
        let path = temp_markdown_path("metadata");
        fs::write(&path, "alpha").expect("write initial file");

        let initial = to_value(file_metadata(&path).expect("metadata for initial file"))
            .expect("serialize initial metadata");
        assert_eq!(initial["exists"], true);
        assert_eq!(initial["byteSize"], 5);
        assert!(initial["modifiedMs"].as_u64().is_some());

        thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&path, "alpha\nbeta").expect("modify file");

        let modified = to_value(file_metadata(&path).expect("metadata for modified file"))
            .expect("serialize modified metadata");
        assert_eq!(modified["exists"], true);
        assert_eq!(modified["byteSize"], 10);
        assert!(
            modified["modifiedMs"].as_u64().expect("modified mtime")
                >= initial["modifiedMs"].as_u64().expect("initial mtime")
        );

        fs::remove_file(&path).expect("remove file");

        let missing = to_value(file_metadata(&path).expect("metadata for missing file"))
            .expect("serialize missing metadata");
        assert_eq!(missing["exists"], false);
        assert!(missing["byteSize"].is_null());
        assert!(missing["modifiedMs"].is_null());
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

    #[test]
    fn initializes_knowledge_workspace_protocol() {
        let root = temp_workspace_path("knowledge-init");

        let workspace =
            initialize_knowledge_workspace(&root).expect("initialize knowledge workspace");
        assert!(workspace.knowledge.is_initialized);
        assert!(root.join("notes").is_dir());
        assert!(root.join("sources").is_dir());
        assert!(root.join("wiki/index.md").is_file());
        assert!(root.join("wiki/log.md").is_file());
        assert!(root.join("wiki/inbox").is_dir());
        assert!(root.join("wiki/entities").is_dir());
        assert!(root.join("wiki/concepts").is_dir());
        assert!(root.join("wiki/syntheses").is_dir());
        assert!(root.join("wiki/sources").is_dir());
        assert!(root.join("AGENTS.md").is_file());
        assert!(root.join(".lmd/knowledge/manifest.json").is_file());
        assert!(root.join(".lmd/knowledge/index.json").is_file());

        let manifest =
            fs::read_to_string(root.join(".lmd/knowledge/manifest.json")).expect("read manifest");
        assert!(manifest.contains("\"indexVersion\": 1"));
        assert!(manifest.contains("\"lastCompileStatus\": \"idle\""));
        let index_cache =
            fs::read_to_string(root.join(".lmd/knowledge/index.json")).expect("read index cache");
        assert!(index_cache.contains("\"documentCount\""));
        assert!(index_cache.contains("\"links\""));

        let loaded = load_workspace(&root).expect("reload initialized workspace");
        assert!(loaded.knowledge.is_initialized);

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn builds_document_knowledge_with_links_and_backlinks() {
        let root = temp_workspace_path("document-knowledge");
        fs::create_dir_all(root.join("notes")).expect("create notes");
        fs::create_dir_all(root.join("wiki/concepts")).expect("create wiki");
        fs::create_dir_all(root.join("sources")).expect("create sources");
        fs::write(
            root.join("notes/alpha.md"),
            "---\ntags:\n- focus\n- draft\n---\n# Alpha\n\nLink to [[Beta]] and [[Source Doc]].\n\n[[Missing Page]].\n\n#writing",
        )
        .expect("write alpha");
        fs::write(
            root.join("wiki/concepts/beta.md"),
            "# Beta\n\nBacklink to [[alpha]].",
        )
        .expect("write beta");
        fs::write(root.join("sources/source doc.md"), "# Source Doc").expect("write source");

        let knowledge = document_knowledge(&root, &root.join("notes/alpha.md"), None)
            .expect("document knowledge");
        let knowledge_json = to_value(knowledge).expect("serialize knowledge");

        assert_eq!(knowledge_json["currentRelativePath"], "notes/alpha.md");
        assert_eq!(knowledge_json["tags"], json!(["draft", "focus", "writing"]));
        assert_eq!(
            knowledge_json["outgoingLinks"][0]["resolvedRelativePath"],
            "wiki/concepts/beta.md"
        );
        assert_eq!(knowledge_json["outgoingLinks"][0]["sourceKind"], "wiki");
        assert!(knowledge_json["sourceReferences"]
            .as_array()
            .expect("source refs")
            .iter()
            .any(|item| item["relativePath"] == "sources/source doc.md"));
        assert_eq!(
            knowledge_json["unresolvedLinks"][0]["target"],
            "Missing Page"
        );
        assert_eq!(
            knowledge_json["backlinks"][0]["relativePath"],
            "wiki/concepts/beta.md"
        );
        assert_eq!(
            knowledge_json["relatedWikiPages"][0]["relativePath"],
            "wiki/concepts/beta.md"
        );

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn builds_knowledge_lint_report_for_wiki_issues() {
        let root = temp_workspace_path("knowledge-lint");
        fs::create_dir_all(root.join("wiki")).expect("create wiki");
        fs::write(root.join("wiki/index.md"), "# Index\n\n- [[Existing]]\n").expect("write index");
        fs::write(
            root.join("wiki/existing.md"),
            "# Existing\n\n[[Missing Topic]]\n",
        )
        .expect("write existing");
        fs::write(root.join("wiki/orphan.md"), "# Orphan\n").expect("write orphan");

        let report = knowledge_lint_report(&root).expect("lint report");
        let report_json = to_value(report).expect("serialize lint report");
        let issues = report_json["issues"].as_array().expect("issues array");

        assert!(issues
            .iter()
            .any(|issue| issue["kind"] == "unresolved_link"));
        assert!(issues
            .iter()
            .any(|issue| issue["kind"] == "orphan_wiki_page"));
        assert!(issues
            .iter()
            .any(|issue| issue["kind"] == "not_in_index"
                && issue["relativePath"] == "wiki/orphan.md"));

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn builds_query_context_from_current_and_related_documents() {
        let root = temp_workspace_path("query-context");
        fs::create_dir_all(root.join("notes")).expect("create notes");
        fs::create_dir_all(root.join("wiki")).expect("create wiki");
        fs::create_dir_all(root.join("sources")).expect("create sources");
        fs::write(root.join("wiki/index.md"), "# Index\n\n[[overview]]").expect("write index");
        fs::write(
            root.join("notes/topic.md"),
            "# Topic\n\n[[overview]]\n[[source material]]",
        )
        .expect("write topic");
        fs::write(
            root.join("wiki/overview.md"),
            "# Overview\n\nBacklink [[topic]]",
        )
        .expect("write overview");
        fs::write(
            root.join("sources/source material.md"),
            "# Source Material\n\nFacts",
        )
        .expect("write source");

        let context =
            query_context(&root, &root.join("notes/topic.md"), None).expect("query context");
        let context_json = to_value(context).expect("serialize query context");
        let items = context_json["items"].as_array().expect("items");

        assert!(items
            .iter()
            .any(|item| item["reason"] == "current_document"));
        assert!(items.iter().any(|item| item["reason"] == "linked_wiki"));
        assert!(items
            .iter()
            .any(|item| item["reason"] == "source_reference"));
        assert!(items.iter().any(|item| item["reason"] == "index_hint"));

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn summarizes_query_context_and_saves_wiki_draft() {
        let root = temp_workspace_path("assistant-draft");
        fs::create_dir_all(root.join("notes")).expect("create notes");
        fs::create_dir_all(root.join("wiki/inbox")).expect("create inbox");
        fs::write(root.join("wiki/index.md"), "# Knowledge Index\n").expect("write index");
        fs::write(root.join("wiki/log.md"), "# Knowledge Log\n").expect("write log");
        fs::write(root.join("notes/topic.md"), "# Topic\n\nBody").expect("write topic");

        let context =
            query_context(&root, &root.join("notes/topic.md"), None).expect("query context");
        let script_path = temp_workspace_path("assistant-draft-command").with_extension("sh");
        let mut script = fs::File::create(&script_path).expect("create assistant command");
        writeln!(
            script,
            "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{{\"title\":\"topic summary\",\"content\":\"# topic summary\\n\\n## Summary\\n\\nFrom command.\"}}'"
        )
        .expect("write assistant command");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&script_path)
                .expect("assistant command metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&script_path, permissions).expect("chmod assistant command");
        }

        let draft = summarize_assistant_query_context(AssistantRequest {
            provider: "external_command",
            model: "command-json-v1",
            context: &context,
            current_content: None,
            task: None,
            prompt: None,
            api_key: None,
            base_url: None,
            external_command: Some(script_path.to_string_lossy().as_ref()),
            external_timeout_seconds: Some(30),
        })
        .expect("external command summary");
        assert!(draft.title.contains("topic"));
        assert!(draft.content.contains("Summary"));

        let saved_path = save_wiki_draft(&root, &draft.title, &draft.content).expect("save draft");
        let saved_content = fs::read_to_string(&saved_path).expect("read saved draft");
        let log_content = fs::read_to_string(root.join("wiki/log.md")).expect("read log");
        let index_content = fs::read_to_string(root.join("wiki/index.md")).expect("read index");
        assert!(saved_path.contains("/wiki/inbox/"));
        assert!(saved_content.starts_with("---\n"));
        assert!(saved_content.contains("status: draft"));
        assert!(saved_content.contains("## Summary"));
        assert!(log_content.contains("Saved assistant draft"));
        assert!(index_content.contains("## Inbox"));
        assert!(index_content.contains("topic-summary.md"));

        fs::remove_file(script_path).expect("remove assistant command");
        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn saves_wiki_draft_when_inbox_directory_is_missing() {
        let root = temp_workspace_path("assistant-draft-missing-inbox");
        fs::create_dir_all(&root).expect("create workspace root");

        let saved_path = save_wiki_draft(&root, "AI", "# AI\n\nDraft").expect("save draft");

        assert!(root.join("wiki/inbox/ai.md").is_file());
        assert!(root.join("wiki/index.md").is_file());
        assert!(root.join("wiki/log.md").is_file());
        assert_eq!(saved_path, root.join("wiki/inbox/ai.md").to_string_lossy());

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn saves_wiki_draft_with_non_ascii_or_empty_title_names() {
        let root = temp_workspace_path("assistant-draft-names");
        fs::create_dir_all(&root).expect("create workspace root");

        let chinese_path =
            save_wiki_draft(&root, "你好，世界", "# 你好").expect("save chinese draft");
        let fallback_path =
            save_wiki_draft(&root, "!!!", "# Empty title").expect("save fallback draft");

        assert!(chinese_path.ends_with("/wiki/inbox/你好-世界.md"));
        assert!(fallback_path.contains("/wiki/inbox/ai-draft-"));
        assert!(!fallback_path.ends_with("/wiki/inbox/.md"));

        fs::remove_dir_all(root).expect("remove workspace");
    }

    #[test]
    fn requires_api_key_for_network_provider() {
        let context = QueryContext {
            current_path: "/tmp/topic.md".to_string(),
            current_relative_path: "notes/topic.md".to_string(),
            items: vec![QueryContextItem {
                path: "/tmp/topic.md".to_string(),
                relative_path: "notes/topic.md".to_string(),
                name: "topic.md".to_string(),
                source_kind: "note".to_string(),
                reason: "current_document".to_string(),
                excerpt: "Topic excerpt".to_string(),
            }],
        };

        let previous = env::var("DEEPSEEK_API_KEY").ok();
        env::remove_var("DEEPSEEK_API_KEY");
        let error = summarize_assistant_query_context(AssistantRequest {
            provider: "deepseek",
            model: "deepseek-v4-flash",
            context: &context,
            current_content: None,
            task: None,
            prompt: None,
            api_key: None,
            base_url: None,
            external_command: None,
            external_timeout_seconds: None,
        })
        .expect_err("missing api key should fail before network call");
        match previous {
            Some(value) => env::set_var("DEEPSEEK_API_KEY", value),
            None => env::remove_var("DEEPSEEK_API_KEY"),
        }

        assert!(error.contains("API Key"));
    }

    #[test]
    fn rejects_invalid_model_for_provider() {
        let context = QueryContext {
            current_path: "/tmp/topic.md".to_string(),
            current_relative_path: "notes/topic.md".to_string(),
            items: vec![QueryContextItem {
                path: "/tmp/topic.md".to_string(),
                relative_path: "notes/topic.md".to_string(),
                name: "topic.md".to_string(),
                source_kind: "note".to_string(),
                reason: "current_document".to_string(),
                excerpt: "Topic excerpt".to_string(),
            }],
        };

        let error = summarize_assistant_query_context(AssistantRequest {
            provider: "deepseek",
            model: "unsupported-model",
            context: &context,
            current_content: None,
            task: None,
            prompt: None,
            api_key: None,
            base_url: None,
            external_command: None,
            external_timeout_seconds: None,
        })
        .expect_err("invalid model should fail");

        assert!(error.contains("Unsupported model"));
    }

    #[test]
    fn runs_external_command_assistant_provider() {
        let context = QueryContext {
            current_path: "/tmp/topic.md".to_string(),
            current_relative_path: "notes/topic.md".to_string(),
            items: vec![QueryContextItem {
                path: "/tmp/topic.md".to_string(),
                relative_path: "notes/topic.md".to_string(),
                name: "topic.md".to_string(),
                source_kind: "note".to_string(),
                reason: "current_document".to_string(),
                excerpt: "Topic excerpt".to_string(),
            }],
        };
        let script_path = temp_workspace_path("assistant-command").with_extension("sh");
        let mut script = fs::File::create(&script_path).expect("create assistant command");
        writeln!(
            script,
            "#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '{{\"title\":\"external summary\",\"content\":\"# external summary\\n\\n## Summary\\n\\nFrom command.\"}}'"
        )
        .expect("write assistant command");
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(&script_path)
                .expect("assistant command metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&script_path, permissions).expect("chmod assistant command");
        }

        let draft = summarize_assistant_query_context(AssistantRequest {
            provider: "external_command",
            model: "command-json-v1",
            context: &context,
            current_content: Some("# Topic\n\nBody"),
            task: Some("summarize"),
            prompt: Some("Make it short."),
            api_key: None,
            base_url: None,
            external_command: Some(script_path.to_string_lossy().as_ref()),
            external_timeout_seconds: Some(30),
        })
        .expect("external command summary");

        assert_eq!(draft.title, "external summary");
        assert!(draft.content.contains("From command."));
        fs::remove_file(script_path).expect("remove assistant command");
    }

    #[test]
    fn exposes_assistant_catalog() {
        let catalog = assistant_catalog_state();

        assert_eq!(catalog.default_provider, "deepseek");
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "deepseek"));
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "minimax"));
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "kimi"));
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "zhipu"));
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "external_command"
                && provider
                    .models
                    .iter()
                    .any(|model| model == "command-json-v1")));
    }

    #[test]
    fn exports_markdown_as_pdf_bytes() {
        let pdf = pdf_document("# Title\n\n- [x] Done\n\n```rust\nlet x = 1;\n```");
        let text = String::from_utf8_lossy(&pdf);

        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/BaseFont /Helvetica-Bold"));
        assert!(text.contains("/BaseFont /Courier"));
        assert!(text.contains("(Title) Tj"));
        assert!(text.contains("([x] Done) Tj"));
        assert!(text.contains("(let x = 1;) Tj"));
        assert!(text.ends_with("%%EOF\n"));
    }
}
