use std::{fs, path::Path};

const PDF_PAGE_WIDTH: f32 = 612.0;
const PDF_PAGE_HEIGHT: f32 = 792.0;
const PDF_MARGIN: f32 = 54.0;
const PDF_FONT_SIZE: f32 = 11.0;
const PDF_LINE_HEIGHT: f32 = 16.0;
const PDF_MAX_CHARS_PER_LINE: usize = 86;

fn escape_html(text: &str) -> String {
    text.chars()
        .flat_map(|character| match character {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect::<Vec<_>>(),
            '>' => "&gt;".chars().collect::<Vec<_>>(),
            '"' => "&quot;".chars().collect::<Vec<_>>(),
            '\'' => "&#39;".chars().collect::<Vec<_>>(),
            _ => vec![character],
        })
        .collect()
}

fn render_inline(text: &str) -> String {
    let escaped = escape_html(text);
    let mut output = String::new();
    let mut remaining = escaped.as_str();

    while let Some(start) = remaining.find('`') {
        let after_start = &remaining[start + 1..];
        let Some(end) = after_start.find('`') else {
            break;
        };
        output.push_str(&remaining[..start]);
        output.push_str("<code>");
        output.push_str(&after_start[..end]);
        output.push_str("</code>");
        remaining = &after_start[end + 1..];
    }

    output.push_str(remaining);
    output
}

fn flush_paragraph(lines: &mut Vec<String>, blocks: &mut Vec<String>) {
    if lines.is_empty() {
        return;
    }
    blocks.push(format!("<p>{}</p>", render_inline(&lines.join(" "))));
    lines.clear();
}

fn flush_list(items: &mut Vec<(bool, String)>, blocks: &mut Vec<String>) {
    if items.is_empty() {
        return;
    }
    let ordered = items[0].0;
    let tag = if ordered { "ol" } else { "ul" };
    let mut html = format!("<{tag}>");
    for (_, item) in items.iter() {
        html.push_str("<li>");
        html.push_str(&render_inline(item));
        html.push_str("</li>");
    }
    html.push_str(&format!("</{tag}>"));
    blocks.push(html);
    items.clear();
}

pub(crate) fn markdown_to_html(content: &str) -> String {
    let mut blocks = Vec::new();
    let mut paragraph_lines = Vec::new();
    let mut list_items = Vec::new();
    let mut code_lines: Option<Vec<String>> = None;

    for line in content.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.trim_start().starts_with("```") {
            if let Some(lines) = code_lines.take() {
                blocks.push(format!(
                    "<pre><code>{}</code></pre>",
                    escape_html(&lines.join("\n"))
                ));
            } else {
                flush_paragraph(&mut paragraph_lines, &mut blocks);
                flush_list(&mut list_items, &mut blocks);
                code_lines = Some(Vec::new());
            }
            continue;
        }

        if let Some(lines) = code_lines.as_mut() {
            lines.push(line.to_string());
            continue;
        }

        if line.trim().is_empty() {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_list(&mut list_items, &mut blocks);
            continue;
        }

        let trimmed = line.trim();
        if let Some((hashes, title)) = trimmed.split_once(' ') {
            if hashes.chars().all(|character| character == '#') && (1..=6).contains(&hashes.len()) {
                flush_paragraph(&mut paragraph_lines, &mut blocks);
                flush_list(&mut list_items, &mut blocks);
                blocks.push(format!(
                    "<h{level}>{title}</h{level}>",
                    level = hashes.len(),
                    title = render_inline(title)
                ));
                continue;
            }
        }

        if trimmed.starts_with("> ") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_list(&mut list_items, &mut blocks);
            blocks.push(format!(
                "<blockquote>{}</blockquote>",
                render_inline(trimmed.trim_start_matches("> "))
            ));
            continue;
        }

        if matches!(trimmed, "---" | "***" | "___") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_list(&mut list_items, &mut blocks);
            blocks.push("<hr>".to_string());
            continue;
        }

        let unordered = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("+ "));
        let ordered = trimmed
            .split_once(". ")
            .and_then(|(prefix, item)| prefix.parse::<usize>().ok().map(|_| item));
        if let Some(item) = unordered {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            if list_items
                .first()
                .is_some_and(|(is_ordered, _)| *is_ordered)
            {
                flush_list(&mut list_items, &mut blocks);
            }
            list_items.push((false, item.to_string()));
            continue;
        }
        if let Some(item) = ordered {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            if list_items
                .first()
                .is_some_and(|(is_ordered, _)| !*is_ordered)
            {
                flush_list(&mut list_items, &mut blocks);
            }
            list_items.push((true, item.to_string()));
            continue;
        }

        paragraph_lines.push(trimmed.to_string());
    }

    if let Some(lines) = code_lines.take() {
        blocks.push(format!(
            "<pre><code>{}</code></pre>",
            escape_html(&lines.join("\n"))
        ));
    }
    flush_paragraph(&mut paragraph_lines, &mut blocks);
    flush_list(&mut list_items, &mut blocks);
    blocks.join("\n")
}

pub(crate) fn html_document(title: &str, content: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{}</title>
  <style>
    body {{ max-width: 860px; margin: 48px auto; padding: 0 24px; color: #1f2522; font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    h1, h2, h3, h4, h5, h6 {{ line-height: 1.22; }}
    code, pre {{ font-family: "SF Mono", Menlo, Consolas, monospace; }}
    code {{ background: #f6faf8; padding: 0.1em 0.32em; border: 1px solid #dce7e2; border-radius: 6px; }}
    pre {{ overflow: auto; padding: 14px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }}
    pre code {{ border: 0; padding: 0; }}
    blockquote {{ margin-left: 0; padding: 10px 14px; border-left: 4px solid #6d8f81; background: #f6faf8; color: #4c5d56; }}
    a {{ color: #24594a; }}
  </style>
</head>
<body>
{}
</body>
</html>
"#,
        escape_html(title),
        markdown_to_html(content)
    )
}

pub(crate) fn export_html(
    target_path: &Path,
    title: &str,
    content: &str,
) -> Result<String, String> {
    fs::write(target_path, html_document(title, content))
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
