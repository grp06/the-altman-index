from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field, ValidationError


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


class LoggingSettings(BaseModel):
  summaries_path: Path


class AppConfig(BaseModel):
  config_version: int = Field(1, ge=1)
  chunking: ChunkingSettings
  embedding: EmbeddingSettings
  retrieval: RetrievalSettings
  storage: StorageSettings
  logging: LoggingSettings


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

  def ensure_storage_paths(self) -> None:
    self.storage.artifacts_dir.mkdir(parents=True, exist_ok=True)
    self.storage.index_dir.mkdir(parents=True, exist_ok=True)
    self.storage.chunk_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    self.storage.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    self.logging.summaries_path.parent.mkdir(parents=True, exist_ok=True)


def _resolve_path(base_dir: Path, path_value: Path) -> Path:
  if path_value.is_absolute():
    return path_value
  return (base_dir / path_value).resolve()


def _resolve_paths(config: AppConfig, base_dir: Path) -> AppConfig:
  storage = config.storage
  resolved_storage = StorageSettings(
    transcripts_dir=_resolve_path(base_dir, storage.transcripts_dir),
    metadata_dir=_resolve_path(base_dir, storage.metadata_dir),
    artifacts_dir=_resolve_path(base_dir, storage.artifacts_dir),
    index_dir=_resolve_path(base_dir, storage.index_dir),
    chunk_metadata_path=_resolve_path(base_dir, storage.chunk_metadata_path),
    manifest_path=_resolve_path(base_dir, storage.manifest_path),
  )
  resolved_logging = LoggingSettings(
    summaries_path=_resolve_path(base_dir, config.logging.summaries_path)
  )
  return AppConfig(
    config_version=config.config_version,
    chunking=config.chunking,
    embedding=config.embedding,
    retrieval=config.retrieval,
    storage=resolved_storage,
    logging=resolved_logging,
  )


def load_config(config_path: Optional[Path] = None) -> LoadedConfig:
  provided_path = config_path
  if config_path is None:
    env_override = os.getenv("INGESTION_CONFIG_PATH")
    if env_override:
      provided_path = Path(env_override).expanduser()
    else:
      repo_root = Path(__file__).resolve().parents[2]
      provided_path = repo_root / "config" / "ingestion.yaml"
  if not provided_path.exists():
    raise FileNotFoundError(f"Config path not found: {provided_path}")
  with provided_path.open("r", encoding="utf-8") as handle:
    data: dict[str, Any] = yaml.safe_load(handle)
  try:
    parsed = AppConfig(**data)
  except ValidationError as exc:
    raise ValueError(f"Invalid config: {exc}") from exc
  base_dir = provided_path.parent.parent.resolve()
  resolved = _resolve_paths(parsed, base_dir)
  return LoadedConfig(raw=resolved, config_path=provided_path, base_dir=base_dir)
