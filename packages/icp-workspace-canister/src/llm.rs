//! LLM client (FU-434 Slice C / ADR-311 D6) — single-turn chat completions
//! over IC HTTPS outcalls against the injected `WorkspaceConfig`.
//!
//! Deliberate cuts (documented in the ADR record, no fake breadth):
//! - single-turn only: system prompt + the one user message. Conversation
//!   history is recorded as signed outputs but NOT fed back to the provider
//!   (follow-up).
//! - no provider tool-calling: responses are parsed as plain text; the
//!   tool executor is buyer-driven (see `harness.rs`).
//!
//! ADR-321 D3 (RAG): `build_chat_request` additionally accepts retrieved
//! workspace-context chunks (`vector_store::top_k` over `embedder.rs`
//! embeddings) and folds them in as an extra system message ahead of
//! `config.system_prompt` — an empty `context_chunks` slice reproduces the
//! exact pre-ADR-321 request byte-for-byte (existing tests below assert this).
//!
//! Request building and response parsing are pure functions — `cargo test`
//! covers them without the IC runtime. The async outcall wiring lives in
//! `lib.rs`. Key-material discipline (FU-195-C): the API key only ever goes
//! into request headers; errors carry the provider status code, never
//! response bodies (they can echo request data).

use serde_json::json;

use crate::types::{WorkspaceConfig, WorkspaceError};

