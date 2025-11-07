.PHONY: backend-dev ingestion-validate ingestion-rebuild ingestion-audit ingestion-enrich

backend-dev:
	uv run --env-file .env --project apps/backend uvicorn rag_backend.main:app --reload --port 8018

ingestion-validate:
	uv run --env-file .env --project apps/ingestion python -m rag_ingestion.cli validate

ingestion-rebuild:
	uv run --env-file .env --project apps/ingestion python -m rag_ingestion.cli rebuild

ingestion-audit:
	uv run --env-file .env --project apps/ingestion python -m rag_ingestion.cli audit

ingestion-enrich:
	uv run --env-file .env --project apps/ingestion python -m rag_ingestion.cli enrich
