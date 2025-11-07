.PHONY: backend-dev ingestion-validate ingestion-rebuild

backend-dev:
	uv run --env-file .env --project apps/backend uvicorn rag_backend.main:app --reload --port 8018

ingestion-validate:
	uv run --project apps/ingestion python -m rag_ingestion.cli validate

ingestion-rebuild:
	uv run --project apps/ingestion python -m rag_ingestion.cli rebuild
