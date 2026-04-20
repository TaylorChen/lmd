use std::{fs, path::Path};

const PDF_PAGE_WIDTH: f32 = 612.0;
const PDF_PAGE_HEIGHT: f32 = 792.0;
const PDF_MARGIN: f32 = 54.0;
const PDF_FONT_SIZE: f32 = 11.0;
const PDF_LINE_HEIGHT: f32 = 16.0;
const PDF_MAX_CHARS_PER_LINE: usize = 86;

pub(crate) fn export_html_document(target_path: &Path, html: &str) -> Result<String, String> {
    fs::write(target_path, html)
        .map_err(|error| format!("Could not export {}: {error}", target_path.display()))?;
    Ok(target_path.to_string_lossy().to_string())
}

fn pdf_escape(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '(' => "\\(".to_string(),
            ')' => "\\)".to_string(),
            '\\' => "\\\\".to_string(),
            '\t' => "    ".to_string(),
            character if character.is_control() => " ".to_string(),
            character if character.is_ascii() => character.to_string(),
            character => character.to_string(),
        })
        .collect()
}

fn markdown_to_pdf_lines(content: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut in_code = false;

    for raw_line in content.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            in_code = !in_code;
            lines.push(String::new());
            continue;
        }

        if in_code {
            lines.push(line.to_string());
            continue;
        }

        if trimmed.is_empty() {
            lines.push(String::new());
            continue;
        }

        let text = if let Some((hashes, title)) = trimmed.split_once(' ') {
            if hashes.chars().all(|character| character == '#') && (1..=6).contains(&hashes.len()) {
                title.to_string()
            } else {
                trimmed.to_string()
            }
        } else if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "))
        {
            format!("• {item}")
        } else if trimmed.starts_with("> ") {
            format!("> {}", trimmed.trim_start_matches("> "))
        } else {
            trimmed.to_string()
        };

        for wrapped in wrap_pdf_line(&text) {
            lines.push(wrapped);
        }
    }

    lines
}

fn wrap_pdf_line(line: &str) -> Vec<String> {
    if line.chars().count() <= PDF_MAX_CHARS_PER_LINE {
        return vec![line.to_string()];
    }

    let mut wrapped = Vec::new();
    let mut current = String::new();

    for word in line.split_whitespace() {
        let next_len =
            current.chars().count() + word.chars().count() + usize::from(!current.is_empty());
        if next_len > PDF_MAX_CHARS_PER_LINE && !current.is_empty() {
            wrapped.push(current);
            current = String::new();
        }

        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }

    if !current.is_empty() {
        wrapped.push(current);
    }

    if wrapped.is_empty() {
        vec![line.to_string()]
    } else {
        wrapped
    }
}

fn pdf_text_stream(lines: &[String]) -> String {
    let mut stream = String::new();
    stream.push_str("BT\n");
    stream.push_str(&format!("/F1 {PDF_FONT_SIZE} Tf\n"));
    stream.push_str(&format!(
        "1 0 0 1 {PDF_MARGIN} {} Tm\n",
        PDF_PAGE_HEIGHT - PDF_MARGIN
    ));

    for line in lines {
        stream.push_str(&format!("({}) Tj\n", pdf_escape(line)));
        stream.push_str(&format!("0 -{PDF_LINE_HEIGHT} Td\n"));
    }

    stream.push_str("ET\n");
    stream
}

pub(crate) fn pdf_document(content: &str) -> Vec<u8> {
    let lines = markdown_to_pdf_lines(content);
    let lines_per_page =
        ((PDF_PAGE_HEIGHT - (PDF_MARGIN * 2.0)) / PDF_LINE_HEIGHT).floor() as usize;
    let pages = lines
        .chunks(lines_per_page.max(1))
        .map(pdf_text_stream)
        .collect::<Vec<_>>();
    let page_count = pages.len().max(1);
    let catalog_id = 1;
    let pages_id = 2;
    let font_id = 3;
    let first_page_id = 4;
    let first_content_id = first_page_id + page_count;
    let mut objects = Vec::new();

    objects.push(format!(
        "{catalog_id} 0 obj\n<< /Type /Catalog /Pages {pages_id} 0 R >>\nendobj\n"
    ));

    let kids = (0..page_count)
        .map(|index| format!("{} 0 R", first_page_id + index))
        .collect::<Vec<_>>()
        .join(" ");
    objects.push(format!(
        "{pages_id} 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {page_count} >>\nendobj\n"
    ));
    objects.push(format!(
        "{font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    ));

    for index in 0..page_count {
        let page_id = first_page_id + index;
        let content_id = first_content_id + index;
        objects.push(format!(
            "{page_id} 0 obj\n<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PDF_PAGE_WIDTH} {PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>\nendobj\n"
        ));
    }

    for (index, stream) in pages.iter().enumerate() {
        let content_id = first_content_id + index;
        objects.push(format!(
            "{content_id} 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            stream.as_bytes().len(),
            stream
        ));
    }

    if pages.is_empty() {
        let content_id = first_content_id;
        let stream = pdf_text_stream(&[String::new()]);
        objects.push(format!(
            "{first_page_id} 0 obj\n<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PDF_PAGE_WIDTH} {PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>\nendobj\n"
        ));
        objects.push(format!(
            "{content_id} 0 obj\n<< /Length {} >>\nstream\n{}endstream\nendobj\n",
            stream.as_bytes().len(),
            stream
        ));
    }

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0usize];
    for object in &objects {
        offsets.push(pdf.len());
        pdf.push_str(object);
    }

    let xref_offset = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n", offsets.len()));
    pdf.push_str("0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!(
        "trailer\n<< /Size {} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
        offsets.len()
    ));

    pdf.into_bytes()
}

pub(crate) fn export_pdf(target_path: &Path, content: &str) -> Result<String, String> {
    fs::write(target_path, pdf_document(content))
        .map_err(|error| format!("Could not export {}: {error}", target_path.display()))?;
    Ok(target_path.to_string_lossy().to_string())
}
