from __future__ import annotations

from typing import List

import chromadb
from chromadb.config import Settings
from openai import OpenAI
from rag_core.logging import get_logger

from .config import LoadedConfig

logger = get_logger(__name__)


class Retriever:
  def __init__(self, config: LoadedConfig):
    self.config = config
    self.client = OpenAI()
    self.chroma = chromadb.PersistentClient(
      path=str(config.storage.index_dir), settings=Settings(anonymized_telemetry=False)
    )
    self.collection = self.chroma.get_or_create_collection(
      config.retrieval.collection_name,
      metadata={"hnsw:space": config.retrieval.distance_metric},
    )

  def _embed(self, query: str) -> List[float]:
    response = self.client.embeddings.create(
      model=self.config.models.embedding, input=[query]
    )
    return response.data[0].embedding

  def search(self, query: str, top_k: int) -> dict:
    vector = self._embed(query)
    result = self.collection.query(
      query_embeddings=[vector],
      n_results=top_k,
      include=["metadatas", "documents", "distances"],
    )
    ids = result.get("ids", [[]])[0]
    documents = result.get("documents", [[]])[0]
    metadatas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]
    rows = []
    for chunk_id, text, metadata, distance in zip(ids, documents, metadatas, distances):
      rows.append(
        {
          "id": chunk_id,
          "snippet": text,
          "score": 1 - float(distance),
          "metadata": metadata,
        }
      )
    return {
      "chunks": rows,
      "count": len(rows),
    }
