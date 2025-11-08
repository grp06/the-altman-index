from types import SimpleNamespace

import pandas as pd

from rag_backend.chunk_store import ChunkStore
from rag_backend.retriever import Retriever


class FakeEmbeddingsAPI:
  def create(self, **kwargs):
    return SimpleNamespace(data=[SimpleNamespace(embedding=[0.1, 0.2, 0.3])])


class FakeOpenAI:
  def __init__(self):
    self.embeddings = FakeEmbeddingsAPI()


class FakeCollection:
  def __init__(self, name: str, responses: dict):
    self.name = name
    self.responses = responses

  def query(self, **kwargs):
    return self.responses.get(
      self.name,
      {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]},
    )


class FakeClient:
  def __init__(self, responses: dict):
    self.responses = responses

  def get_or_create_collection(self, name: str, metadata=None):
    return FakeCollection(name, self.responses)


def build_chunk_store(tmp_path):
  chunk_path = tmp_path / "chunks.parquet"
  data = [
    {
      "id": "chunk-1",
      "doc_id": "doc-a",
      "chunk_index": 0,
      "text": "Primary chunk text",
      "tokens": 50,
      "start_token": 0,
      "end_token": 50,
      "title": "Document A",
      "upload_date": "20230101",
      "youtube_url": "https://example.com/a",
      "source_path": "/tmp/doc-a.txt",
      "source_name": "doc-a",
      "doc_summary": "Doc A overview",
      "key_themes": "[]",
      "time_span": "2023",
      "entities": "[]",
      "stance_notes": "",
      "speaker_stats": "",
      "doc_token_count": 100,
      "doc_turn_count": 10,
      "chunk_summary": "Chunk 1 summary",
      "chunk_intents": '["Roadmap"]',
      "chunk_sentiment": "optimistic",
      "chunk_claims": '["Claim 1"]',
      "chunk_enrichment_version": 1,
    },
    {
      "id": "chunk-2",
      "doc_id": "doc-b",
      "chunk_index": 0,
      "text": "Secondary chunk",
      "tokens": 40,
      "start_token": 0,
      "end_token": 40,
      "title": "Document B",
      "upload_date": "20230202",
      "youtube_url": "https://example.com/b",
      "source_path": "/tmp/doc-b.txt",
      "source_name": "doc-b",
      "doc_summary": "Doc B overview",
      "key_themes": "[]",
      "time_span": "2022",
      "entities": "[]",
      "stance_notes": "",
      "speaker_stats": "",
      "doc_token_count": 120,
      "doc_turn_count": 12,
      "chunk_summary": "Chunk 2 summary",
      "chunk_intents": '["Warning", "Roadmap"]',
      "chunk_sentiment": "cautious",
      "chunk_claims": '["Claim 2"]',
      "chunk_enrichment_version": 1,
    },
  ]
  frame = pd.DataFrame(data)
  frame.to_parquet(chunk_path, index=False)
  return ChunkStore(chunk_path)


def make_config(tmp_path):
  retrieval = SimpleNamespace(
    collection_name="test_primary",
    distance_metric="cosine",
    summary_collection_name="test_primary_summary",
    intents_collection_name="test_primary_intents",
    doc_summary_collection_name="test_primary_docsum",
    profiles={},
    top_k=5,
  )
  models = SimpleNamespace(embedding="text-embedding-3-small")
  storage = SimpleNamespace(index_dir=tmp_path)
  return SimpleNamespace(retrieval=retrieval, models=models, storage=storage)


def patch_clients(monkeypatch, responses):
  monkeypatch.setattr("rag_backend.retriever.OpenAI", FakeOpenAI)
  monkeypatch.setattr(
    "rag_backend.retriever.chromadb.PersistentClient",
    lambda *args, **kwargs: FakeClient(responses),
  )


def test_retriever_merges_secondary_sources(monkeypatch, tmp_path):
  chunk_store = build_chunk_store(tmp_path)
  config = make_config(tmp_path)
  responses = {
    "test_primary": {
      "ids": [["chunk-1"]],
      "documents": [["Primary snippet"]],
      "metadatas": [[{"chunk_summary": "Chunk 1 summary"}]],
      "distances": [[0.1]],
    },
    "test_primary_summary": {
      "ids": [["chunk-2"]],
      "documents": [["Summary-focused snippet"]],
      "metadatas": [[{"doc_id": "doc-b"}]],
      "distances": [[0.2]],
    },
    "test_primary_intents": {
      "ids": [["chunk-2"]],
      "documents": [["Intent text"]],
      "metadatas": [[{"doc_id": "doc-b"}]],
      "distances": [[0.3]],
    },
    "test_primary_docsum": {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]},
  }
  patch_clients(monkeypatch, responses)
  retriever = Retriever(config, chunk_store)
  result = retriever.search(
    query="test query",
    question_type="analytical",
    top_k=3,
    intent_filters=[],
    sentiment_filters=[],
  )
  assert result["retrieval_mode"] == "analytical"
  ids = {chunk["id"] for chunk in result["chunks"]}
  assert ids == {"chunk-1", "chunk-2"}
  summary_chunk = next(chunk for chunk in result["chunks"] if chunk["id"] == "chunk-2")
  assert summary_chunk["vector_source"] == "summary"
  assert summary_chunk["chunk_summary"] == "Chunk 2 summary"
  sources = {entry["source"] for entry in result["collections_used"]}
  assert sources == {"primary", "summary", "intents"}


def test_retriever_maps_docsum_hits_to_chunk_ids(monkeypatch, tmp_path):
  chunk_store = build_chunk_store(tmp_path)
  config = make_config(tmp_path)
  responses = {
    "test_primary": {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]},
    "test_primary_summary": {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]},
    "test_primary_intents": {"ids": [[]], "documents": [[]], "metadatas": [[]], "distances": [[]]},
    "test_primary_docsum": {
      "ids": [["doc-b"]],
      "documents": [["Doc B overview snippet"]],
      "metadatas": [[{"doc_id": "doc-b"}]],
      "distances": [[0.05]],
    },
  }
  patch_clients(monkeypatch, responses)
  retriever = Retriever(config, chunk_store)
  result = retriever.search(
    query="compare docs",
    question_type="comparative",
    top_k=4,
    intent_filters=[],
    sentiment_filters=[],
  )
  assert result["retrieval_mode"] == "comparative"
  assert len(result["chunks"]) == 1
  chunk = result["chunks"][0]
  assert chunk["id"] == "chunk-2"
  assert chunk["vector_source"] == "docsum"
  assert chunk["snippet"] == "Doc B overview snippet"
  docsum_usage = next(entry for entry in result["collections_used"] if entry["source"] == "docsum")
  assert docsum_usage["returned"] == 1
