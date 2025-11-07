from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import typer
from rag_core.logging import configure_logging, get_logger

from .config import load_config
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


if __name__ == "__main__":
  cli_app()
