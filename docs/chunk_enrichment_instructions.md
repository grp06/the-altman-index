# Chunk Enrichment Implementation Brief

This document is aimed at the LLM/agent that will finish the remaining analytical-enrichment work. Focus only on what is *not* built yet: chunk-level enrichment, extra embedding vectors, and schema versioning in the ingestion summaries.

## 1. Chunk Enrichment Module
1. **Placement**: Hook into `IngestionPipeline` immediately after chunk generation (`IngestionPipeline._chunk_manifest`). Use a new module, e.g., `rag_ingestion/chunk_enrichment.py`.
2. **Inputs**: Per-chunk rows (id, text, doc metadata). Reuse the new document-level enrichment cache pattern (raw JSON under `var/artifacts/enrichment/chunks/`), keyed by chunk id.
3. **Outputs** (persisted in `chunks.parquet` and passed to Chroma):
   - `chunk_summary`: single-sentence abstract.
   - `chunk_intents`: list (argument, anecdote, roadmap, counterpoint, etc.).
   - `chunk_sentiment`: simple sentiment/tone label.
   - `chunk_claims`: list of concise claims or statements.
   - `chunk_enrichment_version`: integer for schema tracking.
4. **API**: Use the same OpenAI Responses client as document enrichment; batch with the existing executor pattern. Fetch chunk snippets using chunk text trimmed to ~800 tokens.
5. **Storage**: Update `chunks.parquet` writing to Parquet to include the new columns. Ensure Absent data defaults (empty string/list) so Parquet schema is stable.
6. **CLI**: No new CLI command—chunk enrichment must run automatically during `ingestion-rebuild`/`append`. Expose a config knob `enrichment.chunk_max_workers` if needed; otherwise reuse `enrichment.max_workers`.

## 2. Secondary Embeddings
1. **Data**: For every chunk, compute additional embeddings for:
   - `chunk_summary`
   - `chunk_intents` (joined string)
   - `doc_summary` (document-level data already available)
2. **Storage**: Write these vectors to new Parquet files under `var/artifacts/metadata/`:
   - `chunk_summary_embeddings.parquet`
   - `chunk_intents_embeddings.parquet`
   - `doc_summary_embeddings.parquet`
   Each file should contain `id`, `vector`, `source_field`, `embedding_model`, `created_at`.
3. **Indexing**: Option A: store the vectors in additional Chroma collections (e.g., `<collection>_summary`, `<collection>_intents`). Option B: extend the existing collection with metadata fields distinguishing vector types. Pick one approach and document it in code comments + README note.
   - Implementation uses Option A with collections suffixed `_summary`, `_intents`, and `_docsum`.
4. **Versioning**: Include `embedding_set_version` in each Parquet file so rebuilds can compare versions before reusing cached vectors.

## 3. Summary Log Versioning
1. Extend `_build_summary` in `pipeline.py` to include:
   - `chunk_schema_version`
   - `document_enrichment_version`
   - `chunk_enrichment_version`
   - `embedding_set_version`
   - `enrichment_model` (e.g., `gpt-5` or whatever model string).
2. Update `ChunkStore` and backend startup checks to read these fields and fail fast if the stored schema versions don’t match the expected constants in code.
3. Document the new summary fields inside `docs/phase1_plan.md` so humans understand the log output.

## 4. Testing & Observability
1. Add unit tests covering chunk enrichment JSON parsing and caching (similar to `test_document_enrichment`).
2. Add integration coverage for the additional embeddings (mock embedding client to avoid API calls).
3. Ensure `var/artifacts/logs/enrichment_errors.jsonl` also records chunk-level failures with chunk IDs.

## 5. Retrieval Integration

Enriched chunk fields are now first-class citizens in the backend and frontend layers:

- `rag_backend.retriever` merges hits from the primary, summary, intents, and doc-summary collections. Every chunk in the `/search` response carries `chunk_summary`, `chunk_intents`, `chunk_sentiment`, `chunk_claims`, and `vector_source`.
- Optional `intent_filters` and `sentiment_filters` in the `/search` request let the UI (or any API client) pivot retrieval without post-filtering.
- `collections_used` and `retrieval_mode` in the response make it obvious which profiles were activated and how many hits each Chroma collection contributed.

Example `/search` response fragment:

```
{
  "retrieval_mode": "analytical",
  "aggregated_count": 9,
  "collections_used": [
    {"source": "primary", "name": "sam_altman_interviews", "requested": 5, "returned": 4},
    {"source": "summary", "name": "sam_altman_interviews_summary", "requested": 5, "returned": 3},
    {"source": "intents", "name": "sam_altman_interviews_intents", "requested": 4, "returned": 2}
  ],
  "chunks": [
    {
      "id": "20180729...::chunk::3",
      "snippet": "Document-level summary or chunk text...",
      "score": 0.83,
      "vector_source": "summary",
      "chunk_summary": "Altman outlines how YC evaluates...",
      "chunk_intents": ["Roadmap", "Warning"],
      "chunk_sentiment": "optimistic",
      "chunk_claims": [
        "YC looks for durable founder obsession.",
        "Speed of iteration outruns big-budget planning."
      ],
      "metadata": {
        "title": "...",
        "doc_id": "...",
        "youtube_url": "...",
        "time_span": "2018"
      }
    }
  ]
}
```

## 6. Version + Cache Troubleshooting

- `ChunkStore.verify_summary_versions` now requires the ingestion summary to match `rag_core.schema_versions`. If the backend crashes on startup with a version mismatch, run `make ingestion-rebuild` to refresh artifacts.
- Use `make ingestion-inspect` (Typer command `python -m rag_ingestion.cli inspect`) to print document/chunk cache counts, unique versions, and last modified times before toggling force rebuilds.
- When schemas change, follow the [Enrichment Cache Runbook](enrichment_cache_runbook.md) to clear `var/artifacts/enrichment/raw` and `var/artifacts/enrichment/chunks`, rerun ingestion, and confirm `/healthz` exposes the new `secondary_embeddings_updated_at` timestamp.
