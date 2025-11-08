# Enrichment Cache Runbook

Use this runbook whenever chunk or document enrichment schemas bump and the backend refuses to start with a version mismatch.

## 1. Inspect Current State
1. Run `make ingestion-inspect` to print cache counts, detected versions, and last modified timestamps.
2. Check `/healthz` (if the backend is still serving) for `secondary_embeddings_updated_at`. A `null` value usually means the secondary Parquet files are missing or stale.

## 2. Clear Stale Caches
1. Stop the backend so no process is reading from `var/artifacts`.
2. Move or delete the raw enrichment caches:
   - `var/artifacts/enrichment/raw/` (document-level JSON payloads)
   - `var/artifacts/enrichment/chunks/` (chunk-level JSON payloads)
3. Remove the secondary embedding parquet files under `var/artifacts/metadata/` if the embedding set version changed:
   - `chunk_summary_embeddings.parquet`
   - `chunk_intents_embeddings.parquet`
   - `doc_summary_embeddings.parquet`

## 3. Rebuild Ingestion
1. Rerun the full pipeline: `make ingestion-rebuild`
   - This regenerates manifests, chunks, enrichment caches, embeddings, and Chroma collections using the new schema version.
2. Confirm that `var/artifacts/logs/ingestion_runs.jsonl` has a new line with the expected `*_version` fields.

## 4. Validate
1. Run `make ingestion-inspect` again to verify cache counts and versions align with `rag_core.schema_versions`.
2. Start the backend (`make backend-dev`). `/healthz` should now show a fresh `secondary_embeddings_updated_at` timestamp plus the latest ingestion summary.
3. Hit `/search` with a simple query to ensure chunks include the enriched fields (`chunk_summary`, `chunk_intents`, etc.) and the frontend surfaces the retrieval mode pill.

Document the cache reset in your deployment notes so other operators know the artifacts were rebuilt.
