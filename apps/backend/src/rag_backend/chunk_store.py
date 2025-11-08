from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List, Optional

import pandas as pd
from rag_core.logging import get_logger
from rag_core.schema_versions import (
  CHUNK_ENRICHMENT_VERSION,
  CHUNK_SCHEMA_VERSION,
  DOCUMENT_ENRICHMENT_VERSION,
  EMBEDDING_SET_VERSION,
  ENRICHMENT_MODEL_NAME,
)

logger = get_logger(__name__)

REQUIRED_COLUMNS = {"chunk_summary", "chunk_intents", "chunk_sentiment", "chunk_claims", "chunk_enrichment_version"}


class ChunkStore:
  def __init__(self, chunk_path: Path):
    self.chunk_path = chunk_path
    self._frame = pd.DataFrame()
    self.load()

  def load(self) -> None:
    if not self.chunk_path.exists():
      raise FileNotFoundError(f"Chunk metadata file missing: {self.chunk_path}")
    frame = pd.read_parquet(self.chunk_path)
    if "id" not in frame.columns:
      raise ValueError("Chunk metadata missing id column")
    missing = REQUIRED_COLUMNS - set(frame.columns)
    if missing:
      raise ValueError(
        f"Chunk metadata missing required enrichment columns: {sorted(missing)} for schema v{CHUNK_SCHEMA_VERSION}. Run ingestion to rebuild chunks."
      )
    self._frame = frame.set_index("id")
    logger.info("Loaded %s chunks into store", len(self._frame))

  def get_by_ids(self, chunk_ids: Iterable[str]) -> List[dict]:
    rows = []
    for chunk_id in chunk_ids:
      if chunk_id not in self._frame.index:
        raise KeyError(f"Chunk id not found: {chunk_id}")
      row = self._frame.loc[chunk_id].to_dict()
      row["id"] = chunk_id
      rows.append(row)
    return rows

  @property
  def count(self) -> int:
    return len(self._frame)

  def latest_ingestion_run(self, summaries_path: Path) -> Dict[str, str] | None:
    if not summaries_path.exists():
      return None
    try:
      with summaries_path.open("r", encoding="utf-8") as handle:
        lines = handle.readlines()
    except OSError:
      return None
    if not lines:
      return None
    import json
    try:
      data = json.loads(lines[-1])
    except json.JSONDecodeError:
      return None
    return data

  def verify_summary_versions(self, summary: Optional[dict]) -> None:
    if not summary:
      raise RuntimeError("No ingestion summaries found; run ingestion before starting the backend.")
    expectations = {
      "chunk_schema_version": CHUNK_SCHEMA_VERSION,
      "chunk_enrichment_version": CHUNK_ENRICHMENT_VERSION,
      "document_enrichment_version": DOCUMENT_ENRICHMENT_VERSION,
      "embedding_set_version": EMBEDDING_SET_VERSION,
      "enrichment_model": ENRICHMENT_MODEL_NAME,
    }
    for key, expected in expectations.items():
      actual = summary.get(key)
      if actual != expected:
        raise RuntimeError(
          f"Ingestion summary mismatch for {key}: expected {expected}, got {actual}. Rebuild ingestion artifacts before serving."
        )