/// Provider-neutral request description; `lib.rs` maps it onto the management
/// canister's `HttpRequestArgs` (transform, max_response_bytes, cycles).
#[derive(Debug)]
pub struct ChatRequestSpec {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// Builds a single "You have access to the following workspace context:"
/// system-message body (ADR-321 D3 pseudo-code) from retrieved chunk texts.
/// `None` when there's nothing to inject — callers skip adding a message /
/// combining into `system` entirely, so an empty retrieval reproduces the
/// exact pre-ADR-321 request.
fn context_system_message(context_chunks: &[String]) -> Option<String> {
    if context_chunks.is_empty() {
        return None;
    }
    let body = context_chunks
        .iter()
        .enumerate()
        .map(|(i, chunk)| format!("[{}] {chunk}", i + 1))
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(format!("You have access to the following workspace context:\n\n{body}"))
}

/// Builds the provider-specific chat-completion request for one user message.
/// `context_chunks` are prior workspace-context chunks retrieved by
/// `vector_store::top_k` (ADR-321 D3 RAG) — pass `&[]` for the pre-ADR-321
/// behavior.
pub fn build_chat_request(
    config: &WorkspaceConfig,
    user_content: &str,
    context_chunks: &[String],
) -> Result<ChatRequestSpec, WorkspaceError> {
    let context_message = context_system_message(context_chunks);

    let mut messages = Vec::new();
    if let Some(context_message) = &context_message {
        messages.push(json!({ "role": "system", "content": context_message }));
    }
    if let Some(system_prompt) = &config.system_prompt {
        messages.push(json!({ "role": "system", "content": system_prompt }));
    }
    messages.push(json!({ "role": "user", "content": user_content }));

    let json_headers = || vec![("content-type".to_string(), "application/json".to_string())];
    let encode = |v: serde_json::Value| serde_json::to_vec(&v).expect("chat request JSON must always serialize");

    match config.llm_provider.as_str() {
        "openai" => {
            let base = config.llm_base_url.as_deref().unwrap_or("https://api.openai.com");
            Ok(ChatRequestSpec {
                url: format!("{base}/v1/chat/completions"),
                headers: [
                    json_headers(),
                    vec![("authorization".to_string(), format!("Bearer {}", config.llm_api_key))],
                ]
                .concat(),
                body: encode(json!({ "model": config.llm_model, "messages": messages })),
            })
        }
        "anthropic" => {
            // Anthropic's `system` param is a single string, not a message
            // list — combine the retrieved-context block with the existing
            // system prompt instead of pushing a second system message.
            let base = config.llm_base_url.as_deref().unwrap_or("https://api.anthropic.com");
            let system = match (&context_message, &config.system_prompt) {
                (Some(ctx), Some(prompt)) => Some(format!("{ctx}\n\n{prompt}")),
                (Some(ctx), None) => Some(ctx.clone()),
                (None, prompt) => prompt.clone(),
            };
            Ok(ChatRequestSpec {
                url: format!("{base}/v1/messages"),
                headers: [
                    json_headers(),
                    vec![
                        ("x-api-key".to_string(), config.llm_api_key.clone()),
                        ("anthropic-version".to_string(), "2023-06-01".to_string()),
                    ],
                ]
                .concat(),
                body: encode(json!({
                    "model": config.llm_model,
                    "max_tokens": 1024,
                    "system": system,
                    "messages": [{ "role": "user", "content": user_content }],
                })),
            })
        }
        "ollama" => {
            let base = config.llm_base_url.as_deref().ok_or_else(|| WorkspaceError::InvalidArgs {
                reason: "ollama provider requires llm_base_url".to_string(),
            })?;
            Ok(ChatRequestSpec {
                url: format!("{base}/api/chat"),
                headers: json_headers(),
                body: encode(json!({ "model": config.llm_model, "stream": false, "messages": messages })),
            })
        }
        other => Err(WorkspaceError::InvalidArgs {
            reason: format!("unknown llm_provider {other:?} (validated at injection — this is a bug)"),
        }),
    }
}

/// Parses the provider response body into the reply text. `status` is the
/// HTTP status; non-2xx is a `ProviderError` carrying the code only — the
/// body is deliberately not echoed (it can contain request echoes; the
/// request headers carry the API key).
pub fn parse_chat_response(provider: &str, status: u64, body: &[u8]) -> Result<String, WorkspaceError> {
    if !(200..300).contains(&status) {
        return Err(WorkspaceError::ProviderError {
            reason: format!("{provider} answered HTTP {status}"),
        });
    }
    let body: serde_json::Value = serde_json::from_slice(body).map_err(|_| WorkspaceError::ProviderError {
        reason: format!("{provider} response is not valid JSON"),
    })?;
    let content = match provider {
        "openai" => body.pointer("/choices/0/message/content"),
        "anthropic" => body.pointer("/content/0/text"),
        "ollama" => body.pointer("/message/content"),
        other => {
            return Err(WorkspaceError::InvalidArgs {
                reason: format!("unknown llm_provider {other:?} (validated at injection — this is a bug)"),
            });
        }
    };
    content
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| WorkspaceError::ProviderError {
            reason: format!("{provider} response has no text content at the expected path"),
        })
}

