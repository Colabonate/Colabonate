//! Per-workspace context vector store (ADR-321 D1/D2/D6/D7) — cosine
//! similarity over `Workspace.context_index`, the embedded chat/tool-output
//! chunks accumulated as a workspace runs.
//!
//! **Deviation from the ADR's own D2 sketch, documented not silently cut:**
//! the ADR names HNSW (approximate nearest-neighbor) as the index structure.
//! HNSW earns its complexity only once a dataset doesn't fit an exact scan —
//! a single workspace's chat/tool-output count is realistically in the tens
//! to low hundreds (bounded further by real ICP outcall/cycle cost per
//! embedding, and by workspaces being destroyed on expiry rather than
//! accumulating forever), where a brute-force O(n) cosine scan is both
//! simpler AND exact (no approximation error, no graph-maintenance code to
//! get wrong in `no_std`-adjacent wasm). Real follow-up if/when a single
//! workspace's context volume is shown to matter at scale — see FU-461.
//!
//! D6 (cross-chat shared context) falls out for free: the index lives on the
//! `Workspace` struct, not per-chat, so any future second chat in the same
//! workspace (FU-453) already shares it without new code here.
//!
//! Pure functions — `cargo test` covers them without the IC runtime.

use crate::types::IndexedChunk;

/// Cosine similarity in [-1.0, 1.0]. Returns 0.0 for a zero-magnitude vector
/// or mismatched dimensions (embedding providers/models never mix within one
/// workspace's config, so a dimension mismatch would indicate a bug — failing
/// soft to "no match" is safer than panicking mid-outcall-chain).
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

pub struct ScoredChunk<'a> {
    pub chunk: &'a IndexedChunk,
    pub score: f32,
}

/// Returns the `k` chunks most similar to `query`, sorted by descending
/// similarity. `k = 0` or an empty index both correctly return an empty Vec.
pub fn top_k<'a>(query: &[f32], chunks: &'a [IndexedChunk], k: usize) -> Vec<ScoredChunk<'a>> {
    if k == 0 {
        return Vec::new();
    }
    let mut scored: Vec<ScoredChunk<'a>> = chunks
        .iter()
        .map(|chunk| ScoredChunk {
            chunk,
            score: cosine_similarity(query, &chunk.embedding),
        })
        .collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(content: &str, embedding: Vec<f32>) -> IndexedChunk {
        IndexedChunk {
            content: content.to_string(),
            embedding,
            source: "chat:user".to_string(),
            created_at: 0,
        }
    }

    #[test]
    fn identical_vectors_score_one() {
        assert!((cosine_similarity(&[1.0, 2.0, 3.0], &[1.0, 2.0, 3.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn orthogonal_vectors_score_zero() {
        assert!((cosine_similarity(&[1.0, 0.0], &[0.0, 1.0])).abs() < 1e-6);
    }

    #[test]
    fn opposite_vectors_score_minus_one() {
        assert!((cosine_similarity(&[1.0, 0.0], &[-1.0, 0.0]) - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn zero_vector_or_mismatched_dims_score_zero_not_panic() {
        assert_eq!(cosine_similarity(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
        assert_eq!(cosine_similarity(&[1.0, 2.0], &[1.0, 2.0, 3.0]), 0.0);
        assert_eq!(cosine_similarity(&[], &[]), 0.0);
    }

    #[test]
    fn top_k_orders_by_similarity_and_respects_k() {
        let chunks = vec![
            chunk("far", vec![0.0, 1.0]),
            chunk("exact", vec![1.0, 0.0]),
            chunk("close", vec![0.9, 0.1]),
        ];
        let results = top_k(&[1.0, 0.0], &chunks, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].chunk.content, "exact");
        assert_eq!(results[1].chunk.content, "close");
    }

    #[test]
    fn top_k_zero_or_empty_index_returns_empty() {
        let chunks = vec![chunk("a", vec![1.0, 0.0])];
        assert!(top_k(&[1.0, 0.0], &chunks, 0).is_empty());
        assert!(top_k(&[1.0, 0.0], &[], 5).is_empty());
    }
}
