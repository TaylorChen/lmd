use crate::workspace::{AssistantDraft, QueryContext};

pub(crate) const DEFAULT_PROVIDER: &str = "builtin";
pub(crate) const DEFAULT_MODEL: &str = "local-summary-v1";

pub(crate) struct AssistantRequest<'a> {
    pub(crate) provider: &'a str,
    pub(crate) model: &'a str,
    pub(crate) context: &'a QueryContext,
}

pub(crate) fn summarize_query_context(request: AssistantRequest<'_>) -> AssistantDraft {
    match request.provider {
        "builtin" => builtin_summary(request.context, request.provider, request.model),
        "mock_openai" => mock_openai_summary(request.context, request.provider, request.model),
        _ => builtin_summary(request.context, request.provider, request.model),
    }
}

fn builtin_summary(context: &QueryContext, provider: &str, model: &str) -> AssistantDraft {
    let mut content = String::new();
    content.push_str("# ");
    content.push_str(&suggest_wiki_title(context));
    content.push_str("\n\n");
    content.push_str(&format!("_Provider: {provider} / {model}_\n\n"));
    content.push_str("## Summary\n\n");
    content.push_str(&format!(
        "This draft was assembled from {} context items around `{}`.\n\n",
        context.items.len(),
        context.current_relative_path
    ));

    for item in &context.items {
        content.push_str(&format!(
            "- **{}** (`{}` / `{}`): {}\n",
            item.name, item.source_kind, item.reason, item.excerpt
        ));
    }

    content.push_str("\n## Notes\n\n");
    content.push_str("- Expand the strongest threads into durable wiki pages.\n");
    content.push_str("- Replace placeholder synthesis with reviewed prose before publishing.\n");

    AssistantDraft {
        title: suggest_wiki_title(context),
        content,
    }
}

fn mock_openai_summary(context: &QueryContext, provider: &str, model: &str) -> AssistantDraft {
    let mut draft = builtin_summary(context, provider, model);
    draft.content.push_str("\n## Provider Notes\n\n");
    draft.content.push_str("- mock_openai adapter active.\n");
    draft.content.push_str("- Replace this stub with a real API client before production use.\n");
    draft
}

fn suggest_wiki_title(context: &QueryContext) -> String {
    let base = std::path::Path::new(&context.current_relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("context")
        .replace(['-', '_'], " ");
    format!("{base} summary")
}
