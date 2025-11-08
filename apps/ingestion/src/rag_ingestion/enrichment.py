from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import pandas as pd
from openai import OpenAI
from rag_core.logging import get_logger
from rag_core.schema_versions import DOCUMENT_ENRICHMENT_VERSION, ENRICHMENT_MODEL_NAME

from .config import LoadedConfig
from .transcript import TranscriptAnalysis, TranscriptNormalizer

logger = get_logger(__name__)

ENRICHMENT_SCHEMA = {
  "type": "object",
  "properties": {
    "doc_summary": {
      "type": "string",
      "description": "Concise summary of the transcript in 120 words or less",
    },
    "key_themes": {
      "type": "array",
      "description": "List of major themes discussed in the transcript",
      "items": {
        "type": "object",
        "properties": {
          "theme": {"type": "string", "description": "Name of the theme"},
          "evidence_turn_indices": {
            "type": "array",
            "description": "List of turn indices where this theme appears",
            "items": {"type": "integer"},
          },
        },
        "required": ["theme", "evidence_turn_indices"],
      },
    },
    "time_span": {
      "type": "string",
      "description": "Free-form description of the time period or context",
    },
    "entities": {
      "type": "array",
      "description": "Key people, organizations, and concepts mentioned",
      "items": {
        "type": "object",
        "properties": {
          "name": {"type": "string", "description": "Name of the entity"},
          "type": {
            "type": "string",
            "enum": ["person", "organization", "concept"],
            "description": "Type of entity",
          },
          "role": {"type": "string", "description": "Role or significance"},
        },
        "required": ["name", "type", "role"],
      },
    },
    "stance_notes": {
      "type": "string",
      "description": "Optional notes on Sam Altman's positions or perspectives",
    },
  },
  "required": ["doc_summary", "key_themes", "time_span", "entities"],
  "additionalProperties": False,
}


