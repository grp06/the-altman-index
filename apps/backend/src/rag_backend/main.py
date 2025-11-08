from __future__ import annotations

import json
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from rag_core.logging import configure_logging, get_logger

from .chunk_store import ChunkStore
from .config import LoadedConfig, load_config
from .llm import LLMService
from .models import (
  ClassifyRequest,
  ClassifyResponse,
  HealthResponse,
  SearchRequest,
  SearchResponse,
  SynthesizeRequest,
  SynthesizeResponse,
)
from .retriever import Retriever

logger = get_logger(__name__)

app = FastAPI()
app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_methods=["*"],
  allow_headers=["*"],
)

CONFIG: Optional[LoadedConfig] = None
CHUNK_STORE: Optional[ChunkStore] = None
RETRIEVER: Optional[Retriever] = None
LLM: Optional[LLMService] = None


@app.on_event("startup")
def startup_event() -> None:
  global CONFIG, CHUNK_STORE, RETRIEVER, LLM
  configure_logging()
  CONFIG = load_config()
  CHUNK_STORE = ChunkStore(CONFIG.storage.chunk_metadata_path)
  latest_run = CHUNK_STORE.latest_ingestion_run(CONFIG.logging.summaries_path)
  CHUNK_STORE.verify_summary_versions(latest_run)
  RETRIEVER = Retriever(CONFIG)
  LLM = LLMService(CONFIG)
  logger.info(
    "Backend ready with %s chunks and collection %s",
    CHUNK_STORE.count,
    CONFIG.retrieval.collection_name,
  )


def require_state() -> tuple[LoadedConfig, ChunkStore, Retriever, LLMService]:
  if not all([CONFIG, CHUNK_STORE, RETRIEVER, LLM]):
    raise HTTPException(status_code=503, detail="Backend not initialized")
  return CONFIG, CHUNK_STORE, RETRIEVER, LLM


@app.get("/healthz", response_model=HealthResponse)
def health() -> HealthResponse:
  config, store, _, _ = require_state()
  latest_run = store.latest_ingestion_run(config.logging.summaries_path)
  return HealthResponse(
    status="ok",
    chunks=store.count,
    last_ingestion_run=latest_run,
    config_version=config.raw.config_version,
  )


@app.post("/classify", response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> ClassifyResponse:
  _, _, _, llm = require_state()
  try:
    result = llm.classify(request.query)
  except json.JSONDecodeError as exc:
    logger.error("Classifier returned invalid JSON: %s", exc)
    raise HTTPException(status_code=502, detail="Classifier response invalid") from exc
  except Exception as exc:  # noqa: BLE001
    logger.error("Classifier failure: %s", exc)
    raise HTTPException(status_code=502, detail="Classifier request failed") from exc
  return ClassifyResponse(**result)


@app.post("/search", response_model=SearchResponse)
def search(request: SearchRequest) -> SearchResponse:
  config, _, retriever, _ = require_state()
  top_k = request.top_k or config.retrieval.top_k
  try:
    result = retriever.search(request.query, top_k)
  except Exception as exc:  # noqa: BLE001
    logger.error("Retrieval failure: %s", exc)
    raise HTTPException(status_code=502, detail="Retrieval failed") from exc
  return SearchResponse(**result)


@app.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
  _, store, _, llm = require_state()
  try:
    contexts = store.get_by_ids(request.chunk_ids)
  except KeyError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  try:
    result = llm.synthesize(request.query, request.question_type, contexts)
  except json.JSONDecodeError as exc:
    logger.error("Synthesizer returned invalid JSON: %s", exc)
    raise HTTPException(status_code=502, detail="Synthesis response invalid") from exc
  except Exception as exc:  # noqa: BLE001
    logger.error("Synthesis failure: %s", exc)
    raise HTTPException(status_code=502, detail="Synthesis failed") from exc
  return SynthesizeResponse(**result)
