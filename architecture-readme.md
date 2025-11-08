# Architecture README

This document explains how the Query Sam Altman workspace is wired together so future contributors can reason about the system without digging through every file first. It complements `README.md` by focusing on structure, data flow, and the responsibilities of each layer.

## Goals & Guarantees
- **Transparent RAG** – every retrieval is traceable from ingestion to UI, with chunk-level enrichment explaining *why* a passage showed up.
- **Deterministic ingestion** – repeated runs of the pipeline produce stable Parquet + Chroma outputs guarded by schema versions.
- **Mode-aware retrieval** – classified question types route to retrieval profiles that mix semantic, summary, intent, and doc-summary embeddings.
- **Operational guardrails** – startup fails fast on schema drift, cache inspectors surface enrichment freshness, and `/healthz` exposes ingestion metadata.

## High-Level Data Flow
1. **Source prep** – transcripts and metadata land in `var/data/{transcripts,metadata}`.
2. **Ingestion pipeline (`apps/ingestion`)**  
   - `Chunker` slices transcripts into overlapping windows.  
   - `DocumentEnrichmentService` creates per-doc summaries, entities, themes, etc.  
   - `ChunkEnrichmentService` attaches summaries, intents, sentiment, and claims per chunk.  
   - `EmbeddingClient` encodes chunk text, chunk summaries, chunk intents, and doc summaries.  
   - `ChromaIndexer` writes vectors into the primary collection plus `_summary`, `_intents`, `_docsum`.  
   - `SecondaryEmbeddingService` stores matching Parquet artifacts for offline inspection.  
   - Each run appends an entry to `var/artifacts/logs/ingestion_runs.jsonl` with schema + enrichment versions pulled from `rag_core.schema_versions`.
3. **Storage layout (`config/backend.yaml` mirrors ingestion paths)**  
   - `var/artifacts/metadata/chunks.parquet` – canonical chunk manifest with enrichment columns.  
   - `var/artifacts/index/` – Chroma persistent client directory for all collections.  
   - `var/artifacts/metadata/{chunk_summary_embeddings,chunk_intents_embeddings,doc_summary_embeddings}.parquet` – caches for secondary vectors.  
   - `var/artifacts/metadata/manifest[_enriched].parquet` – transcript manifests (raw + enriched).
4. **Backend service (`apps/backend`)**  
   - FastAPI app in `rag_backend.main` loads config, instantiates `ChunkStore`, `Retriever`, `LLMService`, and verifies ingestion versions before serving traffic.  
   - `ChunkStore` reads `chunks.parquet`, indexes by chunk id, and tracks doc→chunk anchors for doc-summary hits.  
   - `Retriever` embeds the query (`OpenAI` embeddings), runs profile-specific queries across the four Chroma collections, merges hits, optionally applies intent/sentiment filters supplied by API clients, and returns enriched chunk metadata along with `retrieval_mode`, `collections_used`, and `vector_source`.  
   - `LLMService` handles `/classify` and `/synthesize` calls, passing chunk summaries/claims into the synthesis prompt so the LLM understands the enrichment.  
   - `/healthz` now includes `secondary_embeddings_updated_at`, derived from the mtime of the secondary Parquet files.
5. **Frontend (`apps/frontend`)**  
   - Single-page Next.js app (`app/page.tsx`) orchestrates classify → search → synthesize.  
   - `app/lib/retrieval.ts` normalizes API payloads, enforces vector-source types, and groups chunks into intent, sentiment, and doc-summary clusters.  
   - UI surfaces mode pills, collection stats, intent chips, sentiment badges, claim snippets, and comparative doc-summary grids, so the enriched metadata is visible to users.

