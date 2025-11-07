# PRD: Define Config & Artifact Boundaries

## Overview
- **Problem:** RAG components currently rely on implicit assumptions about paths (e.g., notebooks referencing `/Users/.../juypter_notebooks/`) and ad-hoc environment variables. This makes ingestion jobs, backend services, and the Next.js frontend fragile and hard to reproduce.
- **Goal:** Establish a single source of truth for configuration + artifacts so every service (ingestion, backend API, notebooks, frontend) knows where to read/write data, which models to use, and how to validate freshness.

## Desired Outcomes
1. **Config contract:** Canonical YAML/ENV definition covering chunk sizes, collection names, model choices, storage paths, and toggles.
2. **Artifact schema:** Clear description of what files/directories exist (`chunks.parquet`, Chroma index, logs, checkpoints), how they are versioned, and which services consume them.
3. **Validation tooling:** Simple commands to verify config + artifacts are present and compatible before running ingestion or serving traffic.

## Key Assets
- `juypter_notebooks/config/params.yaml` – today’s de facto config file; will be formalized and versioned.
- `.env` / `.env.example` files at repo root – hold secrets (OpenAI API keys) and non-secret overrides (API base URLs).
- `juypter_notebooks/artifacts/` – directory for Chroma index (`index/`), chunk metadata (`metadata/chunks.parquet`), and logs.
- `n8n-local/services.yml` + `docker-compose.yml` – where volumes/env vars are defined for ingestion + backend services.
- New doc: `config_artifacts_prd.md` (this file) keeps requirements + TODOs aligned across teams.

## Architecture Outline
1. **Config layering**
   - `params.yaml` contains non-secret defaults (chunk size, overlap, embedding model, top_k, collection name, persist dir).
   - `.env` (per environment) defines secrets + overrides (OPENAI keys, classifier/synthesis model IDs, API endpoints).
   - Services load config via a shared helper `n8n-local/shared_config/loader.py`, supporting precedence: ENV > params.yaml > hardcoded defaults.
2. **Artifact boundaries**
   - `artifacts/index/` – Chroma persistent store (mounted into ingestion + backend containers).
   - `artifacts/metadata/chunks.parquet` – authoritative chunk manifest; includes schema_version, timestamps.
   - `artifacts/logs/` – optional run logs and metrics (JSONL) for ingestion jobs.
   - `artifacts/checkpoints/` – optional hashed manifest for quick freshness checks.
3. **Validation workflow**
   - CLI `python -m shared_config.validate` ensures required env vars exist, directories are readable/writable, `chunks.parquet` schema matches expectations, and the Chroma collection is present.
   - Pre-run hooks for `rag_ingest` and `rag_api` call this validator before booting.

## Requirements
- **Single truth:** No hard-coded absolute paths inside notebooks or services; everything references config entries.
- **Compatibility versioning:** `params.yaml` includes `config_version`; `chunks.parquet` includes `schema_version`; services refuse to run if versions mismatch expected values.
- **Environment clarity:** `.env.example` lists every required variable with comments; onboarding only requires copying and filling secrets.
- **Cross-platform:** Paths must work for macOS local dev and Docker containers. Use environment variables like `DATA_ROOT` to abstract host paths.
- **Documentation:** README entries explain where artifacts live, how to regenerate them, and when to bump schema versions.

## Deliverables
- [ ] Updated `params.yaml` with explicit sections (chunking, embeddings, retrieval, synthesis, storage).
- [ ] `.env.example` covering ingestion + backend needs with explanations.
- [ ] Shared config loader library + validator CLI.
- [ ] Artifact schema doc describing each file (purpose, producer, consumer, format, version).
- [ ] Integration into `rag_ingest` and `rag_api` services (config loading + validation on start).
- [ ] Optional: small status command (`make artifacts-status`) summarizing latest ingestion timestamps, chunk counts, index size.

## Risks & Mitigations
- **Diverging configs between services:** Mitigate by importing the same `shared_config` module in ingestion + backend; forbid duplicate YAML copies.
- **Forgotten env vars:** Validator fails fast with actionable messages; CI includes config check.
- **Artifact corruption:** Maintain `artifacts/checkpoints/manifest.json` storing hash + timestamp; validator compares hash to detect tampering.
- **Human error editing YAML:** Provide JSON schema or `pydantic` validation to catch invalid types.

## TODO Checklist
### Config Structure
- [ ] Audit current config usage across notebooks, ingestion PRD, backend PRD, and frontend `.env`.
- [ ] Add `config_version` and section comments to `juypter_notebooks/config/params.yaml`.
- [ ] Document allowed overrides (e.g., `INGESTION_BATCH_SIZE`, `CHROMA_PATH`) and map them to env vars.

### Artifact Documentation
- [ ] Create `docs/artifacts.md` enumerating each artifact, schema, producer, consumer, and location.
- [ ] Add metadata fields (`schema_version`, `generated_at`, `source_hash`) to `chunks.parquet`.
- [ ] Define naming convention for new artifacts (e.g., `artifacts/logs/ingest_YYYYMMDD.jsonl`).

### Shared Utilities
- [ ] Implement `shared_config/loader.py` with layered config resolution.
- [ ] Implement `shared_config/validator.py` (CLI + Python API).
- [ ] Expose `shared_config` package to both ingestion + backend services via shared requirements file.

### Integration
- [ ] Update ingestion CLI to call validator before processing.
- [ ] Update backend FastAPI startup to validate config + artifacts and surface errors via `/healthz`.
- [ ] Add Make targets (`make validate-config`, `make artifacts-status`).

### Documentation & Onboarding
- [ ] Update root README with config + artifact overview.
- [ ] Add runbook entry describing how to bump schema versions and notify dependent services.
- [ ] Provide troubleshooting guide (missing artifacts, stale index, mismatched versions).

## Success Criteria
- New developers can run `make validate-config` and immediately know if their environment is ready.
- All services load settings exclusively from the shared config system; no duplicate constants.
- Artifacts (Chroma index + chunk metadata) have documented schemas and versioning, making ingestion/backends reproducible.
- Frontend and backend share a consistent view of API endpoints + collection names via `.env`.
