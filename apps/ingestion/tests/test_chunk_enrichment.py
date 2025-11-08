import json

import pandas as pd

from rag_core.schema_versions import CHUNK_ENRICHMENT_VERSION
from rag_ingestion.chunk_enrichment import ChunkEnrichmentService


class FakeChunkContent:
  def __init__(self, text: str):
    self.text = text


class FakeChunkOutput:
  def __init__(self, text: str):
    self.type = "message"
    self.content = [FakeChunkContent(text)]


class FakeChunkResponses:
  def __init__(self, payload: dict):
    self.payload = payload
    self.calls = 0

  def create(self, **kwargs):
    self.calls += 1
    return type("FakeResponse", (), {"output": [FakeChunkOutput(json.dumps(self.payload))]})()


class FakeChunkClient:
  def __init__(self, payload: dict):
    self.responses = FakeChunkResponses(payload)

  @property
  def calls(self) -> int:
    return self.responses.calls


def test_chunk_enrichment_generates_and_caches(loaded_config):
  chunks = pd.DataFrame(
    [
      {
        "id": "doc-1::chunk::0",
        "doc_id": "doc-1",
        "text": "Sam Altman discusses innovation and regulation.",
        "doc_summary": "Sam discusses innovation.",
        "title": "Interview",
        "source_name": "doc-1.txt",
      }
    ]
  )
  payload = {
    "chunk_summary": "Sam reflects on innovation.",
    "chunk_intents": ["argument", "roadmap"],
    "chunk_sentiment": "optimistic",
    "chunk_claims": ["Innovation needs guardrails."],
  }
  client = FakeChunkClient(payload)
  service = ChunkEnrichmentService(loaded_config, client=client)
  enriched = service.ensure_enriched(chunks, force=True)
  row = enriched.iloc[0]
  assert row["chunk_summary"] == payload["chunk_summary"]
  assert json.loads(row["chunk_intents"]) == payload["chunk_intents"]
  assert row["chunk_sentiment"] == payload["chunk_sentiment"]
  assert json.loads(row["chunk_claims"]) == payload["chunk_claims"]
  assert row["chunk_enrichment_version"] == CHUNK_ENRICHMENT_VERSION
  assert client.calls == 1
  second_client = FakeChunkClient(
    {
      "chunk_summary": "Changed summary",
      "chunk_intents": ["other"],
      "chunk_sentiment": "neutral",
      "chunk_claims": ["Changed"],
    }
  )
  cached_service = ChunkEnrichmentService(loaded_config, client=second_client)
  cached = cached_service.ensure_enriched(chunks, force=False)
  cached_row = cached.iloc[0]
  assert cached_row["chunk_summary"] == payload["chunk_summary"]
  assert second_client.calls == 0
