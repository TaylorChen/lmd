use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use memmap2::Mmap;
use serde::Serialize;

const LARGE_FILE_THRESHOLD_BYTES: u64 = 5 * 1024 * 1024;
const DEFAULT_WINDOW_LINES: usize = 600;

/// Prefix that marks a save-conflict error so the frontend can offer to overwrite.
pub(crate) const SAVE_CONFLICT_PREFIX: &str = "save-conflict:";

fn ensure_expected_modified(
    target_path: &Path,
    expected_modified_ms: Option<u64>,
) -> Result<(), String> {
    let Some(expected) = expected_modified_ms else {
        return Ok(());
    };
    let metadata = fs::metadata(target_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!(
                "{SAVE_CONFLICT_PREFIX}{} 已从磁盘中删除。",
                target_path.display()
            )
        } else {
            format!("Could not inspect {}: {error}", target_path.display())
        }
    })?;
    if metadata_modified_ms(&metadata) != Some(expected) {
        return Err(format!(
            "{SAVE_CONFLICT_PREFIX}{} 已在磁盘中被修改。",
            target_path.display()
        ));
    }
    Ok(())
}

/// Write `bytes` to `target_path` atomically: write to a sibling temp file, flush it
/// to disk, then rename over the target. This avoids exposing a partially-written
/// target file and preserves permissions when replacing an existing document.
fn atomic_write(
    target_path: &Path,
    bytes: &[u8],
    expected_modified_ms: Option<u64>,
) -> Result<(), String> {
    let parent = target_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let file_name = target_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("document");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    let temp_path = parent.join(format!(
        ".{file_name}.lmd-tmp-{}-{nonce}",
        std::process::id()
    ));

    let existing_permissions = match fs::metadata(target_path) {
        Ok(metadata) => Some(metadata.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not inspect {}: {error}",
                target_path.display()
            ))
        }
    };

    let write_result = (|| {
        let mut file = File::create(&temp_path)
            .map_err(|error| format!("Could not create {}: {error}", temp_path.display()))?;
        if let Some(permissions) = existing_permissions {
            file.set_permissions(permissions).map_err(|error| {
                format!(
                    "Could not set permissions on {}: {error}",
                    temp_path.display()
                )
            })?;
        }
        file.write_all(bytes)
            .map_err(|error| format!("Could not write {}: {error}", temp_path.display()))?;
        file.sync_all()
            .map_err(|error| format!("Could not flush {}: {error}", temp_path.display()))?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if let Err(error) = ensure_expected_modified(target_path, expected_modified_ms) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temp_path, target_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Could not save {}: {error}", target_path.display()));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct IndexedFile {
    pub(crate) byte_size: usize,
    modified: Option<SystemTime>,
    pub(crate) line_offsets: Vec<usize>,
}

#[derive(Default)]
pub(crate) struct DocumentCache {
    indexed_files: Mutex<HashMap<String, IndexedFile>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownDocument {
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
pub(crate) struct SaveResult {
    pub(crate) path: String,
    pub(crate) byte_size: usize,
    pub(crate) line_count: usize,
    pub(crate) modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistorySnapshot {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) modified_ms: Option<u64>,
    pub(crate) byte_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AttachmentImportResult {
    pub(crate) path: String,
    pub(crate) markdown: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentStats {
    byte_size: usize,
    line_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMetadata {
    exists: bool,
    byte_size: Option<u64>,
    modified_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LineRange {
    pub(crate) content: String,
    pub(crate) start_line: usize,
    pub(crate) line_count: usize,
}

pub(crate) fn stats_for(content: &str) -> DocumentStats {
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

pub(crate) fn file_metadata(path: &Path) -> Result<FileMetadata, String> {
    match fs::metadata(path) {
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

pub(crate) fn build_index(path: &Path) -> Result<IndexedFile, String> {
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

pub(crate) fn read_line_range(
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

pub(crate) fn cached_or_build_index(
    cache: &DocumentCache,
    path: &Path,
) -> Result<IndexedFile, String> {
    let key = path.to_string_lossy().to_string();
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let current_modified = metadata.modified().ok();

    if let Some(index) = cache
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
    cache
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .insert(key, index.clone());
    Ok(index)
}

pub(crate) fn open_markdown_path(
    cache: &DocumentCache,
    path: &Path,
) -> Result<MarkdownDocument, String> {
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

    if metadata.len() > LARGE_FILE_THRESHOLD_BYTES {
        let index = build_index(path)?;
        let range = read_line_range(path, &index, 1, DEFAULT_WINDOW_LINES)?;
        cache
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

pub(crate) fn save_markdown_file(
    cache: &DocumentCache,
    target_path: &Path,
    content: &str,
    root_path: Option<&Path>,
    expected_modified_ms: Option<u64>,
) -> Result<SaveResult, String> {
    ensure_expected_modified(target_path, expected_modified_ms)?;
    write_history_snapshot(target_path, root_path, content)?;
    atomic_write(target_path, content.as_bytes(), expected_modified_ms)?;
    let metadata = fs::metadata(target_path)
        .map_err(|error| format!("Could not inspect {}: {error}", target_path.display()))?;
    cache
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .remove(&target_path.to_string_lossy().to_string());
    let stats = stats_for(content);

    Ok(SaveResult {
        path: target_path.to_string_lossy().to_string(),
        byte_size: stats.byte_size,
        line_count: stats.line_count,
        modified_ms: metadata_modified_ms(&metadata),
    })
}

fn history_root_for(target_path: &Path, root_path: Option<&Path>) -> PathBuf {
    root_path
        .map(|root| root.join(".lmd/history"))
        .or_else(|| {
            target_path
                .parent()
                .map(|parent| parent.join(".lmd/history"))
        })
        .unwrap_or_else(|| PathBuf::from(".lmd/history"))
}

fn history_key_for(target_path: &Path, root_path: Option<&Path>) -> String {
    let relative = root_path
        .and_then(|root| target_path.strip_prefix(root).ok())
        .unwrap_or(target_path);
    let key = relative.to_string_lossy().replace('\\', "/");
    key.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn write_history_snapshot(
    target_path: &Path,
    root_path: Option<&Path>,
    next_content: &str,
) -> Result<(), String> {
    if !target_path.exists() {
        return Ok(());
    }

    let previous_content = fs::read_to_string(target_path).map_err(|error| {
        format!(
            "Could not read previous version of {}: {error}",
            target_path.display()
        )
    })?;
    if previous_content == next_content {
        return Ok(());
    }

    let key = history_key_for(target_path, root_path);
    let snapshot_dir = history_root_for(target_path, root_path).join(key);
    fs::create_dir_all(&snapshot_dir)
        .map_err(|error| format!("Could not create {}: {error}", snapshot_dir.display()))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create history timestamp: {error}"))?
        .as_millis();
    let snapshot_path = snapshot_dir.join(format!("{timestamp}.md"));
    atomic_write(&snapshot_path, previous_content.as_bytes(), None)?;
    Ok(())
}

pub(crate) fn list_history_snapshots(
    target_path: &Path,
    root_path: Option<&Path>,
    limit: usize,
) -> Result<Vec<HistorySnapshot>, String> {
    let key = history_key_for(target_path, root_path);
    let snapshot_dir = history_root_for(target_path, root_path).join(key);
    if !snapshot_dir.exists() {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::new();
    for entry in fs::read_dir(&snapshot_dir)
        .map_err(|error| format!("Could not read {}: {error}", snapshot_dir.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read history entry: {error}"))?;
        let path = entry.path();
        if !is_markdown_extension(&path) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
        snapshots.push(HistorySnapshot {
            name: path
                .file_stem()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "snapshot".to_string()),
            path: path.to_string_lossy().to_string(),
            modified_ms: metadata_modified_ms(&metadata),
            byte_size: metadata.len(),
        });
    }

    snapshots.sort_by(|left, right| right.name.cmp(&left.name));
    snapshots.truncate(limit);
    Ok(snapshots)
}

fn is_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown"
            )
        })
        .unwrap_or(false)
}

fn ensure_markdown_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("请输入文件名。".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("文件名不能包含路径分隔符。".to_string());
    }
    let mut file_name = trimmed.to_string();
    if Path::new(&file_name).extension().is_none() {
        file_name.push_str(".md");
    }
    if !is_markdown_extension(Path::new(&file_name)) {
        return Err("文件名必须使用 .md 或 .markdown 后缀。".to_string());
    }
    Ok(file_name)
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not inspect {}: {error}", root.display()))?;
    let parent = path.parent().unwrap_or(&root);
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Could not inspect {}: {error}", parent.display()))?;
    if !canonical_parent.starts_with(&root) {
        return Err("目标路径必须位于当前工作区内。".to_string());
    }
    Ok(path.to_path_buf())
}

pub(crate) fn create_markdown_file(
    cache: &DocumentCache,
    root: &Path,
    directory: &str,
    name: &str,
    content: &str,
) -> Result<SaveResult, String> {
    let file_name = ensure_markdown_name(name)?;
    let safe_directory = directory.trim().trim_matches('/');
    if safe_directory.contains("..") || safe_directory.contains('\\') {
        return Err("目标目录无效。".to_string());
    }
    let target_dir = if safe_directory.is_empty() {
        root.to_path_buf()
    } else {
        root.join(safe_directory)
    };
    let target_path = ensure_inside_root(root, &target_dir.join(file_name))?;
    if target_path.exists() {
        return Err(format!("{} already exists", target_path.display()));
    }
    save_markdown_file(cache, &target_path, content, Some(root), None)
}

pub(crate) fn create_folder(root: &Path, directory: &str) -> Result<String, String> {
    let safe_directory = directory.trim().trim_matches('/');
    if safe_directory.is_empty() || safe_directory.contains("..") || safe_directory.contains('\\') {
        return Err("目标目录无效。".to_string());
    }
    let target_path = ensure_inside_root(root, &root.join(safe_directory))?;
    fs::create_dir_all(&target_path)
        .map_err(|error| format!("Could not create {}: {error}", target_path.display()))?;
    Ok(target_path.to_string_lossy().to_string())
}

pub(crate) fn rename_markdown_file(
    cache: &DocumentCache,
    path: &Path,
    new_name: &str,
) -> Result<SaveResult, String> {
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if !is_markdown_extension(path) {
        return Err("只能重命名 Markdown 文件。".to_string());
    }
    let file_name = ensure_markdown_name(new_name)?;
    let target_path = path
        .parent()
        .ok_or_else(|| "无法解析当前文件目录。".to_string())?
        .join(file_name);
    if target_path != path && target_path.exists() {
        return Err(format!("{} already exists", target_path.display()));
    }
    fs::rename(path, &target_path)
        .map_err(|error| format!("Could not rename {}: {error}", path.display()))?;
    cache
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .remove(&path.to_string_lossy().to_string());
    let content = fs::read_to_string(&target_path)
        .map_err(|error| format!("Could not read {}: {error}", target_path.display()))?;
    save_markdown_file(cache, &target_path, &content, None, None)
}

pub(crate) fn delete_markdown_file(cache: &DocumentCache, path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if !is_markdown_extension(path) {
        return Err("只能删除 Markdown 文件。".to_string());
    }
    fs::remove_file(path)
        .map_err(|error| format!("Could not delete {}: {error}", path.display()))?;
    cache
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .remove(&path.to_string_lossy().to_string());
    Ok(())
}

pub(crate) fn delete_folder(root: &Path, directory: &str) -> Result<(), String> {
    let safe_directory = directory.trim().trim_matches('/');
    if safe_directory.is_empty() || safe_directory.contains("..") || safe_directory.contains('\\') {
        return Err("目标目录无效。".to_string());
    }
    let target_path = ensure_inside_root(root, &root.join(safe_directory))?;
    if !target_path.is_dir() {
        return Err(format!("{} is not a folder", target_path.display()));
    }
    fs::remove_dir(&target_path)
        .map_err(|error| format!("只能删除空文件夹 {}: {error}", target_path.display()))?;
    Ok(())
}

pub(crate) fn move_markdown_file(
    cache: &DocumentCache,
    root: &Path,
    path: &Path,
    target_directory: &str,
) -> Result<SaveResult, String> {
    if !path.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if !is_markdown_extension(path) {
        return Err("只能移动 Markdown 文件。".to_string());
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve {}: {error}", root.display()))?;
    let source_path = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve {}: {error}", path.display()))?;
    if !source_path.starts_with(&canonical_root) {
        return Err("只能移动当前工作区内的 Markdown 文件。".to_string());
    }
    let safe_directory = target_directory.trim().trim_matches('/');
    if safe_directory.contains("..") || safe_directory.contains('\\') {
        return Err("目标目录无效。".to_string());
    }
    let target_dir = if safe_directory.is_empty() {
        root.to_path_buf()
    } else {
        root.join(safe_directory)
    };
    fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create {}: {error}", target_dir.display()))?;
    let file_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "无法解析文件名。".to_string())?;
    let target_path = ensure_inside_root(root, &target_dir.join(file_name))?;
    if target_path != source_path && target_path.exists() {
        return Err(format!("{} already exists", target_path.display()));
    }
    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("Could not move {}: {error}", source_path.display()))?;
    cache
        .indexed_files
        .lock()
        .map_err(|_| "Could not lock file index cache".to_string())?
        .remove(&source_path.to_string_lossy().to_string());
    let content = fs::read_to_string(&target_path)
        .map_err(|error| format!("Could not read {}: {error}", target_path.display()))?;
    save_markdown_file(cache, &target_path, &content, Some(root), None)
}

fn unique_target_path(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment");
    let extension = path.extension().and_then(OsStr::to_str).unwrap_or("");
    for index in 2..10_000 {
        let next_name = if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        let next = directory.join(next_name);
        if !next.exists() {
            return next;
        }
    }

    directory.join(file_name)
}

fn relative_path(from_directory: &Path, to_path: &Path) -> String {
    let from_components = from_directory.components().collect::<Vec<_>>();
    let to_components = to_path.components().collect::<Vec<_>>();
    let mut common = 0usize;
    while common < from_components.len()
        && common < to_components.len()
        && from_components[common] == to_components[common]
    {
        common += 1;
    }

    let mut parts = Vec::new();
    for component in &from_components[common..] {
        if matches!(component, Component::Normal(_)) {
            parts.push("..".to_string());
        }
    }
    for component in &to_components[common..] {
        if let Component::Normal(value) = component {
            parts.push(value.to_string_lossy().to_string());
        }
    }
    if parts.is_empty() {
        to_path
            .file_name()
            .and_then(OsStr::to_str)
            .unwrap_or("attachment")
            .to_string()
    } else {
        parts.join("/")
    }
}

pub(crate) fn import_attachment(
    root: Option<&Path>,
    current_path: Option<&Path>,
    source_path: &Path,
) -> Result<AttachmentImportResult, String> {
    if !source_path.is_file() {
        return Err(format!("{} is not a file", source_path.display()));
    }

    let base_root = if let Some(root) = root {
        root.to_path_buf()
    } else if let Some(current_path) = current_path.and_then(Path::parent) {
        current_path.to_path_buf()
    } else {
        return Err("请先打开工作区或保存当前文档。".to_string());
    };
    let attachment_dir = base_root.join("attachments");
    fs::create_dir_all(&attachment_dir)
        .map_err(|error| format!("Could not create {}: {error}", attachment_dir.display()))?;
    let original_name = source_path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("attachment");
    let target_path = unique_target_path(&attachment_dir, original_name);
    fs::copy(source_path, &target_path)
        .map_err(|error| format!("Could not copy {}: {error}", source_path.display()))?;

    let current_dir = current_path.and_then(Path::parent).unwrap_or(&base_root);
    let link_target = relative_path(current_dir, &target_path);
    let extension = target_path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let is_image = matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    );
    let label = target_path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment");
    let markdown = if is_image {
        format!("![{label}]({link_target})")
    } else {
        format!("[{label}]({link_target})")
    };

    Ok(AttachmentImportResult {
        path: target_path.to_string_lossy().to_string(),
        markdown,
    })
}

pub(crate) fn import_attachment_bytes(
    root: Option<&Path>,
    current_path: Option<&Path>,
    file_name: &str,
    bytes: &[u8],
) -> Result<AttachmentImportResult, String> {
    if bytes.is_empty() {
        return Err("附件内容为空。".to_string());
    }
    let base_root = if let Some(root) = root {
        root.to_path_buf()
    } else if let Some(current_path) = current_path.and_then(Path::parent) {
        current_path.to_path_buf()
    } else {
        return Err("请先打开工作区或保存当前文档。".to_string());
    };
    let attachment_dir = base_root.join("attachments");
    fs::create_dir_all(&attachment_dir)
        .map_err(|error| format!("Could not create {}: {error}", attachment_dir.display()))?;
    let safe_name = file_name
        .trim()
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "-");
    let safe_name = if safe_name.is_empty() {
        "pasted-image.png".to_string()
    } else {
        safe_name
    };
    let target_path = unique_target_path(&attachment_dir, &safe_name);
    atomic_write(&target_path, bytes, None)?;

    let current_dir = current_path.and_then(Path::parent).unwrap_or(&base_root);
    let link_target = relative_path(current_dir, &target_path);
    let extension = target_path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let is_image = matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    );
    let label = target_path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or("attachment");
    let markdown = if is_image {
        format!("![{label}]({link_target})")
    } else {
        format!("[{label}]({link_target})")
    };

    Ok(AttachmentImportResult {
        path: target_path.to_string_lossy().to_string(),
        markdown,
    })
}
