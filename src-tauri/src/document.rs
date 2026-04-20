use std::{
    collections::HashMap,
    fs::{self, File},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use memmap2::Mmap;
use serde::Serialize;

const LARGE_FILE_THRESHOLD_BYTES: u64 = 5 * 1024 * 1024;
const DEFAULT_WINDOW_LINES: usize = 600;

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
    path: String,
    byte_size: usize,
    line_count: usize,
    modified_ms: Option<u64>,
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
) -> Result<SaveResult, String> {
    fs::write(target_path, content)
        .map_err(|error| format!("Could not save {}: {error}", target_path.display()))?;
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
