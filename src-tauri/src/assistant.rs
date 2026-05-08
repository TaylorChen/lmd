use crate::workspace::{AssistantDraft, QueryContext};
use serde::{Deserialize, Serialize};
use std::{
    env,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub(crate) const DEFAULT_PROVIDER: &str = "deepseek";
pub(crate) const DEFAULT_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_EXTERNAL_COMMAND_TIMEOUT_SECONDS: u64 = 60;
const DEFAULT_NETWORK_TIMEOUT_SECONDS: u64 = 30;
const DEFAULT_ASSISTANT_MAX_TOKENS: u32 = 1200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantProviderInfo {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) models: Vec<String>,
    pub(crate) base_url: Option<String>,
    pub(crate) api_key_env: Option<String>,
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
    pub(crate) current_content: Option<&'a str>,
    pub(crate) task: Option<&'a str>,
    pub(crate) prompt: Option<&'a str>,
    pub(crate) api_key: Option<&'a str>,
    pub(crate) base_url: Option<&'a str>,
    pub(crate) external_command: Option<&'a str>,
    pub(crate) external_timeout_seconds: Option<u64>,
}

pub(crate) fn catalog() -> AssistantCatalog {
    AssistantCatalog {
        default_provider: DEFAULT_PROVIDER.to_string(),
        providers: vec![
            AssistantProviderInfo {
                id: "deepseek".to_string(),
                label: "DeepSeek".to_string(),
                models: vec![
                    "deepseek-v4-flash".to_string(),
                    "deepseek-v4-pro".to_string(),
                ],
                base_url: Some("https://api.deepseek.com/chat/completions".to_string()),
                api_key_env: Some("DEEPSEEK_API_KEY".to_string()),
            },
            AssistantProviderInfo {
                id: "minimax".to_string(),
                label: "MiniMax".to_string(),
                models: vec![
                    "MiniMax-M2.7".to_string(),
                    "MiniMax-M2.5".to_string(),
                    "MiniMax-M2".to_string(),
                ],
                base_url: Some("https://api.minimaxi.com/v1/chat/completions".to_string()),
                api_key_env: Some("MINIMAX_API_KEY".to_string()),
            },
            AssistantProviderInfo {
                id: "kimi".to_string(),
                label: "Kimi".to_string(),
                models: vec![
                    "kimi-k2.6".to_string(),
                    "kimi-k2.5".to_string(),
                    "moonshot-v1-128k".to_string(),
                ],
                base_url: Some("https://api.moonshot.cn/v1/chat/completions".to_string()),
                api_key_env: Some("MOONSHOT_API_KEY".to_string()),
            },
            AssistantProviderInfo {
                id: "zhipu".to_string(),
                label: "智谱 GLM".to_string(),
                models: vec![
                    "glm-5.1".to_string(),
                    "glm-4.7".to_string(),
                    "glm-4.5".to_string(),
                ],
                base_url: Some("https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string()),
                api_key_env: Some("ZAI_API_KEY".to_string()),
            },
            AssistantProviderInfo {
                id: "ollama".to_string(),
                label: "Ollama".to_string(),
                models: vec![
                    "qwen2.5:7b".to_string(),
                    "llama3.2".to_string(),
                    "deepseek-r1:7b".to_string(),
                ],
                base_url: Some("http://127.0.0.1:11434/v1/chat/completions".to_string()),
                api_key_env: None,
            },
            AssistantProviderInfo {
                id: "lmstudio".to_string(),
                label: "LM Studio".to_string(),
                models: vec!["local-model".to_string()],
                base_url: Some("http://127.0.0.1:1234/v1/chat/completions".to_string()),
                api_key_env: None,
            },
            AssistantProviderInfo {
                id: "external_command".to_string(),
                label: "External Command".to_string(),
                models: vec!["command-json-v1".to_string()],
                base_url: None,
                api_key_env: None,
            },
        ],
    }
}

pub(crate) fn summarize_query_context(
    request: AssistantRequest<'_>,
) -> Result<AssistantDraft, String> {
    validate_request(&request)?;

    match request.provider {
        "deepseek" | "minimax" | "kimi" | "zhipu" | "ollama" | "lmstudio" => {
            openai_compatible_summary(request)
        }
        "external_command" => external_command_summary(request),
        _ => Err(format!(
            "Unsupported assistant provider: {}",
            request.provider
        )),
    }
}

pub(crate) fn summarize_query_context_stream(
    request: AssistantRequest<'_>,
    on_delta: &mut dyn FnMut(&str),
) -> Result<AssistantDraft, String> {
    validate_request(&request)?;

    match request.provider {
        "deepseek" | "minimax" | "kimi" | "zhipu" | "ollama" | "lmstudio" => {
            openai_compatible_summary_stream(request, on_delta)
        }
        "external_command" => {
            let draft = external_command_summary(request)?;
            on_delta(&draft.content);
            Ok(draft)
        }
        _ => Err(format!(
            "Unsupported assistant provider: {}",
            request.provider
        )),
    }
}

fn openai_compatible_summary(request: AssistantRequest<'_>) -> Result<AssistantDraft, String> {
    let provider = catalog()
        .providers
        .into_iter()
        .find(|provider| provider.id == request.provider)
        .ok_or_else(|| format!("Unsupported assistant provider: {}", request.provider))?;
    let base_url = request
        .base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| provider.base_url.clone())
        .ok_or_else(|| format!("{} has no API endpoint configured", request.provider))?;
    let api_key = resolve_api_key(&provider, &request)?;

    let prompt = request.prompt.unwrap_or("").trim();
    let task = request.task.unwrap_or("summarize").trim();
    let user_prompt = build_llm_prompt(request.context, request.current_content, task, prompt);
    let timeout = network_timeout(request.external_timeout_seconds);
    let thinking = deepseek_thinking_mode(request.provider, request.model);
    let input = serde_json::to_vec(&OpenAiCompatibleRequest {
        model: request.model,
        temperature: Some(0.3),
        max_tokens: DEFAULT_ASSISTANT_MAX_TOKENS,
        stream: None,
        thinking,
        messages: vec![
            ChatMessage {
                role: "system",
                content: "你是 LMD 的中文笔记写作助手。请只返回 Markdown 正文，不要包裹 JSON，不要解释你的工作过程。输出应适合直接插入笔记或保存为 Wiki 草稿。",
            },
            ChatMessage {
                role: "user",
                content: &user_prompt,
            },
        ],
    })
    .map_err(|error| format!("Could not encode assistant request: {error}"))?;

    let mut command = Command::new("curl");
    command
        .arg("-sS")
        .arg("--max-time")
        .arg(timeout.as_secs().to_string())
        .arg("--connect-timeout")
        .arg("10")
        .arg("--fail-with-body")
        .arg("-X")
        .arg("POST")
        .arg(&base_url)
        .arg("-H")
        .arg("Content-Type: application/json");
    if let Some(api_key) = api_key {
        command
            .arg("-H")
            .arg(format!("Authorization: Bearer {api_key}"));
    }
    let output = command
        .arg("--data-binary")
        .arg("@-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(&input)?;
            }
            child.wait_with_output()
        })
        .map_err(|error| format!("Could not call assistant API: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format_assistant_api_error(
            output.status.to_string(),
            &stderr,
            &stdout,
        ));
    }

    let response = serde_json::from_slice::<OpenAiCompatibleResponse>(&output.stdout)
        .map_err(|error| format!("Assistant API returned invalid JSON: {error}"))?;
    if let Some(error) = response.error {
        return Err(error.message);
    }
    let content = response
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| "Assistant API returned no content".to_string())?;

    Ok(AssistantDraft {
        title: suggest_draft_title(request.context, task, &content),
        content,
    })
}

