# Sam Altman RAG Project – Backend + Frontend Overview

This repo hosts a complete Retrieval-Augmented Generation stack for exploring ~100 Sam Altman interview transcripts. It includes:
- Deterministic ingestion pipeline that chunks transcripts, embeds them with OpenAI, and stores vectors in Chroma.
- FastAPI backend exposing `/classify`, `/search`, `/synthesize`, and `/healthz` endpoints for the Next.js frontend.
- Production-ready Next.js frontend (in `../podcast-analysis`) that visualizes the RAG pipeline step-by-step.
- Docker Compose orchestration plus PRDs and runbooks describing every layer.

The goal is to demonstrate transparent AI reasoning: users can ask any question, watch the system classify the intent, inspect retrieved chunks, and read a fully sourced synthesis.

---

## Directory Map

| Path | Purpose |
| --- | --- |
| `config/` | YAML configs shared by ingestion + backend (`ingestion.yaml`, `backend.yaml`). |
| `artifacts/` | Canonical outputs: Chroma index (`artifacts/index/`), chunk metadata (`artifacts/metadata/chunks.parquet`), ingestion run logs (`artifacts/logs/`). |
| `ingestion_service/` | Python CLI service that ingests transcripts, chunks text, generates embeddings, and updates Chroma. |
| `rag_backend/` | FastAPI microservice powering `/classify`, `/search`, `/synthesize`, `/healthz`. |
| `juypter_notebooks/` | Legacy notebooks (01_build_index / 02_query_playground) referenced in PRDs; no longer used for production runs. |
| `diarized_audio/transcripts/` | Source transcripts (TXT). |
| `download_youtube_audio/downloads/individual_metadata/` | Per-interview metadata (JSON). |
| `docker-compose.yml` | Orchestration for n8n, ingestion pipeline, backend, and other local services. |
| `anchor_chunking_embedding_prd.md`, `ingestion_and_embedding_pipeline_prd.md`, `config_artifacts_prd.md`, `orchestration_monitoring_prd.md` | Living PRDs covering ingestion, backend, configs, and monitoring. |

Frontend code lives in `../podcast-analysis` (see `frontend-prd.md` there).

---

## Data Flow Summary

1. **Ingestion (`ingestion_service/`)**
   - Reads transcripts from `diarized_audio/transcripts` and metadata from `download_youtube_audio/.../individual_metadata`.
   - Normalizes + chunks each transcript (token-aware, configurable size/overlap).
   - Generates embeddings via OpenAI (`text-embedding-3-small`) in batches with retry.
   - Upserts vectors + metadata into a persistent Chroma collection (`artifacts/index`).
   - Writes `artifacts/metadata/chunks.parquet`, `artifacts/metadata/manifest.parquet`, and a JSONL summary log.
   - CLI commands: `python -m app.cli rebuild`, `append`, `validate`.

2. **Backend (`rag_backend/`)**
   - Loads `config/backend.yaml`, references `artifacts/metadata/chunks.parquet`, and attaches to the same Chroma collection.
   - `/classify`: LLM (GPT-4o) classifies query intent into one of six question types.
   - `/search`: Embeds the query, retrieves top chunks, returns snippet + metadata.
   - `/synthesize`: Loads selected chunk IDs, prompts GPT-4o for answer + reasoning trace.
   - `/healthz`: Reports chunk counts, latest ingestion run metadata, and config version.

3. **Frontend (`../podcast-analysis`)**
   - Next.js app with hero/search UI, question-type pills, process visualization cards, and final answer tabs.
   - Calls backend endpoints sequentially (classify → search → synthesize) and renders retrieved chunks + reasoning trace.

---

## Configuration & Artifacts

### Config Files
- `config/ingestion.yaml`  
  ```yaml
  config_version: 1
  chunking:
    size_tokens: 600
    overlap_tokens: 90
  embedding:
    model: text-embedding-3-small
    batch_size: 64
  retrieval:
    collection_name: sam_altman_interviews
    distance_metric: cosine
  storage:
    transcripts_dir: diarized_audio/transcripts
    metadata_dir: download_youtube_audio/downloads/individual_metadata
    artifacts_dir: artifacts
    index_dir: artifacts/index
    chunk_metadata_path: artifacts/metadata/chunks.parquet
    manifest_path: artifacts/metadata/manifest.parquet
  logging:
    summaries_path: artifacts/logs/ingestion_runs.jsonl
  ```

- `config/backend.yaml`  
  ```yaml
  config_version: 1
  storage:
    artifacts_dir: artifacts
    index_dir: artifacts/index
    chunk_metadata_path: artifacts/metadata/chunks.parquet
    manifest_path: artifacts/metadata/manifest.parquet
  retrieval:
    collection_name: sam_altman_interviews
    top_k: 5
    distance_metric: cosine
  models:
    classifier: gpt-4o
    synthesizer: gpt-4o
    embedding: text-embedding-3-small
  logging:
    summaries_path: artifacts/logs/ingestion_runs.jsonl
  ```

