from __future__ import annotations

from typing import Dict, List, Sequence

import chromadb
from chromadb.config import Settings
from rag_core.logging import get_logger

logger = get_logger(__name__)

SECONDARY_COLLECTION_SUFFIXES = {
  "chunk_summary": "summary",
  "chunk_intents": "intents",
  "doc_summary": "docsum",
}


class ChromaIndexer:
  def __init__(self, index_path: str, collection_name: str, distance_metric: str = "cosine"):
    self.index_path = index_path
    self.collection_name = collection_name
    self.client = chromadb.PersistentClient(
      path=index_path, settings=Settings(anonymized_telemetry=False)
    )
    self.distance_metric = distance_metric
    self.collection = self._get_or_create(collection_name)
    self.secondary_collections: Dict[str, object] = {}
    self._init_secondary()

  def reset(self) -> None:
    logger.info("Resetting Chroma collection %s", self.collection_name)
    targets = [self.collection_name]
    targets.extend(self._collection_name(key) for key in SECONDARY_COLLECTION_SUFFIXES)
    for name in targets:
      try:
        self.client.delete_collection(name)
      except ValueError:
        logger.info("Collection %s did not exist; skipping delete", name)
    self.collection = self._get_or_create(self.collection_name)
    self._init_secondary()

  def upsert(
    self,
    ids: Sequence[str],
    embeddings: Sequence[Sequence[float]],
    metadatas: Sequence[dict],
    documents: Sequence[str],
  ) -> None:
    self.collection.upsert(ids=list(ids), embeddings=list(embeddings), metadatas=list(metadatas), documents=list(documents))
    logger.info("Upserted %s records into %s", len(ids), self.collection_name)

  def upsert_secondary(
    self,
    key: str,
    ids: Sequence[str],
    embeddings: Sequence[Sequence[float]],
    metadatas: Sequence[dict],
    documents: Sequence[str],
  ) -> None:
    if key not in self.secondary_collections:
      raise ValueError(f"Unknown secondary collection: {key}")
    collection = self.secondary_collections[key]
    collection.upsert(ids=list(ids), embeddings=list(embeddings), metadatas=list(metadatas), documents=list(documents))
    logger.info("Upserted %s records into %s", len(ids), self._collection_name(key))

  def _collection_name(self, key: str) -> str:
    suffix = SECONDARY_COLLECTION_SUFFIXES[key]
    return f"{self.collection_name}_{suffix}"

  def _get_or_create(self, name: str):
    return self.client.get_or_create_collection(name, metadata={"hnsw:space": self.distance_metric})

  def _init_secondary(self) -> None:
    self.secondary_collections = {}
    for key in SECONDARY_COLLECTION_SUFFIXES:
      name = self._collection_name(key)
      self.secondary_collections[key] = self._get_or_create(name)
