from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import pandas as pd
import tiktoken
from openai import OpenAI
from rag_core.logging import get_logger
from rag_core.schema_versions import CHUNK_ENRICHMENT_VERSION, ENRICHMENT_MODEL_NAME

from .config import LoadedConfig

logger = get_logger(__name__)


class ChunkEnrichmentService:
  def __init__(self, config: LoadedConfig, client: Optional[OpenAI] = None):
    self.config = config
    api_key = os.getenv("OPENAI_API_KEY")
    if client is None and not api_key:
      raise RuntimeError("OPENAI_API_KEY is not set; export it before running enrichment.")
    self.api_key = api_key
    self.client = client
    self.cache_dir = config.storage.artifacts_dir / "enrichment" / "chunks"
    self.cache_dir.mkdir(parents=True, exist_ok=True)
    chunk_workers = config.enrichment.chunk_max_workers
    self.max_workers = chunk_workers or config.enrichment.max_workers
    self.encoding = tiktoken.get_encoding("cl100k_base")
    self.clip_tokens = 800
    self.model_name = ENRICHMENT_MODEL_NAME

  def ensure_enriched(self, chunks: pd.DataFrame, force: bool = False) -> pd.DataFrame:
    if chunks.empty:
      return chunks
    records = chunks.to_dict(orient="records")
    summaries: List[str] = [""] * len(records)
    intents: List[str] = ["[]"] * len(records)
    sentiments: List[str] = [""] * len(records)
    claims: List[str] = ["[]"] * len(records)
    versions: List[int] = [CHUNK_ENRICHMENT_VERSION] * len(records)
    reused = 0
    generated = 0
    with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
      future_map = {}
      for idx, row in enumerate(records):
        future = executor.submit(self._process_row, row, force)
        future_map[future] = idx
      for future in as_completed(future_map):
        idx = future_map[future]
        data, reused_flag, generated_flag = future.result()
        summaries[idx] = data["chunk_summary"]
        intents[idx] = data["chunk_intents"]
        sentiments[idx] = data["chunk_sentiment"]
        claims[idx] = data["chunk_claims"]
        versions[idx] = data["chunk_enrichment_version"]
        reused += reused_flag
        generated += generated_flag
    frame = chunks.copy()
    frame["chunk_summary"] = summaries
    frame["chunk_intents"] = intents
    frame["chunk_sentiment"] = sentiments
    frame["chunk_claims"] = claims
    frame["chunk_enrichment_version"] = versions
    logger.info(
      "Chunk enrichment complete: %s rows (%s reused, %s generated)",
      len(frame),
      reused,
      generated,
    )
    return frame

  def _process_row(self, row: dict, force: bool) -> Tuple[dict, int, int]:
    chunk_id = row["id"]
    reused_flag = 0
    generated_flag = 0
    data = None
    if not force:
      cached = self._load_cache(chunk_id)
      if cached:
        data = cached
        reused_flag = 1
    if data is None:
      data = self._generate_enrichment(chunk_id, row)
      generated_flag = 1
    merged = self._merge(row, data)
    return merged, reused_flag, generated_flag

  def _generate_enrichment(self, chunk_id: str, row: dict) -> dict:
    system_prompt = (
      "You analyze Sam Altman interview chunks and emit enriched metadata."
      " Return JSON with keys chunk_summary (<=60 words), chunk_intents (array of short intent labels),"
      " chunk_sentiment (tone label), and chunk_claims (array of concise statements)."
      " Use only the provided chunk text and metadata."
    )
    title = row.get("title") or row.get("source_name") or row["doc_id"]
    doc_summary = row.get("doc_summary") or ""
    snippet = self._clip_text(row.get("text") or "")
    if not snippet:
      snippet = ""
    payload = (
      f"Chunk ID: {chunk_id}\n"
      f"Document ID: {row.get('doc_id')}\n"
      f"Title: {title}\n"
      f"Document Summary: {doc_summary}\n"
      f"Chunk Text:\n{snippet}"
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
            "content": [{"type": "input_text", "text": payload}],
          },
        ],
      )
    except Exception as exc:  # noqa: BLE001
      self._log_error(chunk_id, str(exc))
      raise
    data = self._parse_response(response)
    self._write_cache(chunk_id, data)
    return data

  def _clip_text(self, text: str) -> str:
    tokens = self.encoding.encode(text)
    if len(tokens) <= self.clip_tokens:
      return text
    return self.encoding.decode(tokens[: self.clip_tokens])

  def _parse_response(self, response: object) -> dict:
    message_output = None
    for item in getattr(response, "output", []):
      if getattr(item, "type", "") == "message":
        message_output = item
        break
    if message_output is None or not getattr(message_output, "content", None):
      raise ValueError("No message content in chunk enrichment response")
    content = message_output.content[0].text
    if content.startswith("```"):
      lines = content.strip().split("\n")
      content = "\n".join(lines[1:-1])
    return json.loads(content)

  def _merge(self, row: dict, data: dict) -> dict:
    summary = data.get("chunk_summary") or ""
    intents = self._normalize_list(data.get("chunk_intents"))
    sentiment = data.get("chunk_sentiment") or ""
    claims = self._normalize_list(data.get("chunk_claims"))
    return {
      "chunk_summary": summary,
      "chunk_intents": json.dumps(intents),
      "chunk_sentiment": sentiment,
      "chunk_claims": json.dumps(claims),
      "chunk_enrichment_version": CHUNK_ENRICHMENT_VERSION,
      "doc_id": row.get("doc_id"),
      "id": row.get("id"),
    }

  def _normalize_list(self, value: Optional[object]) -> List[str]:
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
        return [value.strip()]
      if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]
      return []
    return []

  def _cache_path(self, chunk_id: str) -> Path:
    safe = chunk_id.replace("/", "_").replace(":", "_")
    return self.cache_dir / f"{safe}.json"

  def _load_cache(self, chunk_id: str) -> Optional[dict]:
    path = self._cache_path(chunk_id)
    if not path.exists():
      return None
    try:
      payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
      return None
    if payload.get("version") != CHUNK_ENRICHMENT_VERSION:
      return None
    return payload.get("data")

  def _write_cache(self, chunk_id: str, data: dict) -> None:
    payload = {"version": CHUNK_ENRICHMENT_VERSION, "data": data}
    path = self._cache_path(chunk_id)
    path.write_text(json.dumps(payload), encoding="utf-8")

  def _log_error(self, chunk_id: str, message: str) -> None:
    payload = {
      "chunk_id": chunk_id,
      "message": message,
      "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    path = self.config.logging.enrichment_errors_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(payload) + "\n")
