# Query Sam Altman – Monorepo

This workspace hosts the ingestion pipeline, FastAPI RAG backend, and Next.js frontend that power the Sam Altman transcript explorer. It is a clean copy of the working stack from `~/n8n-local` with transcripts, metadata, configs, and artifacts collocated so it can run independently.

## Directory Map

- `ingestion/` – Typer CLI for rebuilding the vector store (`python -m app.cli rebuild`).
- `backend/` – FastAPI service exposing `/classify`, `/search`, `/synthesize`, `/healthz`.
- `frontend/` – Next.js UI (copied from `../podcast-analysis`).
- `config/` – Shared YAML configs wired to the new `data/` + `artifacts/` paths.
- `data/` – `transcripts/` and `metadata/` copied from `diarized_audio/...` and `download_youtube_audio/...`.
- `artifacts/` – Chroma index, parquet manifests, and logs created by the ingestion pipeline.
- `docs/` – PRDs and runbooks from the original project.

## Environment Variables

Create a `.env` at the repo root (or export the variables before running commands):

```bash
cp .env.example .env
# edit with your OpenAI API key
```

- `OPENAI_API_KEY` – required by ingestion + backend.
- `NEXT_PUBLIC_API_BASE_URL` – frontend `.env.local` should point to the backend (see `frontend/.env.example`).

## Running Locally (Python)

```bash
# Ingestion
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.cli validate
python -m app.cli rebuild

# Backend
cd ../backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8018
```

## Running Locally (Next.js)

```bash
cd frontend
cp .env.example .env.local  # update API base URL if needed
npm install
npm run dev
```

## Docker Compose

A slim `docker-compose.yml` is available at the repo root. It rebuilds the embeddings before starting the backend and mounts the `config/`, `data/`, and `artifacts/` directories so everything stays in sync.

```bash
cd ~/query-sam-altman
cp .env.example .env
OPENAI_API_KEY=... docker compose up --build
```

## Verification Checklist

1. `python -m app.cli validate` succeeds inside `ingestion/`.
2. `python -m app.cli rebuild` recreates `artifacts/metadata/*.parquet` without path errors.
3. `uvicorn app.main:app --reload --port 8018` serves `/healthz` and reports chunk counts.
4. Frontend `npm run dev` hits the backend (update `.env.local` as needed).
5. `docker compose up --build` runs ingestion then backend end-to-end.

Once the new project is fully validated you can retire the original files in `~/n8n-local`.
