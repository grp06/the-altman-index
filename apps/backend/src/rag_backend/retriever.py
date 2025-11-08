from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Dict, List, Optional

import chromadb
from chromadb.config import Settings
from openai import OpenAI
from rag_core.logging import get_logger

from .chunk_store import ChunkStore
from .config import LoadedConfig, RetrievalProfileSettings

logger = get_logger(__name__)

VECTOR_SOURCES = {"primary", "summary", "intents", "docsum"}

DEFAULT_PROFILES = {
  "factual": {"collections": ["primary"], "per_collection_k": {}},
  "analytical": {"collections": ["primary", "summary", "intents"], "per_collection_k": {}},
  "comparative": {"collections": ["primary", "docsum", "summary"], "per_collection_k": {}},
}

QUESTION_TYPE_TO_PROFILE = {
  "factual": "factual",
  "analytical": "analytical",
  "comparative": "comparative",
  "meta": "factual",
  "exploratory": "analytical",
  "creative": "analytical",
}


@dataclass
class RetrievalProfile:
  name: str
  collections: List[str]
  per_collection_k: Dict[str, int]
  blend: str


class Retriever:
  def __init__(self, config: LoadedConfig, chunk_store: ChunkStore):
    self.config = config
    self.chunk_store = chunk_store
    self.client = OpenAI()
    self.chroma = chromadb.PersistentClient(
      path=str(config.storage.index_dir),
      settings=Settings(anonymized_telemetry=False),
    )
    self.collection_names = {
      "primary": config.retrieval.collection_name,
      "summary": config.retrieval.summary_collection_name,
      "intents": config.retrieval.intents_collection_name,
      "docsum": config.retrieval.doc_summary_collection_name,
    }
    self.collections = {
      source: self.chroma.get_or_create_collection(
        name,
        metadata={"hnsw:space": config.retrieval.distance_metric},
      )
      for source, name in self.collection_names.items()
    }
    self.profiles = self._build_profiles(config.retrieval.profiles)

  def search(
    self,
    query: str,
    question_type: str,
    top_k: int,
    intent_filters: List[str],
    sentiment_filters: List[str],
  ) -> dict:
    profile = self._select_profile(question_type)
    vector = self._embed(query)
    normalized_intents = {item.lower() for item in intent_filters if item}
    normalized_sentiments = {item.lower() for item in sentiment_filters if item}
    raw_hits = []
    usage: List[dict] = []
    start = time.perf_counter()
    for source in profile.collections:
      limit = profile.per_collection_k.get(source, top_k)
      if limit <= 0:
        continue
      limit = max(1, limit)
      hits = self._query_collection(source, vector, limit)
      raw_hits.extend(hits)
      usage.append(
        {
          "source": source,
          "name": self.collection_names[source],
          "requested": limit,
          "returned": len(hits),
        }
      )
    deduped = self._dedupe_hits(raw_hits)
    filtered = self._apply_filters(deduped, normalized_intents, normalized_sentiments)
    elapsed = time.perf_counter() - start
    logger.info(
      "Retrieval mode=%s question_type=%s collections=%s total=%s filtered=%s elapsed=%.3fs",
      profile.name,
      question_type,
      ", ".join(f"{item['source']}:{item['returned']}" for item in usage) or "none",
      len(raw_hits),
      len(filtered),
      elapsed,
    )
    return {
      "chunks": [hit["payload"] for hit in filtered],
      "count": len(filtered),
      "aggregated_count": len(raw_hits),
      "retrieval_mode": profile.name,
      "collections_used": usage,
    }

  def _build_profiles(self, overrides: dict[str, RetrievalProfileSettings]) -> Dict[str, RetrievalProfile]:
    profiles: Dict[str, RetrievalProfile] = {}
    for name, settings in overrides.items():
      collections = [self._normalize_source(item) for item in settings.collections]
      per_k = {
        self._normalize_source(source): max(1, int(limit))
        for source, limit in settings.per_collection_k.items()
        if int(limit) > 0
      }
      profiles[name] = RetrievalProfile(name=name, collections=collections, per_collection_k=per_k, blend=settings.blend)
    for name, defaults in DEFAULT_PROFILES.items():
      if name in profiles:
        continue
      collections = [self._normalize_source(item) for item in defaults["collections"]]
      per_k = {
        self._normalize_source(source): max(1, int(limit))
        for source, limit in defaults.get("per_collection_k", {}).items()
        if int(limit) > 0
      }
      profiles[name] = RetrievalProfile(name=name, collections=collections, per_collection_k=per_k, blend=defaults.get("blend", "score"))
    return profiles

  def _normalize_source(self, value: str) -> str:
    key = value.strip().lower()
    if key not in VECTOR_SOURCES:
      raise ValueError(f"Unsupported collection source: {value}")
    return key

  def _select_profile(self, question_type: str) -> RetrievalProfile:
    if question_type in self.profiles:
      return self.profiles[question_type]
    preferred = QUESTION_TYPE_TO_PROFILE.get(question_type, "factual")
    if preferred in self.profiles:
      return self.profiles[preferred]
    return next(iter(self.profiles.values()))

  def _embed(self, query: str) -> List[float]:
    response = self.client.embeddings.create(
      model=self.config.models.embedding,
      input=[query],
    )
    return response.data[0].embedding

  def _query_collection(self, source: str, vector: List[float], limit: int) -> List[dict]:
    collection = self.collections[source]
    result = collection.query(
      query_embeddings=[vector],
      n_results=limit,
      include=["metadatas", "documents", "distances"],
    )
    ids = (result.get("ids") or [[]])
    documents = (result.get("documents") or [[]])
    metadatas = (result.get("metadatas") or [[]])
    distances = (result.get("distances") or [[]])
    ids = ids[0] if ids else []
    documents = documents[0] if documents else []
    metadatas = metadatas[0] if metadatas else []
    distances = distances[0] if distances else []
    hits = []
    for chunk_id, document, metadata, distance in zip(ids, documents, metadatas, distances):
      dist_value = float(distance) if distance is not None else 1.0
      hit = self._build_chunk(chunk_id, document, metadata or {}, dist_value, source)
      if hit:
        hits.append(hit)
    return hits

  def _build_chunk(self, chunk_id: str, document: str, metadata: dict, distance: float, source: str) -> Optional[dict]:
    if source == "docsum":
      doc_id = metadata.get("doc_id") or chunk_id
      anchor = self.chunk_store.doc_anchor(str(doc_id))
      if not anchor:
        logger.warning("Doc summary hit missing anchor for %s", doc_id)
        return None
      resolved_id = anchor
    else:
      resolved_id = chunk_id
    hydrated = self._hydrate_metadata(resolved_id, metadata)
    summary = self._string_or_none(hydrated.get("chunk_summary"))
    intents = self._parse_list(hydrated.get("chunk_intents"))
    sentiment = self._string_or_none(hydrated.get("chunk_sentiment"))
    claims = self._parse_list(hydrated.get("chunk_claims"))
    snippet = document or ""
    score = 1 - float(distance)
    if score < 0:
      score = 0.0
    if score > 1:
      score = 1.0
    return {
      "payload": {
        "id": resolved_id,
        "snippet": snippet,
        "score": score,
        "metadata": hydrated,
        "chunk_summary": summary,
        "chunk_intents": intents,
        "chunk_sentiment": sentiment,
        "chunk_claims": claims,
        "vector_source": source,
      },
      "score": score,
    }

  def _hydrate_metadata(self, chunk_id: str, metadata: dict) -> dict:
    if (
      metadata
      and "chunk_summary" in metadata
      and "chunk_intents" in metadata
      and "chunk_sentiment" in metadata
      and "chunk_claims" in metadata
    ):
      merged = dict(metadata)
      merged["id"] = chunk_id
      return merged
    try:
      store_metadata = self.chunk_store.metadata_for(chunk_id)
    except KeyError:
      logger.warning("Missing chunk metadata for %s", chunk_id)
      merged = dict(metadata)
      merged["id"] = chunk_id
      return merged
    merged = dict(store_metadata)
    merged.update(metadata)
    return merged

  def _parse_list(self, value: object) -> List[str]:
    if value is None:
      return []
    if isinstance(value, list):
      return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    if isinstance(value, str):
      text = value.strip()
      if not text:
        return []
      try:
        parsed = json.loads(text)
      except json.JSONDecodeError:
        parsed = [text]
      if isinstance(parsed, list):
        result = []
        for entry in parsed:
          entry_str = str(entry).strip()
          if entry_str:
            result.append(entry_str)
        return result
      return [text]
    return []

  def _string_or_none(self, value: object) -> Optional[str]:
    if value is None:
      return None
    text = str(value).strip()
    return text or None

  def _dedupe_hits(self, hits: List[dict]) -> List[dict]:
    best: Dict[str, dict] = {}
    for hit in hits:
      chunk_id = hit["payload"]["id"]
      existing = best.get(chunk_id)
      if not existing or hit["score"] > existing["score"]:
        best[chunk_id] = hit
    return sorted(best.values(), key=lambda item: item["score"], reverse=True)

  def _apply_filters(
    self,
    hits: List[dict],
    intent_filters: set[str],
    sentiment_filters: set[str],
  ) -> List[dict]:
    filtered = []
    for hit in hits:
      intents = {entry.lower() for entry in hit["payload"]["chunk_intents"]}
      sentiment = (hit["payload"]["chunk_sentiment"] or "").lower()
      if intent_filters and not intents.intersection(intent_filters):
        continue
      if sentiment_filters and sentiment not in sentiment_filters:
        continue
      filtered.append(hit)
    return filtered
