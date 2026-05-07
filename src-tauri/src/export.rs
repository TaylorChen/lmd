use std::{
    fs,
    io::Write,
    path::Path,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const PDF_PAGE_WIDTH: f32 = 612.0;
const PDF_PAGE_HEIGHT: f32 = 792.0;
const PDF_MARGIN: f32 = 54.0;
const PDF_FONT_SIZE: f32 = 11.0;
const PDF_LINE_HEIGHT: f32 = 16.0;
const PDF_MAX_CHARS_PER_LINE: usize = 86;

#[derive(Clone, Copy)]
enum PdfFont {
    Regular,
    Bold,
    Oblique,
    Mono,
}

impl PdfFont {
    fn resource_name(self) -> &'static str {
        match self {
            Self::Regular => "F1",
            Self::Bold => "F2",
            Self::Oblique => "F3",
            Self::Mono => "F4",
        }
    }
}

#[derive(Clone)]
struct PdfLine {
    text: String,
    font: PdfFont,
    font_size: f32,
    line_height: f32,
    indent: f32,
}

impl PdfLine {
    fn blank(line_height: f32) -> Self {
        Self {
            text: String::new(),
            font: PdfFont::Regular,
            font_size: PDF_FONT_SIZE,
            line_height,
            indent: 0.0,
        }
    }
}

pub(crate) fn export_html_document(target_path: &Path, html: &str) -> Result<String, String> {
    fs::write(target_path, html)
        .map_err(|error| format!("Could not export {}: {error}", target_path.display()))?;
    Ok(target_path.to_string_lossy().to_string())
}

pub(crate) fn export_docx_document(target_path: &Path, content: &str) -> Result<String, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create DOCX temp file name: {error}"))?
        .as_nanos();
    let input_path = std::env::temp_dir().join(format!("lmd-docx-{timestamp}.md"));
    {
        let mut input = fs::File::create(&input_path)
            .map_err(|error| format!("Could not create {}: {error}", input_path.display()))?;
        input
            .write_all(content.as_bytes())
            .map_err(|error| format!("Could not write {}: {error}", input_path.display()))?;
    }

    let output = Command::new("pandoc")
        .arg(&input_path)
        .arg("-f")
        .arg("markdown")
        .arg("-t")
        .arg("docx")
        .arg("-o")
        .arg(target_path)
        .output()
        .map_err(|error| {
            format!(
                "无法调用 pandoc 导出 DOCX：{error}。请先安装 pandoc，例如 `brew install pandoc`。"
            )
        });
    let _ = fs::remove_file(&input_path);
    let output = output?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "pandoc 导出 DOCX 失败。".to_string()
        } else {
            format!("pandoc 导出 DOCX 失败：{stderr}")
        });
    }

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

fn strip_inline_markdown(text: &str) -> String {
    let mut output = String::new();
    let mut chars = text.chars().peekable();

    while let Some(character) = chars.next() {
        match character {
            '*' | '_' | '`' => {}
            '[' => {
                let mut label = String::new();
                for next in chars.by_ref() {
                    if next == ']' {
                        break;
                    }
                    label.push(next);
                }
                if chars.peek() == Some(&'(') {
                    for next in chars.by_ref() {
                        if next == ')' {
                            break;
                        }
                    }
                }
                output.push_str(&label);
            }
            '<' => {
                let mut url = String::new();
                for next in chars.by_ref() {
                    if next == '>' {
                        break;
                    }
                    url.push(next);
                }
                output.push_str(&url);
            }
            _ => output.push(character),
        }
    }

    output
}

fn push_wrapped_lines(
    lines: &mut Vec<PdfLine>,
    text: &str,
    font: PdfFont,
    font_size: f32,
    line_height: f32,
    indent: f32,
) {
    for wrapped in wrap_pdf_line(text, indent) {
        lines.push(PdfLine {
            text: wrapped,
            font,
            font_size,
            line_height,
            indent,
        });
    }
}

