use std::{fs, path::Path};

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
