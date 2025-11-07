from __future__ import annotations

from pathlib import Path
from typing import Dict, Iterable, List

import pandas as pd

from .logging_utils import get_logger

logger = get_logger(__name__)


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
