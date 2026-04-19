use std::{fs, path::PathBuf};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownDocument {
    path: String,
    content: String,
    byte_size: usize,
    line_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    path: String,
    byte_size: usize,
    line_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentStats {
    byte_size: usize,
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

#[tauri::command]
fn document_stats(content: String) -> DocumentStats {
    stats_for(&content)
}

#[tauri::command]
fn open_markdown_file() -> Result<Option<MarkdownDocument>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown", "mdown", "txt"])
        .add_filter("All files", &["*"])
        .pick_file()
    else {
        return Ok(None);
    };

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let stats = stats_for(&content);

    Ok(Some(MarkdownDocument {
        path: path.to_string_lossy().to_string(),
        content,
        byte_size: stats.byte_size,
        line_count: stats.line_count,
    }))
}

#[tauri::command]
fn save_markdown_file(path: Option<String>, content: String) -> Result<Option<SaveResult>, String> {
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
    let stats = stats_for(&content);

    Ok(Some(SaveResult {
        path: target_path.to_string_lossy().to_string(),
        byte_size: stats.byte_size,
        line_count: stats.line_count,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            document_stats,
            open_markdown_file,
            save_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running LMD");
}