fn resolve_api_key(
    provider: &AssistantProviderInfo,
    request: &AssistantRequest<'_>,
) -> Result<Option<String>, String> {
    let api_key = request
        .api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            provider
                .api_key_env
                .as_deref()
                .and_then(|name| env::var(name).ok())
        });

    if api_key.is_some() || provider.api_key_env.is_none() {
        return Ok(api_key);
    }

    let env_name = provider
        .api_key_env
        .as_deref()
        .unwrap_or("PROVIDER_API_KEY");
    Err(format!("请在设置中填写 API Key，或设置环境变量 {env_name}"))
}

fn openai_compatible_summary_stream(
    request: AssistantRequest<'_>,
    on_delta: &mut dyn FnMut(&str),
) -> Result<AssistantDraft, String> {
    let provider = catalog()
        .providers
        .into_iter()
        .find(|provider| provider.id == request.provider)
        .ok_or_else(|| format!("Unsupported assistant provider: {}", request.provider))?;
    let base_url = request
        .base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| provider.base_url.clone())
        .ok_or_else(|| format!("{} has no API endpoint configured", request.provider))?;
    let api_key = resolve_api_key(&provider, &request)?;

    let prompt = request.prompt.unwrap_or("").trim();
    let task = request.task.unwrap_or("summarize").trim();
    let user_prompt = build_llm_prompt(request.context, request.current_content, task, prompt);
    let timeout = network_timeout(request.external_timeout_seconds);
    let thinking = deepseek_thinking_mode(request.provider, request.model);
    let input = serde_json::to_vec(&OpenAiCompatibleRequest {
        model: request.model,
        temperature: Some(0.3),
        max_tokens: DEFAULT_ASSISTANT_MAX_TOKENS,
        stream: Some(true),
        thinking,
        messages: vec![
            ChatMessage {
                role: "system",
                content: "你是 LMD 的中文笔记写作助手。请只返回 Markdown 正文，不要包裹 JSON，不要解释你的工作过程。输出应适合直接插入笔记或保存为 Wiki 草稿。",
            },
            ChatMessage {
                role: "user",
                content: &user_prompt,
            },
        ],
    })
    .map_err(|error| format!("Could not encode assistant request: {error}"))?;

    let mut command = Command::new("curl");
    command
        .arg("-sS")
        .arg("-N")
        .arg("--max-time")
        .arg(timeout.as_secs().to_string())
        .arg("--connect-timeout")
        .arg("10")
        .arg("--fail-with-body")
        .arg("-X")
        .arg("POST")
        .arg(&base_url)
        .arg("-H")
        .arg("Content-Type: application/json");
    if let Some(api_key) = api_key {
        command
            .arg("-H")
            .arg(format!("Authorization: Bearer {api_key}"));
    }
    let mut child = command
        .arg("--data-binary")
        .arg("@-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not call assistant API: {error}"))?;

    {
        let Some(mut stdin) = child.stdin.take() else {
            return Err("Assistant API stdin is unavailable".to_string());
        };
        stdin
            .write_all(&input)
            .map_err(|error| format!("Could not write assistant API input: {error}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Assistant API stdout is unavailable".to_string())?;
    let mut content = String::new();
    let mut error_message: Option<String> = None;

    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|error| format!("Could not read assistant stream: {error}"))?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with(':') {
            continue;
        }
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            break;
        }
        let chunk = serde_json::from_str::<OpenAiCompatibleStreamResponse>(data)
            .map_err(|error| format!("Assistant stream returned invalid JSON: {error}"))?;
        if let Some(error) = chunk.error {
            error_message = Some(error.message);
            break;
        }
        for choice in chunk.choices {
            if let Some(delta) = choice.delta.content {
                if !delta.is_empty() {
                    on_delta(&delta);
                    content.push_str(&delta);
                }
            }
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not finish assistant stream: {error}"))?;
    if let Some(error) = error_message {
        return Err(error);
    }
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format_assistant_api_error(
            output.status.to_string(),
            &stderr,
            "",
        ));
    }
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("Assistant API returned no content".to_string());
    }

    Ok(AssistantDraft {
        title: suggest_draft_title(request.context, task, &content),
        content,
    })
}

