import pandas as pd

from rag_core.schema_versions import EMBEDDING_SET_VERSION
from rag_ingestion.secondary_embeddings import SecondaryEmbeddingService


class FakeEmbeddingClient:
  def __init__(self):
    self.calls = []

  def embed(self, records):
    self.calls.append(len(records))
    return [[float(idx + 1)] for idx, _ in enumerate(records)]


def test_secondary_embeddings_write_parquet_and_payload(loaded_config):
  chunks = pd.DataFrame(
    [
      {
        "id": "doc-1::chunk::0",
        "doc_id": "doc-1",
        "chunk_summary": "Sam focuses on governance.",
        "chunk_intents": '["analysis","roadmap"]',
      }
    ]
  )
  manifest = pd.DataFrame(
    [
      {
        "doc_id": "doc-1",
        "doc_summary": "Sam summarizes governance approach.",
      }
    ]
  )
  client = FakeEmbeddingClient()
  service = SecondaryEmbeddingService(loaded_config, client)
  outputs = service.generate(mode="rebuild", chunks=chunks, manifest=manifest)
  assert set(outputs.keys()) == {"chunk_summary", "chunk_intents", "doc_summary"}
  summary_path = loaded_config.storage.chunk_summary_embeddings_path
  intents_path = loaded_config.storage.chunk_intents_embeddings_path
  docs_path = loaded_config.storage.doc_summary_embeddings_path
  summary_frame = pd.read_parquet(summary_path)
  intents_frame = pd.read_parquet(intents_path)
  docs_frame = pd.read_parquet(docs_path)
  assert summary_frame.iloc[0]["embedding_set_version"] == EMBEDDING_SET_VERSION
  assert intents_frame.iloc[0]["embedding_set_version"] == EMBEDDING_SET_VERSION
  assert docs_frame.iloc[0]["embedding_set_version"] == EMBEDDING_SET_VERSION
  assert outputs["chunk_summary"]["metadatas"][0]["doc_id"] == "doc-1"
  assert outputs["doc_summary"]["ids"][0] == "doc-1"
  assert client.calls == [1, 1, 1]
