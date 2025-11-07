from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, ValidationError

from rag_core.config import default_config_path, load_yaml_config, resolve_path


class ChunkingSettings(BaseModel):
  size_tokens: int = Field(..., gt=0)
  overlap_tokens: int = Field(..., ge=0)


class EmbeddingSettings(BaseModel):
  model: str = Field(..., min_length=1)
  batch_size: int = Field(64, gt=0)


class RetrievalSettings(BaseModel):
  collection_name: str = Field(..., min_length=1)
  distance_metric: str = Field("cosine", min_length=1)


class StorageSettings(BaseModel):
  transcripts_dir: Path
  metadata_dir: Path
  artifacts_dir: Path
  index_dir: Path
  chunk_metadata_path: Path
  manifest_path: Path
  enriched_manifest_path: Path


class LoggingSettings(BaseModel):
  summaries_path: Path
  audit_path: Path
  enrichment_errors_path: Path


class EnrichmentSettings(BaseModel):
  max_workers: int = Field(8, ge=1, le=64)


class AppConfig(BaseModel):
  config_version: int = Field(1, ge=1)
  chunking: ChunkingSettings
  embedding: EmbeddingSettings
  retrieval: RetrievalSettings
  storage: StorageSettings
  logging: LoggingSettings
  enrichment: EnrichmentSettings = Field(default_factory=EnrichmentSettings)


@dataclass
class LoadedConfig:
  raw: AppConfig
  config_path: Path
  base_dir: Path

  @property
  def chunking(self) -> ChunkingSettings:
    return self.raw.chunking

  @property
  def embedding(self) -> EmbeddingSettings:
    return self.raw.embedding

  @property
  def retrieval(self) -> RetrievalSettings:
    return self.raw.retrieval

  @property
  def storage(self) -> StorageSettings:
    return self.raw.storage

  @property
  def logging(self) -> LoggingSettings:
    return self.raw.logging

  @property
  def enrichment(self) -> EnrichmentSettings:
    return self.raw.enrichment

  def ensure_storage_paths(self) -> None:
    self.storage.artifacts_dir.mkdir(parents=True, exist_ok=True)
    self.storage.index_dir.mkdir(parents=True, exist_ok=True)
    self.storage.chunk_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    self.storage.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    self.storage.enriched_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    self.logging.summaries_path.parent.mkdir(parents=True, exist_ok=True)
    self.logging.audit_path.parent.mkdir(parents=True, exist_ok=True)
    self.logging.enrichment_errors_path.parent.mkdir(parents=True, exist_ok=True)


def _resolve_paths(config: AppConfig, base_dir: Path) -> AppConfig:
  storage = config.storage
  resolved_storage = StorageSettings(
    transcripts_dir=resolve_path(base_dir, storage.transcripts_dir),
    metadata_dir=resolve_path(base_dir, storage.metadata_dir),
    artifacts_dir=resolve_path(base_dir, storage.artifacts_dir),
    index_dir=resolve_path(base_dir, storage.index_dir),
    chunk_metadata_path=resolve_path(base_dir, storage.chunk_metadata_path),
    manifest_path=resolve_path(base_dir, storage.manifest_path),
    enriched_manifest_path=resolve_path(base_dir, storage.enriched_manifest_path),
  )
  resolved_logging = LoggingSettings(
    summaries_path=resolve_path(base_dir, config.logging.summaries_path),
    audit_path=resolve_path(base_dir, config.logging.audit_path),
    enrichment_errors_path=resolve_path(base_dir, config.logging.enrichment_errors_path),
  )
  enrichment = config.enrichment or EnrichmentSettings()
  return AppConfig(
    config_version=config.config_version,
    chunking=config.chunking,
    embedding=config.embedding,
    retrieval=config.retrieval,
    storage=resolved_storage,
    logging=resolved_logging,
    enrichment=enrichment,
  )


def load_config(config_path: Optional[Path] = None) -> LoadedConfig:
  provided_path = config_path or default_config_path("INGESTION_CONFIG_PATH", "config/ingestion.yaml")
  data = load_yaml_config(provided_path)
  try:
    parsed = AppConfig(**data)
  except ValidationError as exc:
    raise ValueError(f"Invalid config: {exc}") from exc
  base_dir = provided_path.parent.parent.resolve()
  resolved = _resolve_paths(parsed, base_dir)
  return LoadedConfig(raw=resolved, config_path=provided_path, base_dir=base_dir)
