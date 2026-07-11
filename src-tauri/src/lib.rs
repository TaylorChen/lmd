use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};

mod assistant;
mod document;
mod export;
mod git;
mod knowledge;
mod workspace;

#[cfg(target_os = "macos")]
const APP_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

struct AppState {
    documents: document::DocumentCache,
    zoom_factor: Mutex<f64>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            documents: document::DocumentCache::default(),
            zoom_factor: Mutex::new(1.0),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantStreamDelta {
    request_id: String,
    delta: String,
}

const MARKDOWN_MENU_EVENT: &str = "lmd://markdown-action";
const APP_MENU_EVENT: &str = "lmd://app-menu-action";

const KEYCHAIN_SERVICE: &str = "org.lmd.assistant";

fn markdown_menu_item(
    app: &tauri::AppHandle,
    action: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, format!("markdown:{action}"), label, true, accelerator)
}

fn app_menu_item(
    app: &tauri::AppHandle,
    action: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, format!("app:{action}"), label, true, accelerator)
}

fn checked_app_menu_item(
    app: &tauri::AppHandle,
    action: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<CheckMenuItem<tauri::Wry>> {
    CheckMenuItem::with_id(
        app,
        format!("app:{action}"),
        label,
        true,
        false,
        accelerator,
    )
}

#[cfg(target_os = "macos")]
fn lmd_about_metadata(
    app: &tauri::AppHandle,
) -> tauri::Result<tauri::menu::AboutMetadata<'static>> {
    let package_info = app.package_info();
    Ok(tauri::menu::AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        short_version: Some(package_info.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        icon: Some(tauri::image::Image::from_bytes(APP_ICON_PNG)?),
        ..Default::default()
    })
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::default(app)?;
    let knowledge_menu = Submenu::with_items(
        app,
        "Knowledge",
        true,
        &[
            &app_menu_item(app, "create-wiki-page", "新建 Wiki 页面", None)?,
            &app_menu_item(app, "initialize-knowledge", "初始化知识库", None)?,
            &app_menu_item(app, "rebuild-knowledge-index", "重建知识索引", None)?,
            &app_menu_item(app, "refresh-workspace", "刷新工作区", None)?,
            &PredefinedMenuItem::separator(app)?,
            &app_menu_item(app, "history-snapshots", "查看保存快照", None)?,
            &app_menu_item(app, "rename-tag", "重命名标签", None)?,
            &PredefinedMenuItem::separator(app)?,
            &app_menu_item(app, "git-status", "刷新 Git 状态", None)?,
            &app_menu_item(app, "git-commit", "提交 Git 改动", None)?,
        ],
    )?;
    let ai_menu = Submenu::with_items(
        app,
        "AI",
        true,
        &[
            &app_menu_item(app, "ai-summarize", "总结笔记", None)?,
            &app_menu_item(app, "ai-polish", "优化文字", None)?,
            &app_menu_item(app, "ai-todos", "提取待办", None)?,
            &app_menu_item(app, "ai-title", "生成标题", None)?,
            &app_menu_item(app, "ai-outline", "生成大纲", None)?,
            &app_menu_item(app, "ai-continue", "续写", None)?,
            &PredefinedMenuItem::separator(app)?,
            &app_menu_item(app, "ai-save-draft", "保存 AI 草稿", None)?,
            &app_menu_item(app, "ai-save-chat", "保存 AI 对话", None)?,
            &app_menu_item(app, "ai-run-log", "运行日志", None)?,
            &app_menu_item(app, "ai-test-connection", "测试 AI 连接", None)?,
        ],
    )?;
    let insert_menu = Submenu::with_items(
        app,
        "Insert",
        true,
        &[
            &markdown_menu_item(app, "link", "链接", None)?,
            &markdown_menu_item(app, "markdown-link", "Markdown 链接", Some("CmdOrCtrl+K"))?,
            &markdown_menu_item(app, "annotation", "标注", None)?,
            &PredefinedMenuItem::separator(app)?,
            &markdown_menu_item(app, "code-block", "代码块", None)?,
            &markdown_menu_item(app, "math-block", "数学块", None)?,
            &markdown_menu_item(app, "footnote", "脚注", None)?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "表格",
                true,
                &[
                    &markdown_menu_item(app, "table", "插入表格", None)?,
                    &markdown_menu_item(app, "format-table", "对齐表格", None)?,
                    &markdown_menu_item(app, "table-row", "加行", None)?,
                    &markdown_menu_item(app, "table-column", "加列", None)?,
                    &markdown_menu_item(app, "csv-table", "CSV 表格", None)?,
                ],
            )?,
            &PredefinedMenuItem::separator(app)?,
            &markdown_menu_item(app, "unordered-list", "无序列表", None)?,
            &markdown_menu_item(app, "ordered-list", "有序列表", None)?,
            &markdown_menu_item(app, "task-list", "任务列表", Some("CmdOrCtrl+L"))?,
            &PredefinedMenuItem::separator(app)?,
            &markdown_menu_item(app, "block-id", "块 ID", None)?,
            &markdown_menu_item(app, "block-ref", "块引用", None)?,
            &PredefinedMenuItem::separator(app)?,
            &app_menu_item(app, "insert-attachment", "插入附件...", None)?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "折叠",
                true,
                &[
                    &markdown_menu_item(app, "fold-all", "折叠全部", None)?,
                    &markdown_menu_item(app, "unfold-all", "展开全部", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &markdown_menu_item(app, "fold-current", "折叠", None)?,
                    &markdown_menu_item(app, "unfold-current", "展开", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &markdown_menu_item(app, "fold-block", "插入折叠块", None)?,
                ],
            )?,
        ],
    )?;
    let format_menu = Submenu::with_items(
        app,
        "Format",
        true,
        &[
            &markdown_menu_item(app, "h1", "小标题 1", Some("CmdOrCtrl+1"))?,
            &markdown_menu_item(app, "h2", "小标题 2", Some("CmdOrCtrl+2"))?,
            &markdown_menu_item(app, "h3", "小标题 3", Some("CmdOrCtrl+3"))?,
            &markdown_menu_item(app, "h4", "小标题 4", Some("CmdOrCtrl+4"))?,
            &markdown_menu_item(app, "h5", "小标题 5", Some("CmdOrCtrl+5"))?,
            &markdown_menu_item(app, "h6", "小标题 6", Some("CmdOrCtrl+6"))?,
            &markdown_menu_item(app, "no-heading", "无小标题", None)?,
            &PredefinedMenuItem::separator(app)?,
            &markdown_menu_item(app, "bold", "加粗", Some("CmdOrCtrl+B"))?,
            &markdown_menu_item(app, "italic", "斜体", Some("CmdOrCtrl+I"))?,
            &markdown_menu_item(app, "code-block", "代码块", None)?,
            &markdown_menu_item(app, "highlight", "高亮", None)?,
            &PredefinedMenuItem::separator(app)?,
            &markdown_menu_item(app, "strikethrough", "删除线", None)?,
            &markdown_menu_item(app, "math-inline", "数学", None)?,
            &markdown_menu_item(app, "comment", "注释", None)?,
        ],
    )?;
    menu.insert(&insert_menu, 3)?;
    menu.insert(&format_menu, 4)?;
    menu.insert(&knowledge_menu, 5)?;
    menu.insert(&ai_menu, 6)?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            #[cfg(target_os = "macos")]
            if submenu.text()? == app.package_info().name {
                let _ = submenu.remove_at(0)?;
                submenu.insert(
                    &PredefinedMenuItem::about(app, None, Some(lmd_about_metadata(app)?))?,
                    0,
                )?;
                continue;
            }

            if submenu.text()? == "File" {
                submenu.prepend_items(&[
                    &app_menu_item(app, "new-markdown", "新建 Markdown", Some("CmdOrCtrl+N"))?,
                    &app_menu_item(app, "open-file", "打开 Markdown...", Some("CmdOrCtrl+O"))?,
                    &app_menu_item(
                        app,
                        "open-workspace",
                        "打开工作区...",
                        Some("Shift+CmdOrCtrl+O"),
                    )?,
                    &app_menu_item(app, "show-recent", "最近项目", None)?,
                    &app_menu_item(app, "daily-note", "打开今日笔记", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "save", "保存", Some("CmdOrCtrl+S"))?,
                    &app_menu_item(app, "rename-current", "重命名当前文件", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "command-palette", "命令面板", Some("CmdOrCtrl+K"))?,
                    &app_menu_item(app, "settings", "设置...", Some("CmdOrCtrl+,"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "export-html", "导出 HTML", None)?,
                    &app_menu_item(app, "export-pdf", "导出 PDF", None)?,
                    &app_menu_item(app, "export-docx", "导出 DOCX", None)?,
                    &PredefinedMenuItem::separator(app)?,
                ])?;
            } else if submenu.text()? == "Edit" {
                submenu.append_items(&[
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(
                        app,
                        "focus-document-search",
                        "在文档中查找",
                        Some("CmdOrCtrl+F"),
                    )?,
                ])?;
            } else if submenu.text()? == "View" {
                submenu.prepend_items(&[
                    &checked_app_menu_item(app, "view-preview", "阅读视图", Some("CmdOrCtrl+E"))?,
                    &checked_app_menu_item(app, "view-source", "源码模式", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &checked_app_menu_item(app, "toggle-left-panel", "折叠/展开左侧边栏", None)?,
                    &checked_app_menu_item(app, "toggle-right-panel", "折叠/展开右侧边栏", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &checked_app_menu_item(app, "toggle-feature-area", "显示/隐藏功能区", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &checked_app_menu_item(app, "split-none", "取消分屏", None)?,
                    &checked_app_menu_item(app, "split-vertical", "左右分屏", None)?,
                    &checked_app_menu_item(app, "split-horizontal", "上下分屏", None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "navigate-back", "后退", Some("Alt+CmdOrCtrl+Left"))?,
                    &app_menu_item(app, "navigate-forward", "前进", Some("Alt+CmdOrCtrl+Right"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "zoom-actual", "Actual Size", Some("CmdOrCtrl+0"))?,
                    &app_menu_item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
                    &app_menu_item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
                    &PredefinedMenuItem::separator(app)?,
                    &app_menu_item(app, "reload", "Force Reload", Some("CmdOrCtrl+R"))?,
                    &app_menu_item(
                        app,
                        "toggle-developer-tools",
                        "Toggle Developer Tools",
                        Some("Alt+CmdOrCtrl+I"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                ])?;
            }
        }
    }
    Ok(menu)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuState {
    editor_mode: String,
    left_panel_open: bool,
    right_panel_open: bool,
    feature_area_open: bool,
    split_orientation: String,
}

fn find_check_menu_item(
    items: Vec<MenuItemKind<tauri::Wry>>,
    id: &str,
) -> Option<CheckMenuItem<tauri::Wry>> {
    for item in items {
        if item.id().0.as_str() == id {
            if let MenuItemKind::Check(check_item) = item {
                return Some(check_item);
            }
            return None;
        }
        if let MenuItemKind::Submenu(submenu) = item {
            if let Ok(items) = submenu.items() {
                if let Some(check_item) = find_check_menu_item(items, id) {
                    return Some(check_item);
                }
            }
        }
    }
    None
}

fn set_checked_menu_item(app: &tauri::AppHandle, action: &str, checked: bool) -> tauri::Result<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let id = format!("app:{action}");
    if let Some(item) = find_check_menu_item(menu.items()?, &id) {
        item.set_checked(checked)?;
    }
    Ok(())
}

fn active_webview(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
}

fn handle_native_view_menu(app: &tauri::AppHandle, action: &str) -> tauri::Result<bool> {
    let Some(webview) = active_webview(app) else {
        return Ok(false);
    };

    if action == "reload" {
        webview.reload()?;
        return Ok(true);
    }

    if action == "toggle-developer-tools" {
        if webview.is_devtools_open() {
            webview.close_devtools();
        } else {
            webview.open_devtools();
        }
        return Ok(true);
    }

    if matches!(action, "zoom-actual" | "zoom-in" | "zoom-out") {
        let state = app.state::<AppState>();
        let mut zoom = state
            .zoom_factor
            .lock()
            .map_err(|_| tauri::Error::FailedToReceiveMessage)?;
        *zoom = match action {
            "zoom-actual" => 1.0,
            "zoom-in" => (*zoom + 0.1).min(2.0),
            "zoom-out" => (*zoom - 0.1).max(0.5),
            _ => *zoom,
        };
        webview.set_zoom(*zoom)?;
        return Ok(true);
    }

    Ok(false)
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

#[cfg(target_os = "macos")]
fn keychain_command(args: &[&str]) -> Result<std::process::Output, String> {
    std::process::Command::new("security")
        .args(args)
        .output()
        .map_err(|error| format!("无法访问 macOS Keychain：{error}"))
}

#[tauri::command]
fn save_assistant_api_key(provider: String, api_key: String) -> Result<(), String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return Err("Provider is required.".to_string());
    }
    if api_key.trim().is_empty() {
        return delete_assistant_api_key(provider.to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let output = keychain_command(&[
            "add-generic-password",
            "-a",
            provider,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
            api_key.trim(),
            "-U",
        ])?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "无法保存 API Key 到 Keychain。".to_string()
        } else {
            format!("无法保存 API Key 到 Keychain：{stderr}")
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("当前平台暂不支持系统 Keychain。".to_string())
    }
}

#[tauri::command]
fn load_assistant_api_key(provider: String) -> Result<Option<String>, String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return Ok(None);
    }

    #[cfg(target_os = "macos")]
    {
        let output = keychain_command(&[
            "find-generic-password",
            "-a",
            provider,
            "-s",
            KEYCHAIN_SERVICE,
            "-w",
        ])?;
        if output.status.success() {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!value.is_empty()).then_some(value));
        }
        return Ok(None);
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn delete_assistant_api_key(provider: String) -> Result<(), String> {
    let provider = provider.trim();
    if provider.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let output = keychain_command(&[
            "delete-generic-password",
            "-a",
            provider,
            "-s",
            KEYCHAIN_SERVICE,
        ])?;
        if output.status.success() {
            return Ok(());
        }
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
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

    workspace::load_workspace(&root_path).map(Some)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DropPathInfo {
    path: String,
    kind: String,
}

fn inspect_drop_path_value(path: &Path) -> Result<DropPathInfo, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("无法读取 {}：{error}", path.display()))?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
    {
        "markdown"
    } else {
        "unsupported"
    };
    Ok(DropPathInfo {
        path: path.to_string_lossy().into_owned(),
        kind: kind.into(),
    })
}

fn open_workspace_path_value(root_path: &Path) -> Result<workspace::Workspace, String> {
    workspace::load_workspace(root_path)
}

#[tauri::command]
fn inspect_drop_path(path: String) -> Result<DropPathInfo, String> {
    inspect_drop_path_value(&PathBuf::from(path))
}

#[tauri::command]
fn open_workspace_path(root_path: String) -> Result<workspace::Workspace, String> {
    open_workspace_path_value(&PathBuf::from(root_path))
}

#[tauri::command]
fn refresh_workspace(root_path: String) -> Result<workspace::Workspace, String> {
    let root_path = PathBuf::from(root_path);
    workspace::load_workspace(&root_path)
}

#[tauri::command]
fn git_workspace_status(
    root_path: String,
    current_path: Option<String>,
) -> Result<git::GitStatus, String> {
    let current = current_path.as_deref().map(PathBuf::from);
    git::workspace_status(&PathBuf::from(root_path), current.as_deref())
}

#[tauri::command]
fn git_commit_workspace(root_path: String, message: String) -> Result<git::GitStatus, String> {
    git::commit_workspace(&PathBuf::from(root_path), &message)
}

#[tauri::command]
fn initialize_knowledge_workspace(root_path: String) -> Result<workspace::Workspace, String> {
    workspace::initialize_knowledge_workspace(&PathBuf::from(root_path))
}

#[tauri::command]
fn initialize_knowledge_index(
    root_path: String,
) -> Result<knowledge::KnowledgeIndexStatus, String> {
    let root = PathBuf::from(root_path);
    let files = workspace::scan_workspace(&root)?;
    knowledge::ensure_index(&root, &files)
}

#[tauri::command]
fn rebuild_knowledge_index(root_path: String) -> Result<knowledge::KnowledgeIndexStatus, String> {
    let root = PathBuf::from(root_path);
    let files = workspace::scan_workspace(&root)?;
    knowledge::rebuild_index(&root, &files)
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
fn rename_workspace_tag(
    root_path: String,
    old_tag: String,
    new_tag: String,
) -> Result<workspace::TagRenameResult, String> {
    workspace::rename_workspace_tag(&PathBuf::from(root_path), &old_tag, &new_tag)
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
async fn test_assistant_connection(
    provider: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    base_url: Option<String>,
    external_command: Option<String>,
    external_timeout_seconds: Option<u64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let context = workspace::QueryContext {
            current_path: "connection-test.md".to_string(),
            current_relative_path: "connection-test.md".to_string(),
            items: Vec::new(),
        };
        let request = assistant::AssistantRequest {
            provider: provider.as_deref().unwrap_or(assistant::DEFAULT_PROVIDER),
            model: model.as_deref().unwrap_or(assistant::DEFAULT_MODEL),
            context: &context,
            current_content: Some("# Connection Test\n\n请回复 OK。"),
            task: Some("summarize"),
            prompt: Some("请只回复 OK，用于测试 LMD AI 配置是否可用。"),
            api_key: api_key.as_deref(),
            base_url: base_url.as_deref(),
            external_command: external_command.as_deref(),
            external_timeout_seconds: Some(external_timeout_seconds.unwrap_or(30).min(60)),
        };
        let draft = assistant::summarize_query_context(request)?;
        if draft.content.trim().is_empty() {
            return Err("AI 返回为空。".to_string());
        }
        Ok("AI 连接测试成功。".to_string())
    })
    .await
    .map_err(|error| format!("Assistant connection test failed: {error}"))?
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
    root_path: Option<String>,
    content: String,
    expected_modified_ms: Option<u64>,
) -> Result<Option<document::SaveResult>, String> {
    let (target_path, expected_modified_ms) = match path {
        Some(path) if !path.trim().is_empty() => (PathBuf::from(path), expected_modified_ms),
        _ => {
            let Some(path) = rfd::FileDialog::new()
                .add_filter("Markdown", &["md", "markdown"])
                .set_file_name("untitled.md")
                .save_file()
            else {
                return Ok(None);
            };
            // A chosen "save as" target has no prior known mtime to guard against.
            (path, None)
        }
    };

    let root = root_path.as_deref().map(PathBuf::from);
    document::save_markdown_file(
        &state.documents,
        &target_path,
        &content,
        root.as_deref(),
        expected_modified_ms,
    )
    .map(Some)
}

#[tauri::command]
fn list_history_snapshots(
    path: String,
    root_path: Option<String>,
    limit: usize,
) -> Result<Vec<document::HistorySnapshot>, String> {
    let root = root_path.as_deref().map(PathBuf::from);
    document::list_history_snapshots(&PathBuf::from(path), root.as_deref(), limit)
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
fn create_folder(root_path: String, directory: String) -> Result<String, String> {
    document::create_folder(&PathBuf::from(root_path), &directory)
}

fn normalized_daily_date(input: &str) -> String {
    let trimmed = input.trim();
    if is_iso_date(trimmed) {
        return trimmed.to_string();
    }
    if trimmed.chars().all(|character| character.is_ascii_digit()) {
        if let Ok(raw_timestamp) = trimmed.parse::<i64>() {
            let seconds = if trimmed.len() >= 13 {
                raw_timestamp / 1000
            } else {
                raw_timestamp
            };
            return date_from_unix_seconds(seconds);
        }
    }
    let now_seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    date_from_unix_seconds(now_seconds)
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn date_from_unix_seconds(seconds: i64) -> String {
    let days = seconds.div_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096).div_euclid(365);
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2).div_euclid(153);
    let day = doy - (153 * mp + 2).div_euclid(5) + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };
    (year, month as u32, day as u32)
}

#[tauri::command]
fn open_daily_note(
    state: tauri::State<'_, AppState>,
    root_path: String,
    date: String,
) -> Result<document::MarkdownDocument, String> {
    let date = normalized_daily_date(&date);
    let daily_path = PathBuf::from(&root_path)
        .join("daily")
        .join(format!("{date}.md"));
    if daily_path.exists() {
        return document::open_markdown_path(&state.documents, &daily_path);
    }
    let title = format!("Daily {date}");
    let content = format!("# {title}\n\n## 记录\n\n- \n");
    let result = document::create_markdown_file(
        &state.documents,
        &PathBuf::from(&root_path),
        "daily",
        &format!("{date}.md"),
        &content,
    )?;
    document::open_markdown_path(&state.documents, &PathBuf::from(result.path))
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
fn delete_markdown_file(state: tauri::State<'_, AppState>, path: String) -> Result<(), String> {
    document::delete_markdown_file(&state.documents, &PathBuf::from(path))
}

#[tauri::command]
fn delete_folder(root_path: String, directory: String) -> Result<(), String> {
    document::delete_folder(&PathBuf::from(root_path), &directory)
}

#[tauri::command]
fn move_markdown_file(
    state: tauri::State<'_, AppState>,
    root_path: String,
    path: String,
    target_directory: String,
) -> Result<document::SaveResult, String> {
    document::move_markdown_file(
        &state.documents,
        &PathBuf::from(root_path),
        &PathBuf::from(path),
        &target_directory,
    )
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .status()
            .map_err(|error| format!("Could not reveal {}: {error}", path.display()))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let target = path.parent().unwrap_or(&path);
        let command = if cfg!(target_os = "windows") {
            "explorer"
        } else {
            "xdg-open"
        };
        std::process::Command::new(command)
            .arg(target)
            .status()
            .map_err(|error| format!("Could not open {}: {error}", target.display()))?;
        Ok(())
    }
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
fn import_pasted_attachment(
    root_path: Option<String>,
    current_path: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<document::AttachmentImportResult, String> {
    let root = root_path.as_deref().map(PathBuf::from);
    let current = current_path.as_deref().map(PathBuf::from);
    document::import_attachment_bytes(root.as_deref(), current.as_deref(), &file_name, &bytes)
}

#[tauri::command]
fn open_history_snapshot(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<document::MarkdownDocument, String> {
    document::open_markdown_path(&state.documents, &PathBuf::from(path))
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

#[tauri::command]
fn export_markdown_docx(path: Option<String>, content: String) -> Result<Option<String>, String> {
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
        .add_filter("Word Document", &["docx"])
        .set_file_name(format!("{default_name}.docx"))
        .save_file()
    else {
        return Ok(None);
    };

    export::export_docx_document(&target_path, &content).map(Some)
}

#[tauri::command]
fn update_native_menu_state(app: tauri::AppHandle, state: NativeMenuState) -> Result<(), String> {
    let is_preview = state.editor_mode == "preview";
    let is_source = state.editor_mode == "edit";
    let is_split = state.editor_mode == "split";
    set_checked_menu_item(&app, "view-preview", is_preview).map_err(|error| error.to_string())?;
    set_checked_menu_item(&app, "view-source", is_source).map_err(|error| error.to_string())?;
    set_checked_menu_item(
        &app,
        "split-vertical",
        is_split && state.split_orientation == "vertical",
    )
    .map_err(|error| error.to_string())?;
    set_checked_menu_item(
        &app,
        "split-horizontal",
        is_split && state.split_orientation == "horizontal",
    )
    .map_err(|error| error.to_string())?;
    set_checked_menu_item(&app, "split-none", !is_split).map_err(|error| error.to_string())?;
    set_checked_menu_item(&app, "toggle-left-panel", state.left_panel_open)
        .map_err(|error| error.to_string())?;
    set_checked_menu_item(&app, "toggle-right-panel", state.right_panel_open)
        .map_err(|error| error.to_string())?;
    set_checked_menu_item(&app, "toggle-feature-area", state.feature_area_open)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin. A second launch focuses the running window instead
        // of opening a rival instance that would fight over the workspace and its index.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(AppState::default())
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(action) = id.strip_prefix("markdown:") {
                let _ = app.emit(MARKDOWN_MENU_EVENT, action);
            } else if let Some(action) = id.strip_prefix("app:") {
                if !handle_native_view_menu(app, action).unwrap_or(false) {
                    let _ = app.emit(APP_MENU_EVENT, action);
                }
            }
        })
        .setup(|_app| {
            set_macos_application_icon();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            document_stats,
            document_knowledge,
            export_markdown_docx,
            export_markdown_html,
            export_markdown_pdf,
            git_commit_workspace,
            git_workspace_status,
            assistant_catalog,
            create_markdown_file,
            create_folder,
            delete_assistant_api_key,
            delete_folder,
            delete_markdown_file,
            file_metadata,
            import_attachment,
            import_pasted_attachment,
            list_history_snapshots,
            load_assistant_api_key,
            load_markdown_range,
            initialize_knowledge_index,
            initialize_knowledge_workspace,
            knowledge_lint_report,
            move_markdown_file,
            open_history_snapshot,
            open_markdown_file,
            open_markdown_path,
            open_daily_note,
            open_workspace,
            open_workspace_path,
            inspect_drop_path,
            query_context,
            rebuild_knowledge_index,
            refresh_workspace,
            rename_markdown_file,
            rename_workspace_tag,
            reveal_in_finder,
            save_wiki_draft,
            search_workspace,
            save_assistant_api_key,
            summarize_editor_context,
            summarize_query_context,
            test_assistant_connection,
            update_native_menu_state,
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
        query_context, rename_workspace_tag, save_wiki_draft, scan_workspace,
        search_workspace_files, QueryContext, QueryContextItem,
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
    fn normalizes_daily_note_dates() {
        assert_eq!(super::normalized_daily_date("2026-05-07"), "2026-05-07");
        assert_eq!(super::normalized_daily_date("1778164463273"), "2026-05-07");
    }

    #[test]
    fn inspects_drop_paths_and_opens_workspace_by_path() {
        let root = temp_workspace_path("drop-paths");
        fs::create_dir_all(&root).expect("create root");
        let markdown = root.join("alpha.MARKDOWN");
        let unsupported = root.join("image.png");
        fs::write(&markdown, "# Alpha").expect("write markdown");
        fs::write(&unsupported, "png").expect("write unsupported");

        assert_eq!(
            super::inspect_drop_path_value(&root)
                .expect("inspect directory")
                .kind,
            "directory"
        );
        assert_eq!(
            super::inspect_drop_path_value(&markdown)
                .expect("inspect markdown")
                .kind,
            "markdown"
        );
        assert_eq!(
            super::inspect_drop_path_value(&unsupported)
                .expect("inspect unsupported")
                .kind,
            "unsupported"
        );
        assert!(super::inspect_drop_path_value(&root.join("missing.md")).is_err());

        let workspace = super::open_workspace_path_value(&root).expect("open workspace");
        assert_eq!(workspace.root_path, root.to_string_lossy());
        fs::remove_dir_all(root).expect("remove root");
    }

    #[test]
    fn saves_and_reopens_real_markdown_file() {
        let cache = DocumentCache::default();
        let path = temp_markdown_path("save-open");
        let content = "# Saved\n\nBody text";

        let save_result =
            save_markdown_file(&cache, &path, content, None, None).expect("save markdown");
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
    fn writes_history_snapshot_before_overwriting_markdown() {
        let cache = DocumentCache::default();
        let root = temp_workspace_path("history");
        fs::create_dir_all(&root).expect("create history workspace");
        let path = root.join("note.md");

        save_markdown_file(&cache, &path, "# First", Some(&root), None).expect("initial save");
        save_markdown_file(&cache, &path, "# Second", Some(&root), None).expect("second save");

        let snapshots =
            super::document::list_history_snapshots(&path, Some(&root), 8).expect("list snapshots");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(
            fs::read_to_string(&snapshots[0].path).expect("read snapshot"),
            "# First"
        );

        fs::remove_dir_all(root).expect("remove history workspace");
    }

    #[test]
    fn rejects_save_when_disk_modified_time_differs() {
        let cache = DocumentCache::default();
        let path = temp_markdown_path("conflict");

        let first = save_markdown_file(&cache, &path, "# First", None, None).expect("initial save");
        let stale = first.modified_ms.map(|value| value.saturating_sub(1000));

        // A save guarded by a stale mtime must be refused, not silently overwrite.
        let conflict = save_markdown_file(&cache, &path, "# Second", None, stale)
            .expect_err("stale save should conflict");
        assert!(conflict.starts_with(super::document::SAVE_CONFLICT_PREFIX));
        assert_eq!(fs::read_to_string(&path).expect("read file"), "# First");

        // Saving with the correct known mtime succeeds.
        save_markdown_file(&cache, &path, "# Second", None, first.modified_ms)
            .expect("matching mtime save");
        assert_eq!(fs::read_to_string(&path).expect("read file"), "# Second");

        fs::remove_file(path).expect("remove conflict file");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_preserves_existing_file_permissions() {
        let cache = DocumentCache::default();
        let path = temp_markdown_path("permissions");
        fs::write(&path, "# First").expect("create markdown");
        let mut permissions = fs::metadata(&path).expect("inspect markdown").permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&path, permissions).expect("restrict markdown permissions");

        save_markdown_file(&cache, &path, "# Second", None, None).expect("save markdown");

        assert_eq!(
            fs::metadata(&path)
                .expect("inspect saved markdown")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_file(path).expect("remove markdown");
    }

    #[test]
    fn rejects_guarded_save_when_file_was_deleted() {
        let cache = DocumentCache::default();
        let path = temp_markdown_path("deleted-conflict");
        let first = save_markdown_file(&cache, &path, "# First", None, None).expect("initial save");
        fs::remove_file(&path).expect("delete markdown");

        let conflict = save_markdown_file(&cache, &path, "# Second", None, first.modified_ms)
            .expect_err("deleted file should conflict");
        assert!(conflict.starts_with(super::document::SAVE_CONFLICT_PREFIX));
        assert!(!path.exists());
    }

    #[test]
    fn searches_workspace_by_block_id() {
        let root = temp_workspace_path("block-search");
        fs::create_dir_all(root.join("notes")).expect("create notes dir");
        fs::write(
            root.join("notes/topic.md"),
            "# Topic\n\nImportant paragraph ^block-alpha\n",
        )
        .expect("write topic");

        let matches =
            search_workspace_files(&root, "block:^block-alpha", 8).expect("search block id");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].relative_path, "notes/topic.md");

        fs::remove_dir_all(root).expect("remove block workspace");
    }

    #[test]
    fn searches_initialized_workspace_with_chinese_terms() {
        let root = temp_workspace_path("chinese-search");
        initialize_knowledge_workspace(&root).expect("initialize knowledge workspace");
        fs::write(
            root.join("notes/order.md"),
            "# 订单流程\n\n用户下单后进入支付流程。\n",
        )
        .expect("write chinese note");

        let matches = search_workspace_files(&root, "下单", 8).expect("search chinese term");

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].relative_path, "notes/order.md");
        assert_eq!(matches[0].line_number, 3);

        fs::remove_dir_all(root).expect("remove chinese workspace");
    }

    #[test]
    fn renames_workspace_tags_in_frontmatter_and_body() {
        let root = temp_workspace_path("rename-tag");
        fs::create_dir_all(root.join("notes")).expect("create notes dir");
        let path = root.join("notes/topic.md");
        fs::write(
            &path,
            "---\ntags: [focus, draft]\n---\n# Topic\n\n#focus #other\n",
        )
        .expect("write topic");

        let result = rename_workspace_tag(&root, "focus", "deep-work").expect("rename tag");
        assert_eq!(result.files_changed, 1);
        assert_eq!(result.replacements, 2);
        let content = fs::read_to_string(&path).expect("read renamed content");
        assert!(content.contains("tags: [deep-work, draft]"));
        assert!(content.contains("#deep-work #other"));

        fs::remove_dir_all(root).expect("remove rename workspace");
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
        assert!(root.join(".lmd/knowledge/lmd.db").is_file());
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
    fn resolves_wiki_links_by_frontmatter_alias() {
        let root = temp_workspace_path("knowledge-alias");
        initialize_knowledge_workspace(&root).expect("initialize workspace");
        fs::write(
            root.join("notes/alpha.md"),
            "# Alpha\n\nAlias link to [[Second Brain]].",
        )
        .expect("write alpha");
        fs::write(
            root.join("wiki/concepts/pkm.md"),
            "---\ntitle: PKM\naliases: [Second Brain]\n---\n# PKM\n",
        )
        .expect("write pkm");

        let knowledge = document_knowledge(&root, &root.join("notes/alpha.md"), None)
            .expect("document knowledge");
        let knowledge_json = to_value(knowledge).expect("serialize knowledge");

        assert_eq!(
            knowledge_json["outgoingLinks"][0]["resolvedRelativePath"],
            "wiki/concepts/pkm.md"
        );
        assert!(knowledge_json["unresolvedLinks"]
            .as_array()
            .expect("unresolved links")
            .is_empty());

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
            .any(|provider| provider.id == "ollama" && provider.api_key_env.is_none()));
        assert!(catalog
            .providers
            .iter()
            .any(|provider| provider.id == "lmstudio" && provider.api_key_env.is_none()));
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
