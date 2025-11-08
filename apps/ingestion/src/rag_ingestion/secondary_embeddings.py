from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd
from rag_core.logging import get_logger
from rag_core.schema_versions import EMBEDDING_SET_VERSION

from .config import LoadedConfig
from .embeddings import EmbeddingClient

logger = get_logger(__name__)


class SecondaryEmbeddingService:
  def __init__(self, config: LoadedConfig, embed_client: EmbeddingClient):
    self.config = config
    self.embed_client = embed_client
    self.embedding_model = config.embedding.model

  def generate(
    self,
    mode: str,
    chunks: pd.DataFrame,
    manifest: Optional[pd.DataFrame],
  ) -> Dict[str, dict]:
    outputs: Dict[str, dict] = {}
    summary_records = self._chunk_summary_records(chunks)
    intents_records = self._chunk_intent_records(chunks)
    doc_records = self._doc_summary_records(manifest)
    if summary_records:
      outputs["chunk_summary"] = self._process_records(
        summary_records,
        self.config.storage.chunk_summary_embeddings_path,
        mode,
      )
    if intents_records:
      outputs["chunk_intents"] = self._process_records(
        intents_records,
        self.config.storage.chunk_intents_embeddings_path,
        mode,
      )
    if doc_records:
      outputs["doc_summary"] = self._process_records(
        doc_records,
        self.config.storage.doc_summary_embeddings_path,
        mode,
      )
    return outputs

  def _chunk_summary_records(self, chunks: pd.DataFrame) -> List[dict]:
    records: List[dict] = []
    for row in chunks.to_dict(orient="records"):
      text = (row.get("chunk_summary") or "").strip()
      if not text:
        continue
      records.append(
        {
          "id": row["id"],
          "doc_id": row.get("doc_id"),
          "text": text,
          "source_field": "chunk_summary",
        }
      )
    return records

  def _chunk_intent_records(self, chunks: pd.DataFrame) -> List[dict]:
    records: List[dict] = []
    for row in chunks.to_dict(orient="records"):
      raw = row.get("chunk_intents") or "[]"
      intents = self._parse_list(raw)
      if not intents:
        continue
      joined = "; ".join(intents)
      records.append(
        {
          "id": row["id"],
          "doc_id": row.get("doc_id"),
          "text": joined,
          "source_field": "chunk_intents",
        }
      )
    return records

  def _doc_summary_records(self, manifest: Optional[pd.DataFrame]) -> List[dict]:
    if manifest is None or manifest.empty:
      return []
    records: List[dict] = []
    seen = set()
    for row in manifest.to_dict(orient="records"):
      doc_id = row.get("doc_id")
      if not doc_id or doc_id in seen:
        continue
      seen.add(doc_id)
      text = (row.get("doc_summary") or "").strip()
      if not text:
        continue
      records.append(
        {
          "id": doc_id,
          "doc_id": doc_id,
          "text": text,
          "source_field": "doc_summary",
        }
      )
    return records

  def _process_records(self, records: List[dict], path: Path, mode: str) -> dict:
    embeddings = self.embed_client.embed([{"id": item["id"], "text": item["text"]} for item in records])
    timestamp = datetime.now(timezone.utc).isoformat()
    parquet_rows = []
    for record, vector in zip(records, embeddings):
      parquet_rows.append(
        {
          "id": record["id"],
          "vector": vector,
          "source_field": record["source_field"],
          "embedding_model": self.embedding_model,
          "embedding_set_version": EMBEDDING_SET_VERSION,
          "created_at": timestamp,
        }
      )
    self._write_parquet(path, parquet_rows, mode)
    logger.info(
      "Wrote %s embeddings to %s (%s)",
      len(records),
      path,
      records[0]["source_field"],
    )
    return {
      "ids": [record["id"] for record in records],
      "embeddings": embeddings,
      "documents": [record["text"] for record in records],
      "metadatas": [
        {"doc_id": record.get("doc_id"), "source_field": record["source_field"]}
        for record in records
      ],
    }

  def _write_parquet(self, path: Path, rows: List[dict], mode: str) -> None:
    frame = pd.DataFrame(rows)
    if mode == "append" and path.exists():
      existing = pd.read_parquet(path)
      if "embedding_set_version" not in existing.columns:
        raise ValueError(
          f"Existing embeddings at {path} are missing embedding_set_version; run a rebuild."
        )
      versions = set(existing["embedding_set_version"].unique())
      if versions != {EMBEDDING_SET_VERSION}:
        raise ValueError(
          f"Existing embeddings at {path} use version {versions}; run a rebuild to refresh the cache."
        )
      frame = pd.concat([existing, frame], ignore_index=True)
      frame.drop_duplicates(subset=["id"], keep="last", inplace=True)
    frame.to_parquet(path, index=False)

  def _parse_list(self, value: object) -> List[str]:
    if value is None:
      return []
    if isinstance(value, list):
      return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
      if not value.strip():
        return []
      try:
        parsed = json.loads(value)
      except json.JSONDecodeError:
        parsed = [value]
      if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
      return []
    return []