### Environment Variables
- Set in `.env` (root) or passed via Docker:
  - `OPENAI_API_KEY` (required by ingestion + backend).
  - `INGESTION_CONFIG_PATH` (optional override inside container; defaults to `/app/config/ingestion.yaml`).
  - `RAG_BACKEND_CONFIG_PATH` (optional override; defaults to `/app/config/backend.yaml`).

### Artifacts Layout
```
artifacts/
  index/                     # Chroma persistent index (via chromadb.PersistentClient)
  metadata/
    chunks.parquet           # Chunk manifest (id, doc_id, snippet, metadata)
    manifest.parquet         # Transcript-level manifest
  logs/
    ingestion_runs.jsonl     # One-line JSON summary per ingestion run
  checkpoints/               # Reserved for future hash/manifests
```

---

## Services & Docker Compose

Key services in `docker-compose.yml`:
- `ingestion_service`: Builds from `./ingestion_service`. Runs `python -m app.cli rebuild` (configurable). Mounts transcripts, metadata, config, and artifacts directories. Requires `OPENAI_API_KEY`.
- `rag_backend`: Builds from `./rag_backend`. Serves FastAPI on `http://localhost:8018`. Depends on ingestion completion. Shares `config/` + `artifacts/` read-only.
- `n8n`: Automation/orchestration env if needed. Other legacy microservices (YouTube scraping, diarization, etc.) remain available but optional.

To rebuild + run ingestion + backend together:
```bash
docker compose build ingestion_service rag_backend
docker compose up ingestion_service rag_backend
# ingestion runs once, exits; backend stays up on port 8018
```

For local (non-Docker) runs:
```bash
# Ingestion
cd ingestion_service
pip install -r requirements.txt
cp .env.example .env   # fill OPENAI_API_KEY
python -m app.cli validate
python -m app.cli rebuild

# Backend
cd ../rag_backend
pip install -r requirements.txt
cp .env.example .env   # fill OPENAI_API_KEY
uvicorn app.main:app --reload --port 8018
```

Frontend env: set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8018` in `../podcast-analysis/.env.local`.

---

## Code Structure Highlights

### Ingestion Service (`ingestion_service/app`)
- `config.py`: Pydantic-based config loader resolving relative paths; supports `INGESTION_CONFIG_PATH`.
- `manifest.py`: Reads transcripts + metadata, builds manifest DataFrame.
- `chunker.py`: Token-aware chunking via `tiktoken`.
- `embeddings.py`: Batched OpenAI embeddings with exponential backoff.
- `indexer.py`: Chroma wrapper to reset/upsert collection.
- `pipeline.py`: Orchestrates rebuild/append flows, writes artifacts + summaries.
- `cli.py`: Typer commands `rebuild`, `append`, `validate`.

### Backend (`rag_backend/app`)
- `config.py`: Loads/wires backend config (shared `backend.yaml`).
- `chunk_store.py`: Loads chunk parquet into a Pandas index for retrieval by chunk ID.
- `retriever.py`: Embeds queries + queries Chroma.
- `llm.py`: GPT-4o-based classifier & synthesizer.
- `models.py`: Pydantic request/response schemas.
- `main.py`: FastAPI app with CORS, startup hook, and API endpoints.

### Frontend (outside this repo)
- See `../podcast-analysis/app/page.tsx` and `frontend-prd.md` for UI spec. It uses the backend endpoints to run the pipeline and shows the classification/retrieval/synthesis process.

---

## PRDs & Runbooks

Four PRDs capture system requirements and TODOs:
1. `ingestion_and_embedding_pipeline_prd.md` – ingestion service.
2. `anchor_chunking_embedding_prd.md` – backend API.
3. `config_artifacts_prd.md` – config/artifact boundaries and validation.
4. `orchestration_monitoring_prd.md` – future automation + observability (pending).

Use these docs as checklists for ongoing development, onboarding, and handoff to other LLM agents.

---

## Next Steps / Open Work

1. **Monitoring & Orchestration**: Implement Make targets, status scripts, and health checks per `orchestration_monitoring_prd.md`.
2. **Backend Tests**: Add unit/integration tests with mocked OpenAI/Chroma responses.
3. **Frontend Enhancements**: Hook up real backend endpoints, add dark mode, tooltips, etc. per `frontend-prd.md`.
4. **API Documentation**: Provide sample requests/responses (Swagger/Redoc) and note schema versions.
5. **Learning Mode**: Optional frontend toggle for walkthrough tooltips.

---

## Hand-off Checklist

When handing off to another LLM or teammate:
- Share this README plus the PRDs.
- Ensure `.env` files contain valid keys (do not commit secrets).
- Confirm `artifacts/metadata/chunks.parquet` exists (rerun ingestion if needed).
- Verify backend `/healthz` returns `status: ok` and chunk counts.
- Confirm frontend `.env.local` points to the backend.
- Note any rate-limit considerations for OpenAI (batch size, concurrency).

This documentation should give enough context for another engineer or LLM agent to replicate, extend, or deploy the entire Sam Altman Interview Explorer stack. Good luck!
