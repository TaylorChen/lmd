use crate::workspace::{AssistantDraft, QueryContext};
use serde::Serialize;

pub(crate) const DEFAULT_PROVIDER: &str = "builtin";
pub(crate) const DEFAULT_MODEL: &str = "local-summary-v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantProviderInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantCatalog {
    pub(crate) default_provider: String,
    pub(crate) providers: Vec<AssistantProviderInfo>,
}

pub(crate) struct AssistantRequest<'a> {
    pub(crate) provider: &'a str,
    pub(crate) model: &'a str,
    pub(crate) context: &'a QueryContext,
}

pub(crate) fn catalog() -> AssistantCatalog {
    AssistantCatalog {
        default_provider: DEFAULT_PROVIDER.to_string(),
        providers: vec![
            AssistantProviderInfo {
                id: "builtin".to_string(),
                label: "Builtin".to_string(),
                models: vec!["local-summary-v1".to_string(), "local-summary-v2".to_string()],
            },
            AssistantProviderInfo {
                id: "mock_openai".to_string(),
                label: "Mock OpenAI".to_string(),
                models: vec!["gpt-mock-1".to_string(), "gpt-mock-2".to_string()],
            },
        ],
    }
}

pub(crate) fn summarize_query_context(request: AssistantRequest<'_>) -> Result<AssistantDraft, String> {
    validate_request(&request)?;

    match request.provider {
        "builtin" => Ok(builtin_summary(request.context, request.provider, request.model)),
        "mock_openai" => Ok(mock_openai_summary(request.context, request.provider, request.model)),
        _ => Err(format!("Unsupported assistant provider: {}", request.provider)),
    }
}

fn validate_request(request: &AssistantRequest<'_>) -> Result<(), String> {
    let catalog = catalog();
    let Some(provider) = catalog
        .providers
        .iter()
        .find(|provider| provider.id == request.provider)
    else {
        return Err(format!("Unsupported assistant provider: {}", request.provider));
    };

    if provider.models.iter().any(|model| model == request.model) {
        return Ok(());
    }

    Err(format!(
        "Unsupported model `{}` for provider `{}`",
        request.model, request.provider
    ))
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