fn markdown_to_pdf_lines(content: &str) -> Vec<PdfLine> {
    let mut lines = Vec::new();
    let mut in_code = false;
    let mut ordered_index = 1usize;

    for raw_line in content.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            in_code = !in_code;
            lines.push(PdfLine::blank(8.0));
            continue;
        }

        if in_code {
            push_wrapped_lines(&mut lines, line, PdfFont::Mono, 10.0, 14.0, 16.0);
            continue;
        }

        if trimmed.is_empty() {
            ordered_index = 1;
            lines.push(PdfLine::blank(10.0));
            continue;
        }

        if let Some((hashes, title)) = trimmed.split_once(' ') {
            if hashes.chars().all(|character| character == '#') && (1..=6).contains(&hashes.len()) {
                let level = hashes.len();
                let font_size = match level {
                    1 => 22.0,
                    2 => 18.0,
                    3 => 15.0,
                    _ => 12.5,
                };
                let line_height = font_size + 8.0;
                lines.push(PdfLine::blank(6.0));
                push_wrapped_lines(
                    &mut lines,
                    &strip_inline_markdown(title),
                    PdfFont::Bold,
                    font_size,
                    line_height,
                    0.0,
                );
                continue;
            }
        }

        if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "))
        {
            let item = if let Some(item) = item
                .strip_prefix("[x] ")
                .or_else(|| item.strip_prefix("[X] "))
            {
                format!("[x] {}", strip_inline_markdown(item))
            } else if let Some(item) = item.strip_prefix("[ ] ") {
                format!("[ ] {}", strip_inline_markdown(item))
            } else {
                format!("- {}", strip_inline_markdown(item))
            };
            push_wrapped_lines(
                &mut lines,
                &item,
                PdfFont::Regular,
                PDF_FONT_SIZE,
                PDF_LINE_HEIGHT,
                14.0,
            );
            continue;
        }

        if let Some((prefix, item)) = trimmed.split_once(". ") {
            if prefix.parse::<usize>().is_ok() {
                let item = format!("{ordered_index}. {}", strip_inline_markdown(item));
                ordered_index += 1;
                push_wrapped_lines(
                    &mut lines,
                    &item,
                    PdfFont::Regular,
                    PDF_FONT_SIZE,
                    PDF_LINE_HEIGHT,
                    14.0,
                );
                continue;
            }
        }

        if trimmed.starts_with("> ") {
            push_wrapped_lines(
                &mut lines,
                &format!(
                    "> {}",
                    strip_inline_markdown(trimmed.trim_start_matches("> "))
                ),
                PdfFont::Oblique,
                PDF_FONT_SIZE,
                PDF_LINE_HEIGHT,
                14.0,
            );
            continue;
        }

        if matches!(trimmed, "---" | "***" | "___") {
            lines.push(PdfLine {
                text: "-".repeat(72),
                font: PdfFont::Regular,
                font_size: PDF_FONT_SIZE,
                line_height: PDF_LINE_HEIGHT,
                indent: 0.0,
            });
            continue;
        }

        ordered_index = 1;
        push_wrapped_lines(
            &mut lines,
            &strip_inline_markdown(trimmed),
            PdfFont::Regular,
            PDF_FONT_SIZE,
            PDF_LINE_HEIGHT,
            0.0,
        );
    }

    lines
}

fn wrap_pdf_line(line: &str, indent: f32) -> Vec<String> {
    let available_chars = PDF_MAX_CHARS_PER_LINE.saturating_sub((indent / 5.0) as usize);
    if line.chars().count() <= available_chars {
        return vec![line.to_string()];
    }

    let mut wrapped = Vec::new();
    let mut current = String::new();

    for word in line.split_whitespace() {
        let next_len =
            current.chars().count() + word.chars().count() + usize::from(!current.is_empty());
        if next_len > available_chars && !current.is_empty() {
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

fn paginate_pdf_lines(lines: &[PdfLine]) -> Vec<Vec<PdfLine>> {
    let mut pages = Vec::new();
    let mut page = Vec::new();
    let mut y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    let bottom = PDF_MARGIN;

    for line in lines {
        if y - line.line_height < bottom && !page.is_empty() {
            pages.push(page);
            page = Vec::new();
            y = PDF_PAGE_HEIGHT - PDF_MARGIN;
        }
        y -= line.line_height;
        page.push(line.clone());
    }

    if !page.is_empty() {
        pages.push(page);
    }
    if pages.is_empty() {
        pages.push(vec![PdfLine::blank(PDF_LINE_HEIGHT)]);
    }

    pages
}

fn pdf_text_stream(lines: &[PdfLine]) -> String {
    let mut stream = String::new();
    stream.push_str("BT\n");
    let mut y = PDF_PAGE_HEIGHT - PDF_MARGIN;

    for line in lines {
        y -= line.line_height;
        stream.push_str(&format!(
            "/{} {} Tf\n",
            line.font.resource_name(),
            line.font_size
        ));
        stream.push_str(&format!("1 0 0 1 {} {} Tm\n", PDF_MARGIN + line.indent, y));
        stream.push_str(&format!("({}) Tj\n", pdf_escape(&line.text)));
    }

    stream.push_str("ET\n");
    stream
}

pub(crate) fn pdf_document(content: &str) -> Vec<u8> {
    let lines = markdown_to_pdf_lines(content);
    let pages = paginate_pdf_lines(&lines);
    let page_streams = pages
        .iter()
        .map(|page| pdf_text_stream(page))
        .collect::<Vec<_>>();
    let page_count = page_streams.len();
    let catalog_id = 1;
    let pages_id = 2;
    let regular_font_id = 3;
    let bold_font_id = 4;
    let oblique_font_id = 5;
    let mono_font_id = 6;
    let first_page_id = 7;
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
        "{regular_font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    ));
    objects.push(format!("{bold_font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n"));
    objects.push(format!("{oblique_font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj\n"));
    objects.push(format!(
        "{mono_font_id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n"
    ));

    for index in 0..page_count {
        let page_id = first_page_id + index;
        let content_id = first_content_id + index;
        objects.push(format!(
            "{page_id} 0 obj\n<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 {PDF_PAGE_WIDTH} {PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 {regular_font_id} 0 R /F2 {bold_font_id} 0 R /F3 {oblique_font_id} 0 R /F4 {mono_font_id} 0 R >> >> /Contents {content_id} 0 R >>\nendobj\n"
        ));
    }

    for (index, stream) in page_streams.iter().enumerate() {
        let content_id = first_content_id + index;
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
