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
