from __future__ import annotations

from typing import List, Sequence

import chromadb
from chromadb.config import Settings
from rag_core.logging import get_logger

logger = get_logger(__name__)


class ChromaIndexer:
  def __init__(self, index_path: str, collection_name: str, distance_metric: str = "cosine"):
    self.index_path = index_path
    self.collection_name = collection_name
    self.client = chromadb.PersistentClient(
      path=index_path, settings=Settings(anonymized_telemetry=False)
    )
    self.distance_metric = distance_metric
    self.collection = self.client.get_or_create_collection(
      collection_name, metadata={"hnsw:space": self.distance_metric}
    )

  def reset(self) -> None:
    logger.info("Resetting Chroma collection %s", self.collection_name)
    try:
      self.client.delete_collection(self.collection_name)
    except ValueError:
      logger.info("Collection %s did not exist; skipping delete", self.collection_name)
    self.collection = self.client.create_collection(
      self.collection_name, metadata={"hnsw:space": self.distance_metric}
    )

  def upsert(
    self,
    ids: Sequence[str],
    embeddings: Sequence[Sequence[float]],
    metadatas: Sequence[dict],
    documents: Sequence[str],
  ) -> None:
    self.collection.upsert(ids=list(ids), embeddings=list(embeddings), metadatas=list(metadatas), documents=list(documents))
    logger.info("Upserted %s records into %s", len(ids), self.collection_name)
