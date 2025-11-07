from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

import pandas as pd

from .logging_utils import get_logger

logger = get_logger(__name__)


def _load_metadata(metadata_dir: Path) -> Dict[str, dict]:
  lookup: Dict[str, dict] = {}
  for path in sorted(metadata_dir.glob("*.json")):
    try:
      with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    except json.JSONDecodeError as exc:
      logger.warning("Skipping metadata file %s due to parse error: %s", path, exc)
      continue
    lookup[path.stem] = {
      "title": data.get("title"),
      "upload_date": data.get("upload_date"),
      "youtube_url": data.get("original_url")
      or data.get("webpage_url")
      or data.get("url"),
    }
  return lookup


def build_manifest(transcripts_dir: Path, metadata_dir: Path) -> pd.DataFrame:
  if not transcripts_dir.exists():
    raise FileNotFoundError(f"Transcripts directory missing: {transcripts_dir}")
  if not metadata_dir.exists():
    raise FileNotFoundError(f"Metadata directory missing: {metadata_dir}")
  transcript_files = sorted(transcripts_dir.glob("*.txt"))
  if not transcript_files:
    raise ValueError(f"No transcript files found in {transcripts_dir}")
  metadata_lookup = _load_metadata(metadata_dir)
  rows: List[dict] = []
  for path in transcript_files:
    doc_id = path.stem
    meta = metadata_lookup.get(doc_id, {})
    rows.append(
      {
        "doc_id": doc_id,
        "source_path": str(path),
        "source_name": path.name,
        "title": meta.get("title"),
        "upload_date": meta.get("upload_date"),
        "youtube_url": meta.get("youtube_url"),
      }
    )
  manifest = pd.DataFrame(rows)
  logger.info("Manifest ready with %s transcripts", len(manifest))
  return manifest
