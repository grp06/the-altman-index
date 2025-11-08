# PRD: Intent-Aware Retrieval & UI Using Enriched Chunk Metadata

_Last updated: 2025-11-08 — context captured from the fully rebuilt ingestion pipeline (97 transcripts, 761 chunks)._

## 1. Background & Current State

We now have a deterministic ingestion pipeline (`apps/ingestion`) that enriches every transcript and chunk before indexing. Key artifacts:

- `var/artifacts/metadata/chunks.parquet` — chunk rows include `chunk_summary`, `chunk_intents`, `chunk_sentiment`, `chunk_claims`, `chunk_enrichment_version`.
- `var/artifacts/metadata/manifest_enriched.parquet` — document-level metadata with summaries, entities, time spans.
- Secondary embedding Parquet files (`chunk_summary_embeddings`, `chunk_intents_embeddings`, `doc_summary_embeddings`) plus matching Chroma collections:  
  `sam_altman_interviews`, `sam_altman_interviews_summary`, `sam_altman_interviews_intents`, `sam_altman_interviews_docsum`.
- Version guardrails live in `rag_core.schema_versions`; backend startup (`apps/backend/src/rag_backend/main.py`) now fails fast if stored artifacts get out of sync.

What’s missing: the backend/UX still treats all queries as vanilla semantic search. None of the enriched metadata or secondary embeddings flow through `/search`, `/synthesize`, or the frontend visualizations. This PRD defines how another LLM/agent should leverage the new signals to deliver intent-aware retrieval and richer transparency.

## 2. Goals

1. **Mode-aware retrieval:** Route classified question types to retrieval strategies that exploit the new embeddings/fields (factual vs analytical vs comparative).
2. **Metadata-forward responses:** Expose chunk summaries, intents, sentiment, and claims in the API payloads and UI so users see *why* a chunk was chosen.
3. **Document-level context:** Enable timeline/overview queries using the doc-summary embeddings without extra ingestion passes.
4. **Observability:** Track enrichment cache hit rates, version mismatches, and secondary collection freshness during backend startup and ad-hoc validation.

Success criteria:
- `/search` response structure carries enriched metadata and indicates which collection(s) were queried.
- UI shows intent chips, sentiment badges, and claim snippets per chunk card.
- Analytical/comparative questions pull from the summary/intents/docsum collections in addition to the primary semantic index.
- Automated tests cover routing, payload schemas, and regression protection for version mismatches.

## 3. Assumptions & Constraints

- Do **not** change ingestion schemas or enrichment models; assume the metadata already exists and is up to date.
- Keep config-driven paths consistent with `config/backend.yaml` and `config/ingestion.yaml`; prefer adding explicit knobs instead of hard-coding.
- The backend continues to classify question type via `/classify` (LLM). Use that output to route retrieval modes.
- Cost-sensitive: no additional LLM calls in the online path other than existing classify/synthesize steps.
- Avoid introducing new persistence layers; reuse Chroma + Parquet artifacts generated today.

## 4. Requirements

### 4.1 Retrieval Layer (Backend)
1. **Mode routing:** Define retrieval profiles (e.g., `factual`, `analytical`, `comparative`) in `rag_backend.retriever`. Each profile specifies:
   - Which Chroma collections to query.
   - Default `top_k` per collection.
   - Blending/merging strategy (e.g., interleave by score, union with dedupe).
2. **Secondary queries:** Implement helper(s) to query `_summary`, `_intents`, `_docsum` collections and merge results with base collection hits, annotating each chunk with `vector_source`.
3. **Filters/pivots:** Add optional filters for intents or sentiment using metadata stored alongside chunks; allow the frontend to request `intent_filters` or `sentiment_filters`.

### 4.2 API Surface
1. Extend `SearchResponse.ChunkMetadata` (apps/backend/src/rag_backend/models.py) with:
   - `chunk_summary`
   - `chunk_intents`
   - `chunk_sentiment`
   - `chunk_claims`
   - `vector_source` (primary | summary | intents | docsum)
2. `/search` endpoint: include routing info (`retrieval_mode`, `collections_used`, `aggregated_count`).
3. `/synthesize`: optionally prioritize chunk summaries to craft prompts (e.g., pass `chunk_summary` + `claims` into the LLM prompt template) without altering ingestion.