fn build_llm_prompt(
    context: &QueryContext,
    current_content: Option<&str>,
    task: &str,
    user_prompt: &str,
) -> String {
    let mut prompt = String::new();
    prompt.push_str("当前文档路径：");
    prompt.push_str(&context.current_relative_path);
    prompt.push_str("\n\n任务：");
    prompt.push_str(match task {
        "polish" => "优化文字，保持原意，提升清晰度、结构和可读性。",
        "todos" => "从当前内容提取可执行待办事项。",
        "title" => "为当前笔记生成 5 个简洁标题候选。",
        "wiki" => "整理为可沉淀到知识库的 Wiki 草稿。",
        "continue" => "基于当前笔记的语气和结构续写后续内容，只输出可直接追加到笔记中的 Markdown。",
        "outline" => "基于当前笔记生成清晰的多级大纲，只输出 Markdown 大纲。",
        "chat" => "根据用户要求回答或改写。",
        _ => "总结当前笔记和相关上下文。",
    });
    if !user_prompt.is_empty() {
        prompt.push_str("\n\n用户补充要求：");
        prompt.push_str(user_prompt);
    }
    if let Some(content) = current_content
        .map(str::trim)
        .filter(|content| !content.is_empty())
    {
        prompt.push_str("\n\n当前文档全文：\n");
        prompt.push_str(&limit_chars(content, 24_000));
    }
    prompt.push_str("\n\n相关上下文：\n");
    for item in &context.items {
        prompt.push_str(&format!(
            "- {} [{} / {}]: {}\n",
            item.relative_path, item.source_kind, item.reason, item.excerpt
        ));
    }
    prompt.push_str(
        "\n回答需要尽量引用来源路径；涉及上下文事实时，在句末用 `[来源: relative/path.md]` 标注。",
    );
    prompt
}

fn limit_chars(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for character in value.chars().take(max_chars) {
        output.push(character);
    }
    if value.chars().count() > max_chars {
        output.push_str("\n\n...[内容过长，已截断]");
    }
    output
}

