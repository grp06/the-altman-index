import json

from typer.testing import CliRunner

from rag_core.schema_versions import CHUNK_ENRICHMENT_VERSION, DOCUMENT_ENRICHMENT_VERSION
from rag_ingestion.cli import cli_app


def test_inspect_command_reports_cache_health(monkeypatch, loaded_config):
  artifacts_dir = loaded_config.storage.artifacts_dir
  doc_cache = artifacts_dir / "enrichment" / "raw"
  chunk_cache = artifacts_dir / "enrichment" / "chunks"
  doc_cache.mkdir(parents=True, exist_ok=True)
  chunk_cache.mkdir(parents=True, exist_ok=True)
  (doc_cache / "doc.json").write_text(
    json.dumps({"version": DOCUMENT_ENRICHMENT_VERSION, "data": {}}),
    encoding="utf-8",
  )
  (chunk_cache / "chunk.json").write_text(
    json.dumps({"version": CHUNK_ENRICHMENT_VERSION, "data": {}}),
    encoding="utf-8",
  )
  monkeypatch.setattr("rag_ingestion.cli.load_config", lambda path=None: loaded_config)
  runner = CliRunner()
  result = runner.invoke(cli_app, ["inspect"])
  assert result.exit_code == 0
  payload = json.loads(result.stdout)
  assert payload["document_cache"]["count"] == 1
  assert payload["chunk_cache"]["count"] == 1
  assert payload["document_cache"]["versions"] == [str(DOCUMENT_ENRICHMENT_VERSION)]
  assert payload["chunk_cache"]["versions"] == [str(CHUNK_ENRICHMENT_VERSION)]
  assert payload["expected_versions"]["document_enrichment_version"] == DOCUMENT_ENRICHMENT_VERSION
