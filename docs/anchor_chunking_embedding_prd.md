# PRD: Anchor Chunking & Embedding Logic in the Backend

## Overview
- **Objective:** Anchor a production-grade RAG API behind clearly defined HTTP endpoints so the frontend never calls notebooks or ad-hoc scripts.
- **Scope:** Convert notebook retrieval + synthesis utilities (`juypter_notebooks/notebooks/02_query_playground.ipynb`) into a backend service that exposes `/classify`, `/search`, and `/synthesize`. The service reads artifacts created by the ingestion pipeline, performs query classification, retrieves chunks, and orchestrates answer synthesis with full provenance.

## Responsibilities
1. **API surface** for the frontend (`podcast-analysis/app/page.tsx`) with stable response schemas.
2. **Shared Python modules** for classification, embeddings, retrieval, and synthesis.
3. **Runtime deployment** inside the `n8n-local` Docker stack with shared volumes and environment config.

## Key Files & Folders
- `juypter_notebooks/artifacts/index/` – Chroma collection persisted by the ingestion job.
- `juypter_notebooks/artifacts/metadata/chunks.parquet` – chunk manifest used for metadata lookups/citations.
- `juypter_notebooks/config/params.yaml` – canonical config (top_k, embedding model, collection name, persist dir, classification model).
- `n8n-local/services.yml` & `docker-compose.yml` – orchestrate backend services and volume mounts.
- `anchor_chunking_embedding_prd.md` (this file) – plan for backend API work.

## Architecture
1. **Backend package** `n8n-local/rag_backend/`
   - `config.py` – loads params + env vars (OpenAI API key, model names, classification prompts).
   - `db.py` – Chroma client wrapper that reads from `artifacts/index`.
   - `embeddings.py` – shared embeddings helper (reused by retrieval + classification if needed).
   - `classification.py` – fast intent classifier (LLM or heuristic) returning `{type, confidence}`.
   - `retrieval.py` – `search(query, question_type)` returning chunk list with scores and metadata.
   - `synthesis.py` – orchestrates answer writing (LLM call) and constructs reasoning trace.
   - `schemas.py` – Pydantic models for API requests/responses.
   - `api.py` – FastAPI app exposing `/healthz`, `/classify`, `/search`, `/synthesize`.
2. **Docker service** `rag_api` that mounts:
   - `/Users/georgepickett/n8n-local/juypter_notebooks/artifacts:/app/artifacts`
   - `/Users/georgepickett/n8n-local/juypter_notebooks/config:/app/config`
   - Shares `.env` for API keys.
3. **Data flow**
   1. `/classify` takes `{query}` → returns `{type, confidence}` using fast LLM.
   2. `/search` takes `{query, question_type}` → embeds query, queries Chroma, returns top chunks.
   3. `/synthesize` takes `{query, question_type, chunk_ids}` → loads chunk text, asks LLM for answer + reasoning trace + citations.
   4. All endpoints log latency + payload size, reject invalid input, and propagate errors with actionable messages.

## Requirements
- **Pure HTTP interface:** No notebook dependencies; only the backend service is invoked by the frontend.
- **Deterministic schemas:** Responses must match the frontend TypeScript types (classification, chunk, synthesis).
- **Config-driven:** Models, collection names, and top-k read from `params.yaml` or env overrides.
- **Security:** Validate API keys are present; block requests if the Chroma collection is missing/outdated.
- **Retries & logging:** Retry OpenAI calls with backoff and log failures (without leaking prompts).
- **Health & readiness:** `/healthz` returns ingestion timestamp and index stats, allowing deployment checks.

## Deliverables
- [ ] `rag_backend/` package with modular code (config, classifiers, retrieval, synthesis).
- [ ] FastAPI application exposing `/classify`, `/search`, `/synthesize`, `/healthz`.
- [ ] Docker service wired into `docker-compose.yml` with proper volumes and env vars.
- [ ] JSON schema documentation for each endpoint (e.g., `docs/api_contract.md`).
- [ ] Smoke tests (pytest) covering classifier, retrieval, and synthesis mocks.
- [ ] Updated frontend `.env` pointing to the running backend (e.g., `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`).

## Risks & Mitigations
- **Stale index:** Add startup checks comparing `chunks.parquet` timestamp vs. ingestion log; refuse traffic if outdated.
|- **LLM latency:** Support streaming or incremental responses later; initially keep timeouts low and share progress via status logs.
- **Schema drift with frontend:** Version API responses (`"schema_version": 1`) and document changes in the PRD.
- **Resource contention:** Use async worker pool or background tasks for long-running synthesis to avoid blocking classification.

## TODO Checklist
### Setup
- [ ] Create `rag_backend/` module with `pyproject.toml` or `requirements.txt`.
- [ ] Define `.env.example` entries (`OPENAI_API_KEY`, `CLASSIFIER_MODEL`, `SYNTH_MODEL`, etc.).
- [ ] Add Makefile or npm script to run `uvicorn rag_backend.api:app --reload`.

### Implementation
- [ ] Port classification prompt/logic from notebook into `classification.py`.
- [ ] Implement retrieval helper that reads `chunks.parquet` for metadata lookups and queries Chroma.
- [ ] Build synthesis pipeline producing `{answer, reasoning: string[], citations: [{id, source}]}`.
- [ ] Define Pydantic schemas for request/response validation.
- [ ] Wire routes in FastAPI with structured logging and error responses.

### Infrastructure
- [ ] Update `docker-compose.yml` with `rag_api` service (ports, env, volumes).
- [ ] Add service to `services.yml` for local orchestration.
- [ ] Ensure `rag_api` depends_on ingestion artifacts (document run order).

### Verification
- [ ] Write unit tests (mock OpenAI + Chroma) for classification, retrieval, synthesis.
- [ ] Add integration test hitting `/classify → /search → /synthesize` with sample transcript.
- [ ] Validate frontend integration by pointing `app/page.tsx` to the new API and running manual queries.

### Documentation
- [ ] Describe API contract + sample payloads in `docs/api_contract.md`.
- [ ] Update `execution-plan.md` with backend milestones.
- [ ] Add runbook for redeploying the backend service and refreshing configs.

## Success Criteria
- Frontend can complete the full pipeline using only the backend HTTP endpoints.
- Backend boots with deterministic config, confirms artifacts exist, and logs structured telemetry.
- CI/automation can run ingestion → backend smoke test without notebooks.