### 4.3 Frontend Updates (apps/frontend)
1. **Chunk cards:** show summary, highlight intents as chips, show sentiment badge, list top claim(s).
2. **Mode indicators:** reflect retrieval mode (e.g., pill telling user “Analytical retrieval – cluster view”).
3. **Analytical view:** add optional tab that clusters by intent or sentiment using the metadata (client-side grouping is fine initially).
4. **Comparative view:** When multiple doc-summary hits are returned, render a split panel by doc or time span.

### 4.4 Observability & Tooling
1. Backend `/healthz` should expose last ingestion summary fields already stored (`chunk_schema_version`, etc.) plus the timestamp of the latest secondary embedding parquet.
2. Add a CLI target (e.g., `make ingestion-inspect`) or Typer command to print enrichment cache stats: counts of chunk/document cache files, last modified time, schema versions detected.
3. Logging: when retrieval profiles trigger cross-collection queries, log the mode, collection counts, and elapsed time at INFO level.

### 4.5 Testing
1. Backend unit tests for retrieval routing and payload serialization (mock Chroma to return deterministic hits per collection).
2. Snapshot/API tests ensuring `/search` returns the new metadata fields and rejects outdated chunk schemas gracefully.
3. Frontend component/unit tests for new UI elements (intent chips, sentiment badge, comparative layout).
4. CLI/tooling test: use tmp dirs to validate the new inspector command without touching real artifacts.

### 4.6 Documentation
1. Update `README.md` and `docs/chunk_enrichment_instructions.md` with retrieval-mode behavior, API response examples, and troubleshooting steps for version mismatches.
2. Add a short runbook describing how to clear chunk/document caches (`var/artifacts/enrichment/...`) and rerun ingestion if schemas change.

## 5. Implementation Guidance

| Area | Files / Modules | Notes |
| --- | --- | --- |
| Retrieval profiles | `apps/backend/src/rag_backend/retriever.py` | Introduce a strategy map keyed by question type; keep OpenAI embedding calls unchanged. |
| Response schema | `apps/backend/src/rag_backend/models.py`, `main.py` | Ensure pydantic validation enforces new metadata fields. |
| Frontend components | `apps/frontend/components/*`, `pages/index.tsx` | Consume new API payload shape; mind hydration constraints when adding chips/badges. |
| CLI tooling | `apps/ingestion/src/rag_ingestion/cli.py` | Reuse existing logging helpers; keep command idempotent and read-only. |
| Docs | `README.md`, `docs/chunk_enrichment_instructions.md`, new runbook under `docs/`. | Showcase request/response samples for each retrieval mode. |

## 6. Milestones

1. **Backend routing & API (Week 1)**  
   - Retrieval profiles implemented, tests passing, `/search` payload updated.
2. **Frontend experience (Week 2)**  
   - UI reflects enriched metadata; analytical/comparative views released behind a feature flag.
3. **Observability & Docs (Week 2)**  
   - Health/check/runbook updates live, inspector CLI merged.
4. **Stabilization (Week 3)**  
   - E2E testing across rebuild + backend + frontend; regressions addressed.

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Retrieval routing increases latency | Slower search responses | Cap per-collection `top_k`, parallelize collection queries, cache doc-summary hits when possible. |
| Frontend payload drift | UI crashes when backend deploys first | Implement backwards-compatible parsing with feature flags; coordinate release order. |
| Schema version drift | Backend refuses to start after config changes | Maintain schema constants in `rag_core.schema_versions`, document bump process, and gate backend deploys on successful ingestion rebuild. |

## 8. Acceptance Checklist

- [ ] `/search` exposes enriched metadata + retrieval metadata; tests cover new schema.
- [ ] Retrieval strategies map question types to the right collections; analytical/comparative questions demonstrate broader coverage.
- [ ] Frontend visualizes intents/sentiment/claims and indicates retrieval mode.
- [ ] `/healthz` + new CLI tooling provide operators with cache/version visibility.
- [ ] Documentation/runbooks updated; instructions enable future agents to rerun ingestion safely.

Deliver this PRD to the next LLM so they can build the intent-aware experience without needing the full conversational history. All required artifacts, configs, and expectations are captured above.
