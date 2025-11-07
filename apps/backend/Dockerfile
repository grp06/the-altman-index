FROM python:3.11-slim

ENV UV_NO_PROGRESS=1

WORKDIR /workspace

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
COPY libs/python/core/pyproject.toml libs/python/core/pyproject.toml
COPY libs/python/core/src libs/python/core/src
COPY apps/backend/pyproject.toml apps/backend/pyproject.toml
COPY apps/backend/src apps/backend/src

RUN uv sync --frozen --no-dev --project apps/backend

ENV PATH="/workspace/apps/backend/.venv/bin:${PATH}"
ENV PYTHONPATH="/workspace/apps/backend/src"

CMD ["uvicorn", "rag_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
