from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, ValidationError

from rag_core.config import default_config_path, load_yaml_config, resolve_path


class StorageSettings(BaseModel):
  artifacts_dir: Path
  index_dir: Path
  chunk_metadata_path: Path
  manifest_path: Path
  enriched_manifest_path: Path
  chunk_summary_embeddings_path: Path
  chunk_intents_embeddings_path: Path
  doc_summary_embeddings_path: Path


class RetrievalProfileSettings(BaseModel):
  collections: list[str] = Field(..., min_length=1)
  per_collection_k: dict[str, int] = Field(default_factory=dict)
  blend: str = Field("score", min_length=1)


class RetrievalSettings(BaseModel):
  collection_name: str = Field(..., min_length=1)
  top_k: int = Field(5, gt=0)
  distance_metric: str = Field("cosine", min_length=1)
  summary_collection_name: Optional[str] = None
  intents_collection_name: Optional[str] = None
  doc_summary_collection_name: Optional[str] = None
  profiles: dict[str, RetrievalProfileSettings] = Field(default_factory=dict)


class ModelSettings(BaseModel):
  classifier: str = Field(..., min_length=1)
  synthesizer: str = Field(..., min_length=1)
  embedding: str = Field(..., min_length=1)


class ServerSettings(BaseModel):
  host: str = "0.0.0.0"
  port: int = Field(8000, gt=0)


class LoggingSettings(BaseModel):
  summaries_path: Path


class AppConfig(BaseModel):
  config_version: int = Field(1, ge=1)
  storage: StorageSettings
  retrieval: RetrievalSettings
  models: ModelSettings
  server: ServerSettings = ServerSettings()
  logging: LoggingSettings


@dataclass
class LoadedConfig:
  raw: AppConfig
  config_path: Path
  base_dir: Path

  @property
  def storage(self) -> StorageSettings:
    return self.raw.storage

  @property
  def retrieval(self) -> RetrievalSettings:
    return self.raw.retrieval

  @property
  def models(self) -> ModelSettings:
    return self.raw.models

  @property
  def server(self) -> ServerSettings:
    return self.raw.server

  @property
  def logging(self) -> LoggingSettings:
    return self.raw.logging


def _resolve_config(config: AppConfig, base_dir: Path) -> AppConfig:
  storage = config.storage
  resolved_storage = StorageSettings(
    artifacts_dir=resolve_path(base_dir, storage.artifacts_dir),
    index_dir=resolve_path(base_dir, storage.index_dir),
    chunk_metadata_path=resolve_path(base_dir, storage.chunk_metadata_path),
    manifest_path=resolve_path(base_dir, storage.manifest_path),
    enriched_manifest_path=resolve_path(base_dir, storage.enriched_manifest_path),
    chunk_summary_embeddings_path=resolve_path(base_dir, storage.chunk_summary_embeddings_path),
    chunk_intents_embeddings_path=resolve_path(base_dir, storage.chunk_intents_embeddings_path),
    doc_summary_embeddings_path=resolve_path(base_dir, storage.doc_summary_embeddings_path),
  )
  logging_settings = LoggingSettings(
    summaries_path=resolve_path(base_dir, config.logging.summaries_path)
  )
  retrieval = config.retrieval
  summary_collection = retrieval.summary_collection_name or f"{retrieval.collection_name}_summary"
  intents_collection = retrieval.intents_collection_name or f"{retrieval.collection_name}_intents"
  docsum_collection = retrieval.doc_summary_collection_name or f"{retrieval.collection_name}_docsum"
  resolved_retrieval = RetrievalSettings(
    collection_name=retrieval.collection_name,
    top_k=retrieval.top_k,
    distance_metric=retrieval.distance_metric,
    summary_collection_name=summary_collection,
    intents_collection_name=intents_collection,
    doc_summary_collection_name=docsum_collection,
    profiles=retrieval.profiles,
  )
  return AppConfig(
    config_version=config.config_version,
    storage=resolved_storage,
    retrieval=resolved_retrieval,
    models=config.models,
    server=config.server,
    logging=logging_settings,
  )


def load_config(config_path: Optional[Path] = None) -> LoadedConfig:
  path = config_path or default_config_path("RAG_BACKEND_CONFIG_PATH", "config/backend.yaml")
  data = load_yaml_config(path)
  try:
    parsed = AppConfig(**data)
  except ValidationError as exc:
    raise ValueError(f"Invalid backend config: {exc}") from exc
  base_dir = path.parent.parent.resolve()
  resolved = _resolve_config(parsed, base_dir)
  return LoadedConfig(raw=resolved, config_path=path, base_dir=base_dir)
