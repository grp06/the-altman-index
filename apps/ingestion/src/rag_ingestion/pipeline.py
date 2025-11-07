from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd
from rag_core.logging import get_logger

from .chunker import Chunker
from .config import LoadedConfig
from .embeddings import EmbeddingClient
from .indexer import ChromaIndexer
from .manifest import build_manifest

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
    # like a table of chunks to create
    chunks_df = self._chunk_manifest(manifest)
    self._persist_dataframes(manifest, chunks_df)
    embeddings = self._embed_chunks(chunks_df)
    self.indexer.reset()
    self.indexer.upsert(
      ids=chunks_df["id"].tolist(),
      embeddings=embeddings,
      metadatas=chunks_df.drop(columns=["text"]).to_dict(orient="records"),
      documents=chunks_df["text"].tolist(),
    )
    elapsed = time.perf_counter() - start
    summary = self._build_summary(
      mode="rebuild",
      manifest=manifest,
      chunks=chunks_df,
      duration_seconds=elapsed,
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
    existing_chunks = pd.read_parquet(self.config.storage.chunk_metadata_path)
    processed_docs = set(existing_chunks["doc_id"].unique())
    manifest = manifest[~manifest["doc_id"].isin(processed_docs)]
    if manifest.empty:
      logger.info("No new transcripts detected; append skipped")
      summary = self._build_summary(
        mode="append",
        manifest=pd.DataFrame(columns=["doc_id"]),
        chunks=pd.DataFrame(columns=["id"]),
        duration_seconds=0.0,
        skipped=True,
      )
      self._write_summary(summary)
      return summary
    chunks_df = self._chunk_manifest(manifest)
    combined_chunks = pd.concat([existing_chunks, chunks_df], ignore_index=True)
    self._persist_dataframes(manifest=None, chunks=combined_chunks, new_manifest=manifest)
    embeddings = self._embed_chunks(chunks_df)
    self.indexer.upsert(
      ids=chunks_df["id"].tolist(),
      embeddings=embeddings,
      metadatas=chunks_df.drop(columns=["text"]).to_dict(orient="records"),
      documents=chunks_df["text"].tolist(),
    )
    summary = self._build_summary(
      mode="append",
      manifest=manifest,
      chunks=chunks_df,
      duration_seconds=time.perf_counter() - start,
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
      for chunk in chunks:
        chunk_rows.append(
          {
            **chunk,
            "title": title,
            "upload_date": upload_date,
            "youtube_url": youtube_url,
            "source_path": source_path,
            "source_name": source_name,
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
    }
    return summary

  def _write_summary(self, summary: dict) -> None:
    summaries_path = self.config.logging.summaries_path
    summaries_path.parent.mkdir(parents=True, exist_ok=True)
    with summaries_path.open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(summary) + "\n")
    logger.info("Appended summary to %s", summaries_path)
