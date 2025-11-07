# PRD: Add Orchestration & Monitoring

## Overview
- **Why:** Ingestion and backend services currently run manually (`python notebook`, `npm run dev`). We need reproducible orchestration plus visibility into run health, failures, and freshness so the RAG stack can be trusted.
- **Goal:** Introduce lightweight automation (Docker/n8n workflows + scripts) to run ingestion, deploy the backend API, and track metrics/logs. Add monitoring hooks that surface run status, index freshness, and API uptime to developers.

## Scope
1. **Job orchestration** – deterministic commands/pipelines that rebuild the index, start the API, and refresh configs.
2. **Monitoring & logging** – structured logs, metrics, and alerts indicating success/failure for ingestion and API workloads.
3. **Freshness tracking** – easy way to know when artifacts were last rebuilt and whether they align with the running backend.

## Dependencies
- Ingestion pipeline PRD (`ingestion_and_embedding_pipeline_prd.md`) – produces artifacts.
- Backend API PRD (`anchor_chunking_embedding_prd.md`) – serves queries.
- Config PRD (`config_artifacts_prd.md`) – defines paths/env vars consumed here.
- Infrastructure files: `docker-compose.yml`, `services.yml`, `juypter_notebooks/artifacts/`, `juypter_notebooks/config/params.yaml`.

## High-Level Architecture
1. **Makefile / scripts** at repo root:
   - `make ingest` → run ingestion container with proper env + volumes.
   - `make api` → start backend API service.
   - `make status` → show artifact freshness + service health.
2. **n8n/Docker scheduling:** optional `rag_ingest_cron` service that triggers ingestion nightly or on new transcripts (watch folder).
3. **Monitoring stack (minimal):**
   - Structured JSON logs (ingestion + API).
   - Metrics summary persisted to `artifacts/logs/ingestion_metrics.jsonl`.
   - Health endpoint `/healthz` consumed by a simple watcher script (`scripts/watch_health.py`) or n8n flow that pings and notifies on failure (e.g., Slack/webhook).
4. **Freshness manifest:** `artifacts/checkpoints/latest.json` capturing run timestamp, chunk count, config hash; exposed via `/healthz` and CLI.

## Requirements
- **One-command workflows:** Developers can run `make ingest && make api` to reproduce the system locally.
- **Idempotent automation:** Orchestration commands can be rerun without manual cleanup; they exit non-zero on failure.
- **Visibility:** Every ingestion run emits metrics: transcripts processed, batches, duration, token count, errors. Backend logs request counts, latency buckets, and error summaries.
- **Alerting hook:** Provide at least one integration point (e.g., n8n HTTP webhook) that fires when ingestion fails or health check reports stale data.
- **Documentation:** README or `docs/runbooks/orchestration.md` describing how to run jobs, interpret status output, and troubleshoot.

## Deliverables
- [ ] Make targets or shell scripts for ingestion, API, and status checks.
- [ ] Optional n8n workflow (JSON) or instructions to schedule ingestion and ping `/healthz`.
- [ ] Logging format spec + actual structured logs in `artifacts/logs/`.
- [ ] Freshness manifest (`artifacts/checkpoints/latest.json`) generated after each ingestion run.
- [ ] Health watcher script or lightweight monitoring service referencing manifests + API endpoints.
- [ ] Documentation detailing orchestration commands, cron schedule, monitoring outputs, and alerting setup.

## Risks & Mitigations
- **Over-complex orchestration:** Keep it simple (Make + Docker + optional n8n). Avoid heavy infra unless necessary.
- **Silent failures:** Use `set -euo pipefail` in scripts, check exit codes, and write fail logs.
- **Clock skew or stale artifacts:** Freshness manifest includes `config_hash` and `generated_at` so mismatches are obvious.
- **Log noise vs. signal:** Define concise log schema (timestamp, component, event, payload) to keep noise low while preserving context.

## TODO Checklist
### Orchestration
- [ ] Add Makefile targets (`ingest`, `api`, `stop`, `status`).
- [ ] Ensure targets call `shared_config.validate` before running.
- [ ] Update `services.yml`/`docker-compose.yml` with dependencies (API waits for ingestion artifacts).
- [ ] Provide optional `docker compose run rag_ingest` command wrapper.

### Monitoring
- [ ] Define ingestion log schema (JSON per batch with counts/errors).
- [ ] Emit summary metrics + manifest after each ingestion run.
- [ ] Enhance backend `/healthz` to include artifact timestamp, schema version, and recent error count.
- [ ] Create `scripts/watch_health.py` (or n8n workflow) that pings `/healthz` and alerts on failure/staleness.
- [ ] Document how to tail logs (`docker logs rag_ingest`, `docker logs rag_api`) and interpret them.

### Documentation
- [ ] Create `docs/runbooks/orchestration.md` covering:
   - How to trigger ingestion manually.
   - How to check status/freshness.
   - How to restart services.
   - How alerting works.
- [ ] Update `execution-plan.md` with orchestration milestones.

## Success Criteria
- Any developer can run end-to-end ingestion + API with two commands and confirm success via `make status`.
- Ingestion runs produce structured logs + manifest, and failures are surfaced automatically.
- `/healthz` reports accurate freshness + dependency status, allowing monitoring scripts to detect regressions quickly.
