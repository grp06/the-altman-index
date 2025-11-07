FROM python:3.11-slim

ENV UV_NO_PROGRESS=1
ENV PYTHONUNBUFFERED=1

WORKDIR /workspace

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY libs/python/core/pyproject.toml libs/python/core/pyproject.toml
COPY libs/python/core/src libs/python/core/src
COPY apps/ingestion/pyproject.toml apps/ingestion/pyproject.toml
COPY apps/ingestion/src apps/ingestion/src

RUN uv sync --frozen --no-dev --project apps/ingestion

ENV PATH="/workspace/apps/ingestion/.venv/bin:${PATH}"
ENV PYTHONPATH="/workspace/apps/ingestion/src"

ENTRYPOINT ["python", "-m", "rag_ingestion.cli"]
CMD ["--help"]
