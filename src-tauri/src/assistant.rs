use crate::workspace::{AssistantDraft, QueryContext};
use serde::Serialize;
use std::{
    env,
    io::Write,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(crate) const DEFAULT_PROVIDER: &str = "builtin";
pub(crate) const DEFAULT_MODEL: &str = "local-summary-v1";
const DEFAULT_EXTERNAL_COMMAND_TIMEOUT_SECONDS: u64 = 60;

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
            AssistantProviderInfo {
                id: "external_command".to_string(),
                label: "External Command".to_string(),
                models: vec!["command-json-v1".to_string()],
            },
        ],
    }
}

pub(crate) fn summarize_query_context(request: AssistantRequest<'_>) -> Result<AssistantDraft, String> {
    validate_request(&request)?;

    match request.provider {
        "builtin" => Ok(builtin_summary(request.context, request.provider, request.model)),
        "mock_openai" => Ok(mock_openai_summary(request.context, request.provider, request.model)),
        "external_command" => external_command_summary(request),
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

fn external_command_summary(request: AssistantRequest<'_>) -> Result<AssistantDraft, String> {
    let command_path = env::var("LMD_ASSISTANT_COMMAND")
        .map_err(|_| "LMD_ASSISTANT_COMMAND is not configured".to_string())?;
    if command_path.trim().is_empty() {
        return Err("LMD_ASSISTANT_COMMAND is empty".to_string());
    }

    let input = serde_json::to_vec(&ExternalCommandInput {
        provider: request.provider,
        model: request.model,
        context: request.context,
    })
    .map_err(|error| format!("Could not encode assistant command input: {error}"))?;

    let mut child = Command::new(command_path.trim())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start assistant command: {error}"))?;

    {
        let Some(mut stdin) = child.stdin.take() else {
            return Err("Assistant command stdin is unavailable".to_string());
        };
        stdin
            .write_all(&input)
            .map_err(|error| format!("Could not write assistant command input: {error}"))?;
    }

    let timeout = external_command_timeout();
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Assistant command timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(error) => return Err(format!("Could not wait for assistant command: {error}")),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not read assistant command output: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Assistant command failed with status {}", output.status)
        } else {
            format!("Assistant command failed: {stderr}")
        });
    }

    serde_json::from_slice::<AssistantDraft>(&output.stdout)
        .map_err(|error| format!("Assistant command must return JSON draft: {error}"))
}

fn external_command_timeout() -> Duration {
    let seconds = env::var("LMD_ASSISTANT_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_EXTERNAL_COMMAND_TIMEOUT_SECONDS);
    Duration::from_secs(seconds.min(600))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalCommandInput<'a> {
    provider: &'a str,
    model: &'a str,
    context: &'a QueryContext,
}

fn suggest_wiki_title(context: &QueryContext) -> String {
    let base = std::path::Path::new(&context.current_relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("context")
        .replace(['-', '_'], " ");
    format!("{base} summary")
}
