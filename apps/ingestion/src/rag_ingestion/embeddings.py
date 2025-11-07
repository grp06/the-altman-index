from __future__ import annotations

import time
from typing import Iterable, List, Sequence

from openai import OpenAI
from rag_core.logging import get_logger

logger = get_logger(__name__)


class EmbeddingClient:
  def __init__(self, model: str, batch_size: int):
    self.client = OpenAI()
    self.model = model
    self.batch_size = batch_size

  def _batched(self, items: Sequence[dict]) -> Iterable[Sequence[dict]]:
    for idx in range(0, len(items), self.batch_size):
      yield items[idx : idx + self.batch_size]

  def embed(self, records: Sequence[dict]) -> List[List[float]]:
    embeddings: List[List[float]] = []
    for batch in self._batched(records):
      texts = [record["text"] for record in batch]
      attempt = 0
      while True:
        attempt += 1
        try:
          response = self.client.embeddings.create(model=self.model, input=texts)
          batch_vectors = [item.embedding for item in response.data]
          embeddings.extend(batch_vectors)
          logger.info(
            "Embedded batch size=%s (progress %s/%s)",
            len(batch),
            len(embeddings),
            len(records),
          )
          break
        except Exception as exc:  # noqa: BLE001
          sleep_for = min(2**attempt, 60)
          logger.warning(
            "Embedding batch failed (attempt %s): %s. Retrying in %ss",
            attempt,
            exc,
            sleep_for,
          )
          time.sleep(sleep_for)
    return embeddings
