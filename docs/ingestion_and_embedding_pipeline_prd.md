# PRD: Stabilize Ingestion & Embedding Pipeline

## Overview
- **Current state:** RAG prototyping lives inside `juypter_notebooks/notebooks/01_build_index.ipynb` and `02_query_playground.ipynb`. Chunking, OpenAI embeddings, and Chroma indexing run manually on the developer laptop, so output artifacts (`juypter_notebooks/artifacts/index` + `juypter_notebooks/artifacts/metadata/chunks.parquet`) are fragile and hard to reproduce.
- **Target state:** A deterministic ingestion service inside the `n8n-local` Docker stack that can (1) ingest Sam Altman transcripts and metadata from mounted folders, (2) normalize + chunk text, (3) generate embeddings, (4) upsert into a persistent Chroma collection, and (5) expose CLI workflows so the RAG API and frontend always point at a known-good index.

## Scope
1. **Ingestion CLI/Service** that owns chunking + embedding.
2. **Artifact contract** for where metadata, vectors, and config live.
3. **Operational checklist** (env vars, logging, reruns) so the pipeline is repeatable.

## Key Directories & Files
- `juypter_notebooks/transcripts/` – source Sam Altman transcripts (TXT).
- `juypter_notebooks/individual_metadata/` – per-interview JSON metadata.
- `juypter_notebooks/config/params.yaml` – chunk size, overlap, top-k, collection name, persist directory, embedding model.
- `juypter_notebooks/artifacts/index/` – Chroma persistent directory (will be mounted into the backend service).
- `juypter_notebooks/artifacts/metadata/chunks.parquet` – chunk manifest used by retrieval + analytics.
- `juypter_notebooks/notebooks/01_build_index.ipynb` – current one-off ingestion logic.
- `docker-compose.yml` & `services.yml` – orchestration hooks for building and running the new ingestion container.
- `ingestion_and_embedding_pipeline_prd.md` (this doc) – single source of truth for the ingestion roadmap.

## Architecture Plan
1. **Python package:** Create `n8n-local/ingestion_service/` with modules:
   - `config.py` – loads `params.yaml`, validates env vars (OpenAI API key, collection name, chunk params).
   - `chunker.py` – token counting, normalization, overlap logic (ported from notebook).
   - `embeddings.py` – batched OpenAI embedding calls with retry/backoff.
   - `indexer.py` – Chroma client wrapper for create/upsert operations.
   - `cli.py` – Typer/Click entry point for `python -m ingestion_service.cli rebuild` and `append`.
2. **Dockerized worker:** Add a service `rag_ingest` in `docker-compose.yml` that mounts:
   - `/Users/georgepickett/n8n-local/juypter_notebooks/transcripts` → `/app/transcripts`
   - `/Users/georgepickett/n8n-local/juypter_notebooks/individual_metadata` → `/app/individual_metadata`
   - `/Users/georgepickett/n8n-local/juypter_notebooks/artifacts` → `/app/artifacts`
   So the ingestion container writes directly to the same Chroma directory used by the RAG API.
3. **Execution flow:**
   1. Load config + validate inputs.
   2. Build manifest from transcripts + metadata.
   3. Normalize + chunk each transcript (token-aware).
   4. Serialize chunk metadata to Parquet/CSV.
   5. Batch embed new chunks and upsert into Chroma.
   6. Emit summary metrics (chunks added, tokens, timing) to stdout/logs.

## Constraints & Requirements
- **Deterministic outputs:** Given the same transcripts + config, the pipeline must produce identical `chunks.parquet` and Chroma entries.
- **Idempotent runs:** Re-running `rebuild` should truncate the collection before inserting new data; `append` only processes new transcripts.
- **Observability:** Every run prints a concise summary (counts, durations, failures) and exits non-zero on error. No silent failures.
- **Environment security:** Only read required env vars (e.g., `OPENAI_API_KEY`) and fail fast if missing. No secrets in source control.
- **Resource limits:** Respect OpenAI rate limits via batch sizes + retry with exponential backoff.
- **Portability:** Code must run both on macOS dev env and inside Docker without path edits.

## Deliverables
- [ ] `ingestion_service/` Python package with chunking + embedding modules.
- [ ] CLI supporting `rebuild` (full reindex) and `append` (new transcripts only).
- [ ] Docker service + instructions for running ingestion inside `docker-compose`.
- [ ] Updated documentation describing inputs, outputs, and run commands.
- [ ] Proven artifacts: regenerated `artifacts/index/` + `artifacts/metadata/chunks.parquet` with summary log.

## Risks & Mitigations
- **Large batches hitting rate limits:** Mitigate with configurable `batch_size`, retry logic, and progress logging per batch.
- **Corrupt Chroma state:** Before `rebuild`, snapshot or delete the existing collection via API to avoid partial overwrites.
- **Schema drift:** Version the chunk manifest schema (add `schema_version` field) so downstream services can validate compatibility.
- **Filesystem mismatch:** Use env-driven mount paths, and add startup checks to ensure transcripts + metadata folders exist.

## TODO Checklist
### Planning & Setup
- [ ] Mirror notebook requirements into `ingestion_service/pyproject.toml` or `requirements.txt`.
- [ ] Define `.env.example` entries required by the ingestion service.
- [ ] Document expected directory structure in `README`.

### Implementation
- [ ] Port chunking + normalization logic into reusable functions.
- [ ] Implement manifest builder that merges transcript + metadata rows.
- [ ] Add batching + embedding wrapper with retries + logging.
- [ ] Wrap Chroma interaction in helper (create/get collection, upsert, truncate).
- [ ] Write CLI commands (`rebuild`, `append`, `validate`).
- [ ] Record metrics (chunks count, tokens, duration) per run.

### Infrastructure
- [ ] Add ingestion image/service to `docker-compose.yml` and `services.yml`.
- [ ] Mount shared volumes (transcripts, metadata, artifacts) into the container.
- [ ] Provide `make ingest` or `npm run ingest` script for local execution.

### Verification
- [ ] Dry-run on a subset of transcripts and compare outputs vs. notebook artifacts.
- [ ] Full rebuild to regenerate `artifacts/index` and `chunks.parquet`.
- [ ] Smoke-test retrieval using `02_query_playground` pointing at the new index.
- [ ] Update frontend `.env` / backend configs if collection names or paths change.

### Documentation & Handoff
- [ ] Update `execution-plan.md` with new ingestion flow.
- [ ] Describe runbooks for `rebuild` vs `append` (when to run, expected runtime).
- [ ] Note failure recovery steps (rerun batch, skip file, manual cleanup).

## Success Criteria
- Single command (`python -m ingestion_service.cli rebuild` or Docker equivalent) ingests all transcripts without manual notebook steps.
- Chroma collection + chunk metadata remain in sync and can be rebuilt on demand.
- Logs provide enough context to debug failures (batch number, transcript id, API response).
- Frontend `/classify → /search → /synthesize` pipeline reads from this stabilized index without additional manual intervention.