class DocumentEnrichmentService:
  def __init__(self, config: LoadedConfig, client: Optional[OpenAI] = None):
    self.config = config
    api_key = os.getenv("OPENAI_API_KEY")
    if client is None and not api_key:
      raise RuntimeError("OPENAI_API_KEY is not set; export it before running enrichment.")
    self.api_key = api_key
    self.client = client
    self.normalizer = TranscriptNormalizer()
    self.batch_size = config.embedding.batch_size
    self.cache_dir = config.storage.artifacts_dir / "enrichment" / "raw"
    self.cache_dir.mkdir(parents=True, exist_ok=True)
    self.max_workers = max(1, config.enrichment.max_workers)
    self.model_name = ENRICHMENT_MODEL_NAME

  def ensure_enriched(self, manifest: pd.DataFrame, force: bool = False) -> pd.DataFrame:
    records = manifest.to_dict(orient="records")
    existing_frame = None if force else self._load_existing_frame()
    existing = {} if force else self._load_existing_dict(existing_frame)
    enriched_rows: List[Optional[dict]] = [None] * len(records)
    reused = 0
    generated = 0
    pending_flush: List[dict] = []
    flush_threshold = max(1, self.max_workers)
    with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
      future_map = {}
      for idx, row in enumerate(records):
        future = executor.submit(self._process_record, row, existing, force)
        future_map[future] = idx
      for future in as_completed(future_map):
        idx = future_map[future]
        enriched_row, reused_flag, generated_flag = future.result()
        enriched_rows[idx] = enriched_row
        reused += reused_flag
        generated += generated_flag
        pending_flush.append(enriched_row)
        if len(pending_flush) >= flush_threshold:
          existing_frame = self._flush_rows(existing_frame, pending_flush)
          pending_flush = []
    if pending_flush:
      existing_frame = self._flush_rows(existing_frame, pending_flush)
    frame = existing_frame if existing_frame is not None else pd.DataFrame()
    logger.info(
      "Document enrichment complete: %s docs (%s reused, %s generated)",
      len(frame),
      reused,
      generated,
    )
    return frame

  def _load_existing_frame(self) -> Optional[pd.DataFrame]:
    path = self.config.storage.enriched_manifest_path
    if not path.exists():
      return None
    try:
      return pd.read_parquet(path)
    except Exception:  # noqa: BLE001
      return None

  def _load_existing_dict(self, frame: Optional[pd.DataFrame]) -> Dict[str, dict]:
    if frame is None or frame.empty:
      return {}
    entries: Dict[str, dict] = {}
    for row in frame.to_dict(orient="records"):
      entries[row["doc_id"]] = {
        "doc_summary": row.get("doc_summary", ""),
        "key_themes": self._parse_json_field(row.get("key_themes")),
        "time_span": row.get("time_span", ""),
        "entities": self._parse_json_field(row.get("entities")),
        "stance_notes": row.get("stance_notes", ""),
      }
    return entries

  def _load_cached_enrichment(self, doc_id: str) -> Optional[dict]:
    path = self.cache_dir / f"{doc_id}.json"
    if not path.exists():
      return None
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
      return None
    if payload.get("version") != DOCUMENT_ENRICHMENT_VERSION:
      return None
    return payload.get("data")

  def _write_cache(self, doc_id: str, data: dict) -> None:
    payload = {"version": DOCUMENT_ENRICHMENT_VERSION, "data": data}
    path = self.cache_dir / f"{doc_id}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

  def _generate_enrichment(self, doc_id: str, row: dict, analysis: TranscriptAnalysis) -> dict:
    system_prompt = (
      "You analyze Sam Altman interview transcripts and emit structured metadata for retrieval."
      " Always respond with JSON matching the schema: "
      '{"doc_summary": str (<=120 words), '
      '"key_themes": [{"theme": str, "evidence_turn_indices": [int]}], '
      '"time_span": str, '
      '"entities": [{"name": str, "type": "person|organization|concept", "role": str}], '
      '"stance_notes": str}. '
      "Do not wrap the JSON in code fences or additional text."
    )
    snippet = analysis.snippet()
    if not snippet:
      snippet = analysis.text
    speaker_summary = ", ".join(
      f"{name} ({count})" for name, count in sorted(analysis.speaker_counts.items())
    )
    upload_date = row.get("upload_date") or "unknown"
    title = row.get("title") or row.get("source_name") or "Untitled"
    user_prompt = (
      f"Document ID: {doc_id}\n"
      f"Title: {title}\n"
      f"Upload Date: {upload_date}\n"
      f"Speaker Stats: {speaker_summary}\n"
      f"Turns Sample:\n{snippet}"
    )
    client = self.client or OpenAI(api_key=self.api_key)
    try:
      response = client.responses.create(
        model=self.model_name,
        input=[
          {
            "role": "system",
            "content": [{"type": "input_text", "text": system_prompt}],
          },
          {
            "role": "user",
            "content": [{"type": "input_text", "text": user_prompt}],
          },
        ],
      )
    except Exception as exc:  # noqa: BLE001
      self._log_enrichment_error(doc_id, str(exc))
      raise
    data = self._parse_response(response)
    self._write_cache(doc_id, data)
    return data

  def _parse_response(self, response: object) -> dict:
    message_output = None
    for item in getattr(response, "output", []):
      if getattr(item, "type", "") == "message":
        message_output = item
        break
    if message_output is None or not getattr(message_output, "content", None):
      raise ValueError("No message content in enrichment response")
    content = message_output.content[0].text
    if content.startswith("```"):
      lines = content.strip().split("\n")
      content = "\n".join(lines[1:-1])
    return json.loads(content)

  def _merge_row(self, row: dict, analysis: TranscriptAnalysis, data: dict) -> dict:
    merged = dict(row)
    merged["doc_summary"] = data.get("doc_summary", "")
    key_themes = data.get("key_themes", [])
    if isinstance(key_themes, str):
      try:
        key_themes = json.loads(key_themes)
      except json.JSONDecodeError:
        key_themes = []
    merged["key_themes"] = json.dumps(key_themes)
    merged["time_span"] = data.get("time_span", "")
    entities = data.get("entities", [])
    if isinstance(entities, str):
      try:
        entities = json.loads(entities)
      except json.JSONDecodeError:
        entities = []
    merged["entities"] = json.dumps(entities)
    merged["stance_notes"] = data.get("stance_notes", "")
    merged["speaker_stats"] = json.dumps(analysis.speaker_counts)
    merged["token_count"] = analysis.token_count
    merged["sam_turns"] = analysis.sam_turns
    merged["turn_count"] = len(analysis.turns)
    merged["enrichment_version"] = DOCUMENT_ENRICHMENT_VERSION
    merged["enriched_at"] = datetime.now(timezone.utc).isoformat()
    return merged

  def _has_required(self, data: dict) -> bool:
    fields = ["doc_summary", "key_themes", "time_span", "entities"]
    for field in fields:
      value = data.get(field)
      if value is None:
        return False
      if isinstance(value, str) and not value.strip():
        return False
      if isinstance(value, (list, dict)) and not value:
        return False
    return True

  def _write_manifest(self, frame: pd.DataFrame) -> None:
    path = self.config.storage.enriched_manifest_path
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False)

  def _log_enrichment_error(self, doc_id: str, message: str) -> None:
    payload = {
      "doc_id": doc_id,
      "message": message,
      "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    path = self.config.logging.enrichment_errors_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(payload) + "\n")

  def _parse_json_field(self, value: Optional[object]) -> object:
    if value is None:
      return []
    if isinstance(value, (list, dict)):
      return value
    if not isinstance(value, str) or not value.strip():
      return []
    try:
      parsed = json.loads(value)
    except json.JSONDecodeError:
      return []
    if isinstance(parsed, (list, dict)):
      return parsed
    return []

  def _process_record(
    self,
    row: dict,
    existing: Dict[str, dict],
    force: bool,
  ) -> Tuple[dict, int, int]:
    doc_id = row["doc_id"]
    transcript_path = Path(row["source_path"])
    if not transcript_path.exists():
      raise FileNotFoundError(f"Transcript missing for enrichment: {transcript_path}")
    text = transcript_path.read_text(encoding="utf-8")
    analysis = self.normalizer.analyze(doc_id, text)
    reused_flag = 0
    generated_flag = 0
    if not force and doc_id in existing and self._has_required(existing[doc_id]):
      enrichment_data = existing[doc_id]
      reused_flag = 1
    else:
      cached = None if force else self._load_cached_enrichment(doc_id)
      if cached and self._has_required(cached):
        enrichment_data = cached
        reused_flag = 1
      else:
        enrichment_data = self._generate_enrichment(doc_id, row, analysis)
        generated_flag = 1
    enriched_row = self._merge_row(row, analysis, enrichment_data)
    return enriched_row, reused_flag, generated_flag

  def _flush_rows(
    self,
    current_frame: Optional[pd.DataFrame],
    rows: List[dict],
  ) -> pd.DataFrame:
    update_frame = pd.DataFrame(rows)
    if current_frame is None or current_frame.empty:
      merged = update_frame
    else:
      merged = pd.concat([current_frame, update_frame], ignore_index=True)
      merged.drop_duplicates(subset=["doc_id"], keep="last", inplace=True)
    self._write_manifest(merged)
    return merged