fn network_timeout(configured_seconds: Option<u64>) -> Duration {
    let seconds = configured_seconds
        .filter(|seconds| *seconds > 0)
        .unwrap_or(DEFAULT_NETWORK_TIMEOUT_SECONDS);
    Duration::from_secs(seconds.min(120))
}

fn deepseek_thinking_mode<'a>(provider: &str, model: &str) -> Option<ThinkingMode<'a>> {
    if provider == "deepseek" && !model.contains("reasoner") {
        Some(ThinkingMode { kind: "disabled" })
    } else {
        None
    }
}

fn format_assistant_api_error(status: String, stderr: &str, stdout: &str) -> String {
    if stderr.contains("timed out") || stderr.contains("Operation timed out") {
        return "AI 请求超时，请检查网络、API 地址或稍后重试。".to_string();
    }
    if !stdout.is_empty() {
        return format!(
            "Assistant API failed with status {status}: {}",
            limit_chars(stdout, 800)
        );
    }
    if !stderr.is_empty() {
        return format!("Assistant API failed: {}", limit_chars(stderr, 800));
    }
    format!("Assistant API failed with status {status}")
}

fn suggest_draft_title(context: &QueryContext, task: &str, content: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }

    let stem = std::path::Path::new(&context.current_relative_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("AI 草稿");
    match task {
        "title" => format!("{stem} 标题候选"),
        "todos" => format!("{stem} 待办"),
        "polish" => format!("{stem} 优化稿"),
        "continue" => format!("{stem} 续写"),
        "outline" => format!("{stem} 大纲"),
        "wiki" => format!("{stem} Wiki 草稿"),
        _ => format!("{stem} AI 草稿"),
    }
}

fn validate_request(request: &AssistantRequest<'_>) -> Result<(), String> {
    let catalog = catalog();
    let Some(provider) = catalog
        .providers
        .iter()
        .find(|provider| provider.id == request.provider)
    else {
        return Err(format!(
            "Unsupported assistant provider: {}",
            request.provider
        ));
    };

    if provider.models.iter().any(|model| model == request.model) {
        return Ok(());
    }

    Err(format!(
        "Unsupported model `{}` for provider `{}`",
        request.model, request.provider
    ))
}

fn external_command_summary(request: AssistantRequest<'_>) -> Result<AssistantDraft, String> {
    let command_path = request
        .external_command
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| env::var("LMD_ASSISTANT_COMMAND").ok())
        .ok_or_else(|| {
            "请在设置中填写外部命令路径，或设置环境变量 LMD_ASSISTANT_COMMAND".to_string()
        })?;
    if command_path.trim().is_empty() {
        return Err("外部命令路径为空。".to_string());
    }

    let input = serde_json::to_vec(&ExternalCommandInput {
        provider: request.provider,
        model: request.model,
        context: request.context,
        task: request.task,
        prompt: request.prompt,
        current_content: request.current_content,
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

    let timeout = external_command_timeout(request.external_timeout_seconds);
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

fn external_command_timeout(request_seconds: Option<u64>) -> Duration {
    let seconds = request_seconds
        .filter(|seconds| *seconds > 0)
        .or_else(|| {
            env::var("LMD_ASSISTANT_TIMEOUT_SECONDS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .filter(|seconds| *seconds > 0)
        })
        .unwrap_or(DEFAULT_EXTERNAL_COMMAND_TIMEOUT_SECONDS);
    Duration::from_secs(seconds.min(600))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalCommandInput<'a> {
    provider: &'a str,
    model: &'a str,
    context: &'a QueryContext,
    task: Option<&'a str>,
    prompt: Option<&'a str>,
    current_content: Option<&'a str>,
}

#[derive(Serialize)]
struct OpenAiCompatibleRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<ThinkingMode<'a>>,
}

#[derive(Serialize)]
struct ThinkingMode<'a> {
    #[serde(rename = "type")]
    kind: &'a str,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAiCompatibleResponse {
    choices: Vec<OpenAiChoice>,
    error: Option<OpenAiError>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Deserialize)]
struct OpenAiMessage {
    content: String,
}

#[derive(Deserialize)]
struct OpenAiError {
    message: String,
}

#[derive(Deserialize)]
struct OpenAiCompatibleStreamResponse {
    #[serde(default)]
    choices: Vec<OpenAiStreamChoice>,
    error: Option<OpenAiError>,
}

#[derive(Deserialize)]
struct OpenAiStreamChoice {
    delta: OpenAiStreamDelta,
}

#[derive(Deserialize)]
struct OpenAiStreamDelta {
    content: Option<String>,
}
