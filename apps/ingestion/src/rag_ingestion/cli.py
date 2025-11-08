from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import typer
from rag_core.logging import configure_logging, get_logger
from rag_core.schema_versions import (
  CHUNK_ENRICHMENT_VERSION,
  DOCUMENT_ENRICHMENT_VERSION,
  EMBEDDING_SET_VERSION,
)

from .audit import CorpusAuditor
from .config import load_config
from .enrichment import DocumentEnrichmentService
from .manifest import build_manifest
from .pipeline import IngestionPipeline

cli_app = typer.Typer(help="Sam Altman ingestion pipeline controls.")
logger = get_logger(__name__)


def _load_and_validate_config(config_path: Optional[Path]) -> IngestionPipeline:
  config = load_config(config_path)
  config.ensure_storage_paths()
  return IngestionPipeline(config)


@cli_app.command()
def rebuild(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
  """Run a full rebuild of the Chroma index and chunk metadata."""
  configure_logging()
  pipeline = _load_and_validate_config(config)
  summary = pipeline.run_rebuild()
  typer.echo(f"Rebuild completed. Summary: {summary}")


@cli_app.command()
def append(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
  """Process newly added transcripts and append to the existing index."""
  configure_logging()
  pipeline = _load_and_validate_config(config)
  summary = pipeline.run_append()
  typer.echo(f"Append completed. Summary: {summary}")


@cli_app.command()
def validate(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
  """Validate configuration and filesystem dependencies."""
  configure_logging()
  loaded = load_config(config)
  missing = []
  for label, path in [
    ("transcripts", loaded.storage.transcripts_dir),
    ("metadata", loaded.storage.metadata_dir),
  ]:
    if not path.exists():
      missing.append(f"{label}: {path}")
  if missing:
    typer.secho("Missing required paths:", fg=typer.colors.RED, err=True)
    for item in missing:
      typer.secho(f"- {item}", fg=typer.colors.RED, err=True)
    raise typer.Exit(code=1)
  loaded.ensure_storage_paths()
  if not os.getenv("OPENAI_API_KEY"):
    typer.secho("Warning: OPENAI_API_KEY is not set.", fg=typer.colors.YELLOW)
  typer.echo("Configuration validated successfully.")


@cli_app.command()
def audit(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
  configure_logging()
  loaded = load_config(config)
  auditor = CorpusAuditor(loaded)
  report = auditor.run()
  typer.echo(json.dumps(report.to_dict(), indent=2))
  if report.error_count:
    raise typer.Exit(code=1)


@cli_app.command()
def enrich(
  config: Optional[Path] = typer.Option(None, "--config", "-c"),
  force: bool = typer.Option(False, "--force", "-f"),
) -> None:
  configure_logging()
  loaded = load_config(config)
  loaded.ensure_storage_paths()
  manifest = build_manifest(loaded.storage.transcripts_dir, loaded.storage.metadata_dir)
  service = DocumentEnrichmentService(loaded)
  frame = service.ensure_enriched(manifest, force=force)
  typer.echo(f"Enriched {len(frame)} transcripts.")


@cli_app.command()
def inspect(config: Optional[Path] = typer.Option(None, "--config", "-c")) -> None:
  """Inspect enrichment caches and embedding versions."""
  configure_logging()
  loaded = load_config(config)
  loaded.ensure_storage_paths()
  doc_cache = loaded.storage.artifacts_dir / "enrichment" / "raw"
  chunk_cache = loaded.storage.artifacts_dir / "enrichment" / "chunks"
  payload = {
    "document_cache": _cache_report(doc_cache),
    "chunk_cache": _cache_report(chunk_cache),
    "expected_versions": {
      "document_enrichment_version": DOCUMENT_ENRICHMENT_VERSION,
      "chunk_enrichment_version": CHUNK_ENRICHMENT_VERSION,
      "embedding_set_version": EMBEDDING_SET_VERSION,
    },
  }
  typer.echo(json.dumps(payload, indent=2))


def _cache_report(path: Path) -> dict:
  report = {
    "path": str(path),
    "exists": path.exists(),
    "count": 0,
    "latest_modified": None,
    "versions": [],
  }
  if not path.exists():
    return report
  files = sorted(path.glob("*.json"))
  report["count"] = len(files)
  versions = set()
  latest = None
  for entry in files:
    try:
      payload = json.loads(entry.read_text(encoding="utf-8"))
      version = payload.get("version")
      if version is not None:
        versions.add(str(version))
    except json.JSONDecodeError:
      versions.add("invalid")
    mtime = entry.stat().st_mtime
    if latest is None or mtime > latest:
      latest = mtime
  if latest is not None:
    report["latest_modified"] = datetime.fromtimestamp(latest, tz=timezone.utc).isoformat()
  report["versions"] = sorted(versions)
  return report


if __name__ == "__main__":
  cli_app()
