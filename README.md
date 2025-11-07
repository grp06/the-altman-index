# Query Sam Altman – Transparent RAG Playground

This repo powers an end-to-end Retrieval-Augmented Generation experience for ~100 Sam Altman interviews. Users can ask any question, watch the system classify its intent, inspect the retrieved chunks, and read a grounded synthesis with citations. The goal is to demystify how RAG works while showcasing production-ready ingestion, backend, and frontend code.

## What’s Included
- **Deterministic ingestion pipeline** – token-aware chunking, batched OpenAI embeddings, Chroma persistence, and JSONL run summaries.
- **FastAPI backend** – `/classify`, `/search`, `/synthesize`, `/healthz` with strict schemas and logging.
- **Next.js frontend** – question-type pills, suggested prompts, pipeline status UI, and trace tabs.
- **Shared Python utilities** – config + logging helpers inside `libs/python/core`.
- **Make targets + Docker compose** – simple commands for local runs or containerized orchestration.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `apps/ingestion` | `rag_ingestion` Typer CLI (chunking, embeddings, Chroma upserts). |
| `apps/backend` | `rag_backend` FastAPI server for classify → search → synthesize. |
| `apps/frontend` | Next.js UI that visualizes the pipeline. |
| `libs/python/core` | Shared helpers (`rag_core`) for config + logging. |
| `infra/docker` | Compose file that runs ingestion then backend. |
| `var/data` | Source transcripts + metadata (not committed). |
| `var/artifacts` | Generated chunks, manifests, indexes, logs (not committed). |
| `Makefile` | Shortcuts for backend + ingestion commands. |
| `ROADMAP.md` | Active to-do list for upcoming features. |

## Prerequisites
1. **Python 3.11+** with [`uv`](https://docs.astral.sh/uv/) installed (the repo already vendors `uv.lock`).
2. **Node.js 18+** for the Next.js frontend.
3. **OpenAI API key** – stored in `.env` at the repo root.
4. **Transcripts + metadata** – drop `.txt` files into `var/data/transcripts/` and JSON metadata into `var/data/metadata/`. Nothing under `var/` is tracked by git except `var/README.md`.

```bash
cp .env.example .env
echo "OPENAI_API_KEY=sk-..." >> .env
mkdir -p var/data/transcripts var/data/metadata var/artifacts
```

## First-Time Setup
```bash
uv sync --project apps/ingestion
uv sync --project apps/backend
cd apps/frontend && npm install && cd -
```

## Ingestion CLI
The ingestion pipeline reads from `var/data`, writes manifests/parquet files to `var/artifacts`, and logs summaries to `var/artifacts/logs/ingestion_runs.jsonl`.

```bash
# Validate directories + config
make ingestion-validate

# Rebuild the entire vector store (recreates chunks + Chroma index)
make ingestion-rebuild
```

Artifacts after a rebuild:
```
var/
  artifacts/
    index/                      # Chroma persistent store
    metadata/
      chunks.parquet            # Chunk manifest with ids + metadata
      manifest.parquet          # Transcript-level manifest
    logs/
      ingestion_runs.jsonl      # One JSON line per run
```

## Backend Service
Run the FastAPI server with live reload and automatic `.env` loading:

```bash
make backend-dev
# Equivalent: uv run --env-file .env --project apps/backend uvicorn rag_backend.main:app --reload --port 8018
```

Helpful endpoints:
- `GET /healthz` – chunk count, last ingestion run, config version.
- `POST /classify` – `{query}` → `{type, confidence}` using GPT-4o.
- `POST /search` – `{query, question_type, top_k?}` → relevant chunks + scores.
- `POST /synthesize` – `{query, question_type, chunk_ids[]}` → grounded answer + reasoning trace.

Question types (`rag_backend.constants.QUESTION_TYPES`): `factual`, `analytical`, `meta`, `exploratory`, `comparative`, `creative`.

## Frontend
```bash
cd apps/frontend
cp .env.example .env.local        # default points to http://localhost:8018
npm run dev                       # http://localhost:3000
```

The UI walks users through:
1. Selecting a question (or choosing from pill-based suggestions).
2. Seeing live status updates (“classifying”, “retrieving”, “synthesizing”).
3. Inspecting retrieved chunks (score, title, links).
4. Reading the synthesized answer with reasoning steps.

## Docker Compose (Optional)
```bash
cp .env.example .env    # ensure OPENAI_API_KEY is populated
docker compose -f infra/docker/compose.yaml --profile ingestion up --build   # run ingestion job
docker compose -f infra/docker/compose.yaml up --build                       # start backend only
```
The compose file mounts `config/` and `var/` into each container, so local artifacts remain the source of truth.

## API Quick Reference

| Endpoint | Payload | Notes |
| --- | --- | --- |
| `GET /healthz` | – | Confirms backend booted with valid artifacts and shows last ingestion summary. |
| `POST /classify` | `{"query": "What does Sam Altman think about AGI?"}` | Returns `{ "type": "factual", "confidence": 0.92 }`. |
| `POST /search` | `{"query": "...", "question_type": "analytical", "top_k": 8}` | Embeds query, queries Chroma, returns chunks `{id, snippet, score, metadata}`. |
| `POST /synthesize` | `{"query": "...", "question_type": "comparative", "chunk_ids": [...]}` | Fetches full chunk text, prompts GPT-4o to produce `{answer, reasoning[]}`. |

## Troubleshooting
- **Startup fails with OpenAI errors** – ensure `OPENAI_API_KEY` is set in `.env`; `make backend-dev` automatically loads it.
- **No chunks detected** – confirm `var/artifacts/metadata/chunks.parquet` exists (rerun `make ingestion-rebuild`).
- **Chroma path mismatch** – configs (`config/*.yaml`) assume artifacts live under `var/`; update paths if you relocate data.
- **Health check stale** – check `var/artifacts/logs/ingestion_runs.jsonl` for the latest run and rerun ingestion if needed.
- **Frontend can’t reach backend** – verify `apps/frontend/.env.local` points to `http://localhost:8018` and CORS is enabled by default.

For upcoming work, see [`ROADMAP.md`](ROADMAP.md).
