//! Embedding client (ADR-321 D1) — request building + response parsing for
//! workspace context indexing/retrieval, over the same IC HTTPS-outcall
//! mechanism `llm.rs` uses for chat. Reuses `llm::ChatRequestSpec` (url +
//! headers + body is the same shape for any outcall) rather than inventing a
//! second identical struct.
//!
//! Provider coverage matches the ADR's own text: OpenAI and Ollama expose a
//! stable embeddings endpoint; Anthropic does not (as of this writing) — a
//! workspace configured with `llm_provider: "anthropic"` gets `InvalidArgs`
//! here, and callers in `lib.rs` treat that as "skip RAG/indexing for this
//! workspace" rather than a hard failure (chat must keep working without
//! Anthropic embeddings).
//!
//! Pure functions — `cargo test` covers them without the IC runtime, same
//! discipline as `llm.rs`.

use serde_json::json;

use crate::llm::ChatRequestSpec;
use crate::types::WorkspaceConfig;
use crate::types::WorkspaceError;

const OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-small";
const OLLAMA_EMBEDDING_MODEL: &str = "nomic-embed-text";

/// Builds the provider-specific embedding request for one piece of text.
pub fn build_embedding_request(config: &WorkspaceConfig, text: &str) -> Result<ChatRequestSpec, WorkspaceError> {
    let json_headers = || vec![("content-type".to_string(), "application/json".to_string())];
    let encode = |v: serde_json::Value| serde_json::to_vec(&v).expect("embedding request JSON must always serialize");

    match config.llm_provider.as_str() {
        "openai" => {
            let base = config.llm_base_url.as_deref().unwrap_or("https://api.openai.com");
            Ok(ChatRequestSpec {
                url: format!("{base}/v1/embeddings"),
                headers: [
                    json_headers(),
                    vec![("authorization".to_string(), format!("Bearer {}", config.llm_api_key))],
                ]
                .concat(),
                body: encode(json!({ "model": OPENAI_EMBEDDING_MODEL, "input": text })),
            })
        }
        "ollama" => {
            let base = config.llm_base_url.as_deref().ok_or_else(|| WorkspaceError::InvalidArgs {
                reason: "ollama provider requires llm_base_url".to_string(),
            })?;
            Ok(ChatRequestSpec {
                url: format!("{base}/api/embeddings"),
                headers: json_headers(),
                body: encode(json!({ "model": OLLAMA_EMBEDDING_MODEL, "prompt": text })),
            })
        }
        "anthropic" => Err(WorkspaceError::InvalidArgs {
            reason: "anthropic has no native embedding endpoint (ADR-321 D1) — RAG/indexing skipped for this workspace"
                .to_string(),
        }),
        other => Err(WorkspaceError::InvalidArgs {
            reason: format!("unknown llm_provider {other:?} (validated at injection — this is a bug)"),
        }),
    }
}

/// Parses the provider response body into the embedding vector.
pub fn parse_embedding_response(provider: &str, status: u64, body: &[u8]) -> Result<Vec<f32>, WorkspaceError> {
    if !(200..300).contains(&status) {
        return Err(WorkspaceError::ProviderError {
            reason: format!("{provider} embeddings answered HTTP {status}"),
        });
    }
    let body: serde_json::Value = serde_json::from_slice(body).map_err(|_| WorkspaceError::ProviderError {
        reason: format!("{provider} embeddings response is not valid JSON"),
    })?;
    let values = match provider {
        "openai" => body.pointer("/data/0/embedding"),
        "ollama" => body.pointer("/embedding"),
        other => {
            return Err(WorkspaceError::InvalidArgs {
                reason: format!("unknown llm_provider {other:?} (validated at injection — this is a bug)"),
            });
        }
    };
    let values = values.and_then(|v| v.as_array()).ok_or_else(|| WorkspaceError::ProviderError {
        reason: format!("{provider} embeddings response has no vector at the expected path"),
    })?;
    if values.is_empty() {
        return Err(WorkspaceError::ProviderError {
            reason: format!("{provider} embeddings response returned an empty vector"),
        });
    }
    values
        .iter()
        .map(|v| v.as_f64().map(|f| f as f32))
        .collect::<Option<Vec<f32>>>()
        .ok_or_else(|| WorkspaceError::ProviderError {
            reason: format!("{provider} embeddings response vector contains a non-numeric entry"),
        })
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
    fn openai_request_hits_embeddings_with_bearer() {
        let spec = build_embedding_request(&config("openai", None), "hello world").unwrap();
        assert_eq!(spec.url, "https://api.openai.com/v1/embeddings");
        assert_eq!(header(&spec, "authorization"), Some("Bearer test-key"));
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        assert_eq!(body["model"], OPENAI_EMBEDDING_MODEL);
        assert_eq!(body["input"], "hello world");
    }

    #[test]
    fn ollama_request_requires_base_url() {
        assert!(build_embedding_request(&config("ollama", None), "hello").is_err());
        let spec = build_embedding_request(&config("ollama", Some("https://ollama.example.com")), "hello").unwrap();
        assert_eq!(spec.url, "https://ollama.example.com/api/embeddings");
        let body: serde_json::Value = serde_json::from_slice(&spec.body).unwrap();
        assert_eq!(body["model"], OLLAMA_EMBEDDING_MODEL);
        assert_eq!(body["prompt"], "hello");
    }

    #[test]
    fn anthropic_has_no_embedding_endpoint() {
        match build_embedding_request(&config("anthropic", None), "hello") {
            Err(WorkspaceError::InvalidArgs { reason }) => assert!(reason.contains("no native embedding endpoint")),
            other => panic!("expected InvalidArgs, got {other:?}"),
        }
    }

    #[test]
    fn parse_openai_embedding() {
        let body = json!({ "data": [{ "embedding": [0.1, 0.2, 0.3] }] });
        let vec = parse_embedding_response("openai", 200, &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(vec, vec![0.1_f32, 0.2, 0.3]);
    }

    #[test]
    fn parse_ollama_embedding() {
        let body = json!({ "embedding": [1.0, -1.0] });
        let vec = parse_embedding_response("ollama", 200, &serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(vec, vec![1.0_f32, -1.0]);
    }

    #[test]
    fn parse_rejects_non_2xx_without_leaking_body() {
        let body = json!({ "error": { "message": "echoes the request, maybe the key" } });
        match parse_embedding_response("openai", 401, &serde_json::to_vec(&body).unwrap()) {
            Err(WorkspaceError::ProviderError { reason }) => assert_eq!(reason, "openai embeddings answered HTTP 401"),
            other => panic!("expected ProviderError, got {other:?}"),
        }
    }

    #[test]
    fn parse_rejects_missing_or_empty_vector() {
        assert!(parse_embedding_response("openai", 200, b"{}").is_err());
        let empty = json!({ "data": [{ "embedding": [] }] });
        assert!(parse_embedding_response("openai", 200, &serde_json::to_vec(&empty).unwrap()).is_err());
    }
}
