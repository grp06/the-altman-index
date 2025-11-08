from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from rag_core.logging import get_logger
from rag_core.schema_versions import (
  CHUNK_ENRICHMENT_VERSION,
  CHUNK_SCHEMA_VERSION,
  DOCUMENT_ENRICHMENT_VERSION,
  EMBEDDING_SET_VERSION,
  ENRICHMENT_MODEL_NAME,
)

from .chunk_enrichment import ChunkEnrichmentService
from .chunker import Chunker
from .config import LoadedConfig
from .embeddings import EmbeddingClient
from .enrichment import DocumentEnrichmentService
from .indexer import ChromaIndexer
from .manifest import build_manifest
from .secondary_embeddings import SecondaryEmbeddingService

logger = get_logger(__name__)


class IngestionPipeline:
  def __init__(self, config: LoadedConfig):
    self.config = config
    self.chunker = Chunker(
      chunk_size=config.chunking.size_tokens,
      overlap=config.chunking.overlap_tokens,
    )
    self.embed_client = EmbeddingClient(
      model=config.embedding.model,
      batch_size=config.embedding.batch_size,
    )
    self.enrichment = DocumentEnrichmentService(config)
    self.chunk_enrichment = ChunkEnrichmentService(config)
    self.secondary_embeddings = SecondaryEmbeddingService(config, self.embed_client)
    self.indexer = ChromaIndexer(
      index_path=str(config.storage.index_dir),
      collection_name=config.retrieval.collection_name,
      distance_metric=config.retrieval.distance_metric,
    )

  def run_rebuild(self) -> dict:
    logger.info("Starting full rebuild")
    start = time.perf_counter()
    # like a table of documents to process
    manifest = build_manifest(self.config.storage.transcripts_dir, self.config.storage.metadata_dir)
    enriched_manifest = self.enrichment.ensure_enriched(manifest)
    # like a table of chunks to create
    chunks_df = self._chunk_manifest(enriched_manifest)
    chunks_df = self.chunk_enrichment.ensure_enriched(chunks_df)
    self._persist_dataframes(enriched_manifest, chunks_df)
    secondary_payloads = self.secondary_embeddings.generate(
      mode="rebuild",
      chunks=chunks_df,
      manifest=enriched_manifest,
    )
    embeddings = self._embed_chunks(chunks_df)
    self.indexer.reset()
    self.indexer.upsert(
      ids=chunks_df["id"].tolist(),
      embeddings=embeddings,
      metadatas=chunks_df.drop(columns=["text"]).to_dict(orient="records"),
      documents=chunks_df["text"].tolist(),
    )
    for key, payload in secondary_payloads.items():
      self.indexer.upsert_secondary(
        key=key,
        ids=payload["ids"],
        embeddings=payload["embeddings"],
        metadatas=payload["metadatas"],
        documents=payload["documents"],
      )
    elapsed = time.perf_counter() - start
    summary = self._build_summary(
      mode="rebuild",
      manifest=enriched_manifest,
      chunks=chunks_df,
      duration_seconds=elapsed,
      enrichment_total=len(enriched_manifest),
    )
    self._write_summary(summary)
    logger.info("Rebuild complete in %.2fs with %s chunks", elapsed, len(chunks_df))
    return summary

  def run_append(self) -> dict:
    logger.info("Starting append run")
    start = time.perf_counter()
    if not self.config.storage.chunk_metadata_path.exists():
      logger.info("Chunk metadata missing; running full rebuild instead")
      return self.run_rebuild()
    manifest = build_manifest(self.config.storage.transcripts_dir, self.config.storage.metadata_dir)
    enriched_full = self.enrichment.ensure_enriched(manifest)
    existing_chunks = pd.read_parquet(self.config.storage.chunk_metadata_path)
    self._ensure_chunk_schema(existing_chunks)
    processed_docs = set(existing_chunks["doc_id"].unique())
    enriched_manifest = enriched_full[~enriched_full["doc_id"].isin(processed_docs)]
    if enriched_manifest.empty:
      logger.info("No new transcripts detected; append skipped")
      summary = self._build_summary(
        mode="append",
        manifest=pd.DataFrame(columns=["doc_id"]),
        chunks=pd.DataFrame(columns=["id"]),
        duration_seconds=0.0,
        skipped=True,
        enrichment_total=len(enriched_full),
      )
      self._write_summary(summary)
      return summary
    chunks_df = self._chunk_manifest(enriched_manifest)
    chunks_df = self.chunk_enrichment.ensure_enriched(chunks_df)
    combined_chunks = pd.concat([existing_chunks, chunks_df], ignore_index=True)
    self._persist_dataframes(manifest=None, chunks=combined_chunks, new_manifest=enriched_manifest)
    secondary_payloads = self.secondary_embeddings.generate(
      mode="append",
      chunks=chunks_df,
      manifest=enriched_manifest,
    )
    embeddings = self._embed_chunks(chunks_df)
    self.indexer.upsert(
      ids=chunks_df["id"].tolist(),
      embeddings=embeddings,
      metadatas=chunks_df.drop(columns=["text"]).to_dict(orient="records"),
      documents=chunks_df["text"].tolist(),
    )
    for key, payload in secondary_payloads.items():
      self.indexer.upsert_secondary(
        key=key,
        ids=payload["ids"],
        embeddings=payload["embeddings"],
        metadatas=payload["metadatas"],
        documents=payload["documents"],
      )
    summary = self._build_summary(
      mode="append",
      manifest=enriched_manifest,
      chunks=chunks_df,
      duration_seconds=time.perf_counter() - start,
      enrichment_total=len(enriched_full),
    )
    self._write_summary(summary)
    logger.info("Append complete with %s new chunks", len(chunks_df))
    return summary

  def _chunk_manifest(self, manifest: pd.DataFrame) -> pd.DataFrame:
    chunk_rows = []
    for _, row in manifest.iterrows():
      path = Path(row["source_path"])
      with path.open("r", encoding="utf-8") as handle:
        text = handle.read()
      chunks = self.chunker.chunk(row["doc_id"], text)
      title = row.get("title") or ""
      upload_date = row.get("upload_date") or ""
      youtube_url = row.get("youtube_url") or ""
      source_path = row.get("source_path") or ""
      source_name = row.get("source_name") or ""
      doc_summary = self._stringify_metadata(row.get("doc_summary"))
      key_themes = self._stringify_metadata(row.get("key_themes"))
      time_span = self._stringify_metadata(row.get("time_span"))
      entities = self._stringify_metadata(row.get("entities"))
      stance_notes = self._stringify_metadata(row.get("stance_notes"))
      speaker_stats = self._stringify_metadata(row.get("speaker_stats"))
      token_count = self._safe_int(row.get("token_count"))
      turn_count = self._safe_int(row.get("turn_count"))
      for chunk in chunks:
        chunk_rows.append(
          {
            **chunk,
            "title": title,
            "upload_date": upload_date,
            "youtube_url": youtube_url,
            "source_path": source_path,
            "source_name": source_name,
            "doc_summary": doc_summary,
            "key_themes": key_themes,
            "time_span": time_span,
            "entities": entities,
            "stance_notes": stance_notes,
            "speaker_stats": speaker_stats,
            "doc_token_count": token_count,
            "doc_turn_count": turn_count,
          }
        )
    chunks_df = pd.DataFrame(chunk_rows)
    if chunks_df.empty:
      raise ValueError("Chunking produced no rows")
    logger.info("Chunked %s transcripts into %s chunks", len(manifest), len(chunks_df))
    return chunks_df

  def _persist_dataframes(
    self,
    manifest: Optional[pd.DataFrame],
    chunks: pd.DataFrame,
    new_manifest: Optional[pd.DataFrame] = None,
  ) -> None:
    self.config.ensure_storage_paths()
    if manifest is not None:
      manifest.to_parquet(self.config.storage.manifest_path, index=False)
      logger.info("Saved manifest to %s", self.config.storage.manifest_path)
    if new_manifest is not None:
      existing_manifest = (
        pd.read_parquet(self.config.storage.manifest_path)
        if self.config.storage.manifest_path.exists()
        else pd.DataFrame()
      )
      updated_manifest = pd.concat([existing_manifest, new_manifest], ignore_index=True)
      updated_manifest.drop_duplicates(subset=["doc_id"], inplace=True)
      updated_manifest.to_parquet(self.config.storage.manifest_path, index=False)
      logger.info("Updated manifest with %s new rows", len(new_manifest))
    chunks.to_parquet(self.config.storage.chunk_metadata_path, index=False)
    logger.info("Saved %s chunks to %s", len(chunks), self.config.storage.chunk_metadata_path)

  def _embed_chunks(self, chunks: pd.DataFrame) -> list:
    records = chunks[["id", "text"]].to_dict(orient="records")
    embeddings = self.embed_client.embed(records)
    if len(embeddings) != len(records):
      raise ValueError("Embedding count mismatch")
    return embeddings

  def _build_summary(
    self,
    mode: str,
    manifest: pd.DataFrame,
    chunks: pd.DataFrame,
    duration_seconds: Optional[float],
    skipped: bool = False,
    enrichment_total: int = 0,
  ) -> dict:
    summary = {
      "run_id": datetime.now(timezone.utc).isoformat(),
      "mode": mode,
      "transcripts_processed": 0 if manifest is None else int(manifest["doc_id"].nunique()),
      "chunks_written": int(len(chunks)),
      "chunk_metadata_path": str(self.config.storage.chunk_metadata_path),
      "manifest_path": str(self.config.storage.manifest_path),
      "duration_seconds": duration_seconds,
      "skipped": skipped,
      "config_path": str(self.config.config_path),
      "document_enrichment_version": DOCUMENT_ENRICHMENT_VERSION,
      "chunk_enrichment_version": CHUNK_ENRICHMENT_VERSION,
      "chunk_schema_version": CHUNK_SCHEMA_VERSION,
      "embedding_set_version": EMBEDDING_SET_VERSION,
      "enrichment_model": ENRICHMENT_MODEL_NAME,
      "total_enriched_documents": enrichment_total,
    }
    return summary

  def _stringify_metadata(self, value: Optional[object]) -> str:
    if value is None:
      return ""
    if isinstance(value, float) and math.isnan(value):
      return ""
    if isinstance(value, (list, dict)):
      return json.dumps(value)
    return str(value)

  def _safe_int(self, value: Optional[object]) -> int:
    if value is None:
      return 0
    if isinstance(value, float) and math.isnan(value):
      return 0
    try:
      return int(value)
    except (TypeError, ValueError):
      return 0

  def _ensure_chunk_schema(self, frame: pd.DataFrame) -> None:
    if frame.empty:
      return
    required = {"chunk_summary", "chunk_intents", "chunk_sentiment", "chunk_claims", "chunk_enrichment_version"}
    missing = required - set(frame.columns)
    if missing:
      raise ValueError(
        f"Existing chunk metadata missing required columns: {sorted(missing)}. Run a full rebuild to refresh artifacts."
      )

  def _write_summary(self, summary: dict) -> None:
    summaries_path = self.config.logging.summaries_path
    summaries_path.parent.mkdir(parents=True, exist_ok=True)
    with summaries_path.open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(summary) + "\n")
    logger.info("Appended summary to %s", summaries_path)