## Key Modules & Files
| Area | File(s) | Highlights |
| --- | --- | --- |
| Config | `config/backend.yaml`, `config/ingestion.yaml`, `apps/**/src/rag_*_config.py` | Paths are resolved relative to repo root; both services share the `rag_core.config` helpers. |
| Schema versions | `libs/python/core/src/rag_core/schema_versions.py` | Backend startup checks `chunk_schema_version`, `chunk_enrichment_version`, `document_enrichment_version`, `embedding_set_version`, and `enrichment_model`. |
| Ingestion CLI | `apps/ingestion/src/rag_ingestion/cli.py` | Commands: `rebuild`, `append`, `validate`, `audit`, `enrich`, `inspect`. `make ingestion-inspect` prints cache counts and version info. |
| Enrichment caches | `var/artifacts/enrichment/raw/` (doc) and `var/artifacts/enrichment/chunks/` (chunk) | JSON payloads keyed by doc/chunk id with version headers to support reuse. |
| Secondary embeddings | `apps/ingestion/src/rag_ingestion/secondary_embeddings.py` | Writes Parquet rows with columns `(id, vector, source_field, embedding_model, embedding_set_version, created_at)` and upserts the associated Chroma collection via `ChromaIndexer.upsert_secondary`. |
| Retrieval profiles | `apps/backend/src/rag_backend/retriever.py` | Default map routes `factual` → primary, `analytical` → primary+summary+intents, `comparative` → primary+docsum+summary, with overrides configurable per question type. Filters are applied post-merge to avoid repeated queries. |
| API models | `apps/backend/src/rag_backend/models.py` | `SearchRequest` validates `question_type` and filter strings; `SearchResponse` bundles aggregated count, mode, collection usage, and enriched `ChunkMetadata`. |
| Frontend helpers | `apps/frontend/app/lib/retrieval.ts` | Type guards + grouping helpers keep the page component lean; Vitest covers serialization edge cases. |
| Observability | `/healthz`, `var/artifacts/logs/ingestion_runs.jsonl`, `make ingestion-inspect`, `docs/enrichment_cache_runbook.md` | Operators can detect stale caches, confirm ingestion versions, and clear artifacts safely. |

## Runtime Configuration & Deployment Notes
- **Environment variables** – `.env` at repo root feeds `OPENAI_API_KEY` (loaded automatically by `uv run --env-file .env ...` commands and by the frontend’s `.env.local`).
- **Local dev** – `make ingestion-rebuild` to regenerate artifacts, `make backend-dev` for FastAPI with reload, `npm run dev` in `apps/frontend`.  
- **Docker compose** – `infra/docker/compose.yaml` orchestrates ingestion then backend using the same configs and mounts `config/` plus `var/`.
- **Testing** – `uv run --project apps/backend pytest`, `uv run --project apps/ingestion pytest`, `npm run test` (Vitest). CI should run all three suites after changing retrieval/enrichment logic.

## Operational Runbooks
- **Cache resets** – see `docs/enrichment_cache_runbook.md` for the canonical “inspect → clear → rebuild → validate” workflow when schema versions bump.
- **Schema drift** – backend startup will raise if `ChunkStore.verify_summary_versions` detects mismatches; treat that as a signal to rerun ingestion rather than patching code.
- **Monitoring retrieval** – check backend logs for `mode`, `collection counts`, and `elapsed` entries emitted by `Retriever.search` to spot regressions in coverage or latency.

## Extending the Architecture
- **New enrichment fields** – add them to `ChunkEnrichmentService`, propagate columns through `chunks.parquet`, bump versions, and surface them in `ChunkMetadata` + frontend components.
- **Additional retrieval profiles** – declare the profile in `config/backend.yaml` and plug it into `QUESTION_TYPE_TO_PROFILE` (or send the new profile name directly via `/search`).
- **Alternate frontends** – leverage the `/search` payload’s `vector_source`, `chunk_summary`, `chunk_intents`, `chunk_sentiment`, and `chunk_claims` fields to build analytics dashboards without touching ingestion/backend code.

This architecture intentionally keeps the ingestion pipeline deterministic, the backend stateless (besides Chroma + Parquet artifacts), and the frontend declarative so each layer can evolve independently while still sharing the same metadata contracts.
