from pathlib import Path

import pytest

from rag_ingestion.config import (
  AppConfig,
  ChunkingSettings,
  EmbeddingSettings,
  EnrichmentSettings,
  LoadedConfig,
  LoggingSettings,
  RetrievalSettings,
  StorageSettings,
)


@pytest.fixture
def loaded_config(tmp_path: Path) -> LoadedConfig:
  transcripts_dir = tmp_path / "transcripts"
  metadata_dir = tmp_path / "metadata"
  artifacts_dir = tmp_path / "artifacts"
  transcripts_dir.mkdir(parents=True)
  metadata_dir.mkdir(parents=True)
  storage = StorageSettings(
    transcripts_dir=transcripts_dir,
    metadata_dir=metadata_dir,
    artifacts_dir=artifacts_dir,
    index_dir=artifacts_dir / "index",
    chunk_metadata_path=artifacts_dir / "metadata" / "chunks.parquet",
    manifest_path=artifacts_dir / "metadata" / "manifest.parquet",
    enriched_manifest_path=artifacts_dir / "metadata" / "manifest_enriched.parquet",
    chunk_summary_embeddings_path=artifacts_dir / "metadata" / "chunk_summary_embeddings.parquet",
    chunk_intents_embeddings_path=artifacts_dir / "metadata" / "chunk_intents_embeddings.parquet",
    doc_summary_embeddings_path=artifacts_dir / "metadata" / "doc_summary_embeddings.parquet",
  )
  logging = LoggingSettings(
    summaries_path=artifacts_dir / "logs" / "ingestion_runs.jsonl",
    audit_path=artifacts_dir / "logs" / "corpus_audit.jsonl",
    enrichment_errors_path=artifacts_dir / "logs" / "enrichment_errors.jsonl",
  )
  enrichment = EnrichmentSettings(max_workers=1)
  app_config = AppConfig(
    config_version=1,
    chunking=ChunkingSettings(size_tokens=200, overlap_tokens=20),
    embedding=EmbeddingSettings(model="text-embedding-3-small", batch_size=2),
    retrieval=RetrievalSettings(collection_name="test", distance_metric="cosine"),
    storage=storage,
    logging=logging,
    enrichment=enrichment,
  )
  loaded = LoadedConfig(raw=app_config, config_path=tmp_path / "config.yaml", base_dir=tmp_path)
  loaded.ensure_storage_paths()
  return loaded