/// LLM token usage for one chat call (ADR-312 D4, PER_TOKEN billing).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// Extracts token usage from a successful chat-completion response body.
/// `None` on any parse failure or missing field — deliberately not a
/// `Result`: usage extraction is a billing refinement, never a reason to
/// fail an otherwise-successful chat reply (`post_message` falls back to the
/// real outcall infra cost when this returns `None`, never to zero).
///
/// - openai: `usage.{prompt_tokens,completion_tokens,total_tokens}`.
/// - anthropic: `usage.{input_tokens,output_tokens}` — no `total`, summed.
/// - ollama: `prompt_eval_count`/`eval_count` at the response's top level
///   (not nested under `usage`); both fields absent means the response
///   genuinely carries no usage, not that they were successfully zero.
pub fn parse_token_usage(provider: &str, body: &[u8]) -> Option<TokenUsage> {
    let body: serde_json::Value = serde_json::from_slice(body).ok()?;
    match provider {
        "openai" => {
            let usage = body.get("usage")?;
            let prompt_tokens = usage.get("prompt_tokens")?.as_u64()?;
            let completion_tokens = usage.get("completion_tokens")?.as_u64()?;
            let total_tokens = usage.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(prompt_tokens + completion_tokens);
            Some(TokenUsage { prompt_tokens, completion_tokens, total_tokens })
        }
        "anthropic" => {
            let usage = body.get("usage")?;
            let prompt_tokens = usage.get("input_tokens")?.as_u64()?;
            let completion_tokens = usage.get("output_tokens")?.as_u64()?;
            Some(TokenUsage { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens })
        }
        "ollama" => {
            let prompt_tokens = body.get("prompt_eval_count").and_then(|v| v.as_u64());
            let completion_tokens = body.get("eval_count").and_then(|v| v.as_u64());
            match (prompt_tokens, completion_tokens) {
                (None, None) => None,
                (p, c) => {
                    let prompt_tokens = p.unwrap_or(0);
                    let completion_tokens = c.unwrap_or(0);
                    Some(TokenUsage { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens })
                }
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(provider: &str, base_url: Option<&str>) -> WorkspaceConfig {
        WorkspaceConfig {
            llm_provider: provider.to_string(),
            llm_model: "test-model".to_string(),
            llm_api_key: "test-key".to_string(),
            llm_base_url: base_url.map(|s| s.to_string()),
            system_prompt: Some("be terse".to_string()),
            tools: Vec::new(),
        }
    }

    fn header<'a>(spec: &'a ChatRequestSpec, name: &str) -> Option<&'a str> {
        spec.headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str())
    }

    #[test]
    fn openai_request_hits_chat_completions_with_bearer() {
        let spec = build_chat_request(&config("openai", None), "hello", &[]).unwrap();
        assert_eq!(spec.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(header(&spec, "authorization"), Some("Bearer test-key"));
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        assert_eq!(body["model"], "test-model");
        assert_eq!(body["messages"][0], json!({ "role": "system", "content": "be terse" }));
        assert_eq!(body["messages"][1], json!({ "role": "user", "content": "hello" }));
    }

    #[test]
    fn anthropic_request_hits_messages_with_x_api_key() {
        let spec = build_chat_request(&config("anthropic", None), "hello", &[]).unwrap();
        assert_eq!(spec.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&spec, "x-api-key"), Some("test-key"));
        assert_eq!(header(&spec, "anthropic-version"), Some("2023-06-01"));
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        assert_eq!(body["system"], "be terse");
        assert_eq!(body["messages"], json!([{ "role": "user", "content": "hello" }]));
    }

    #[test]
    fn ollama_request_requires_base_url() {
        assert!(build_chat_request(&config("ollama", None), "hello", &[]).is_err());
        let spec = build_chat_request(&config("ollama", Some("https://ollama.example.com")), "hello", &[]).unwrap();
        assert_eq!(spec.url, "https://ollama.example.com/api/chat");
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        assert_eq!(body["stream"], false);
    }

    #[test]
    fn empty_context_reproduces_pre_adr321_request_byte_for_byte() {
        let with_empty_slice = build_chat_request(&config("openai", None), "hello", &[]).unwrap();
        let context_message = context_system_message(&[]);
        assert!(context_message.is_none());
        let body: serde_json::Value = serde_json::from_slice(&with_empty_slice.body).unwrap();
        assert_eq!(body["messages"].as_array().unwrap().len(), 2, "no extra context message injected");
    }

    #[test]
    fn openai_prepends_context_as_leading_system_message() {
        let chunks = vec!["fact one".to_string(), "fact two".to_string()];
        let spec = build_chat_request(&config("openai", None), "hello", &chunks).unwrap();
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 3, "context message + system prompt + user message");
        let context_content = messages[0]["content"].as_str().unwrap();
        assert!(context_content.contains("workspace context"));
        assert!(context_content.contains("[1] fact one"));
        assert!(context_content.contains("[2] fact two"));
        assert_eq!(messages[1], json!({ "role": "system", "content": "be terse" }));
        assert_eq!(messages[2], json!({ "role": "user", "content": "hello" }));
    }

    #[test]
    fn anthropic_combines_context_into_single_system_string() {
        let chunks = vec!["fact one".to_string()];
        let spec = build_chat_request(&config("anthropic", None), "hello", &chunks).unwrap();
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        let system = body["system"].as_str().unwrap();
        assert!(system.contains("workspace context"));
        assert!(system.contains("fact one"));
        assert!(system.contains("be terse"), "existing system_prompt must not be dropped");
        // Anthropic's messages array stays exactly the one user turn.
        assert_eq!(body["messages"], json!([{ "role": "user", "content": "hello" }]));
    }

    #[test]
    fn parse_openai_response() {
        let body = json!({ "choices": [{ "message": { "role": "assistant", "content": "hi there" } }] });
        assert_eq!(parse_chat_response("openai", 200, &serde_json::to_vec(&body).unwrap()).unwrap(), "hi there");
    }

    #[test]
    fn parse_anthropic_and_ollama_responses() {
        let anthropic = json!({ "content": [{ "type": "text", "text": "hi" }] });
        assert_eq!(parse_chat_response("anthropic", 200, &serde_json::to_vec(&anthropic).unwrap()).unwrap(), "hi");
        let ollama = json!({ "message": { "role": "assistant", "content": "hi" } });
        assert_eq!(parse_chat_response("ollama", 200, &serde_json::to_vec(&ollama).unwrap()).unwrap(), "hi");
    }

    #[test]
    fn parse_rejects_non_2xx_with_status_only() {
        // Even a valid-JSON body must not leak into the error on failure.
        let body = json!({ "error": { "message": "echoes the request, maybe the key" } });
        match parse_chat_response("openai", 401, &serde_json::to_vec(&body).unwrap()) {
            Err(WorkspaceError::ProviderError { reason }) => {
                assert_eq!(reason, "openai answered HTTP 401");
            }
            other => panic!("expected ProviderError, got {other:?}"),
        }
    }

    #[test]
    fn parse_rejects_unparseable_and_contentless_bodies() {
        assert!(parse_chat_response("openai", 200, b"not json").is_err());
        assert!(parse_chat_response("openai", 200, b"{}").is_err());
    }

    #[test]
    fn parse_token_usage_openai() {
        let body = json!({
            "choices": [{ "message": { "content": "hi" } }],
            "usage": { "prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20 },
        });
        let usage = parse_token_usage("openai", &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(usage, TokenUsage { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 });
    }

    #[test]
    fn parse_token_usage_anthropic_sums_input_and_output() {
        let body = json!({
            "content": [{ "type": "text", "text": "hi" }],
            "usage": { "input_tokens": 15, "output_tokens": 5 },
        });
        let usage = parse_token_usage("anthropic", &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(usage, TokenUsage { prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 });
    }

    #[test]
    fn parse_token_usage_ollama_reads_top_level_eval_counts() {
        let body = json!({
            "message": { "content": "hi" },
            "prompt_eval_count": 30,
            "eval_count": 10,
        });
        let usage = parse_token_usage("ollama", &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(usage, TokenUsage { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 });
    }

    #[test]
    fn parse_token_usage_none_when_usage_missing_or_unparseable() {
        // openai: no usage field at all.
        let body = json!({ "choices": [{ "message": { "content": "hi" } }] });
        assert!(parse_token_usage("openai", &serde_json::to_vec(&body).unwrap()).is_none());
        // ollama: neither eval-count field present — a genuinely usage-less response.
        let body = json!({ "message": { "content": "hi" } });
        assert!(parse_token_usage("ollama", &serde_json::to_vec(&body).unwrap()).is_none());
        // unparseable body.
        assert!(parse_token_usage("openai", b"not json").is_none());
        // unknown provider.
        let body = json!({ "usage": { "prompt_tokens": 1, "completion_tokens": 1 } });
        assert!(parse_token_usage("mistral", &serde_json::to_vec(&body).unwrap()).is_none());
    }
}
