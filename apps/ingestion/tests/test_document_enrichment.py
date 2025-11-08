import json

from rag_ingestion.config import LoadedConfig
from rag_ingestion.enrichment import DocumentEnrichmentService
from rag_ingestion.manifest import build_manifest


class FakeContent:
  def __init__(self, text: str):
    self.text = text


class FakeOutput:
  def __init__(self, text: str):
    self.type = "message"
    self.content = [FakeContent(text)]


class FakeResponses:
  def __init__(self, payload: dict):
    self.payload = payload

  def create(self, **kwargs):
    return type("FakeResponse", (), {"output": [FakeOutput(json.dumps(self.payload))]})()


class FakeClient:
  def __init__(self, payload: dict):
    self.responses = FakeResponses(payload)


def test_document_enrichment_service_generates_manifest(loaded_config: LoadedConfig):
  transcript_path = loaded_config.storage.transcripts_dir / "sample.txt"
  transcript_path.write_text(
    "\n".join(
      [
        "Sam Altman: Welcome everyone",
        "Unknown: Thanks for being here",
        "Sam Altman: Let's discuss AI safety",
      ]
    ),
    encoding="utf-8",
  )
  metadata_path = loaded_config.storage.metadata_dir / "sample.json"
  metadata_path.write_text(
    json.dumps(
      {
        "title": "Sample Interview",
        "upload_date": "2023-01-01",
        "original_url": "https://example.com/interview",
      }
    ),
    encoding="utf-8",
  )
  manifest = build_manifest(loaded_config.storage.transcripts_dir, loaded_config.storage.metadata_dir)
  payload = {
    "doc_summary": "Sam discusses AI safety priorities.",
    "key_themes": [{"theme": "AI safety", "evidence_turn_indices": [0, 2]}],
    "time_span": "Post-ChatGPT launch reflections",
    "entities": [{"name": "OpenAI", "type": "organization", "role": "Company"}],
    "stance_notes": "Optimistic about regulation.",
  }
  client = FakeClient(payload)
  service = DocumentEnrichmentService(loaded_config, client=client)
  enriched = service.ensure_enriched(manifest, force=True)
  assert "doc_summary" in enriched.columns
  assert enriched.iloc[0]["doc_summary"] == payload["doc_summary"]
  assert enriched.iloc[0]["key_themes"]
  assert loaded_config.storage.enriched_manifest_path.exists()
