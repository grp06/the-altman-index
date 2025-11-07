from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from rag_core.logging import get_logger

from .config import LoadedConfig
from .manifest import build_manifest
from .transcript import TranscriptAnalysis, TranscriptNormalizer

logger = get_logger(__name__)


@dataclass
class AuditDocument:
  doc_id: str
  token_count: int
  speaker_ratio: float
  sam_turns: int
  turn_count: int
  warnings: List[str]
  errors: List[str]

  def to_dict(self) -> dict:
    return {
      "doc_id": self.doc_id,
      "token_count": self.token_count,
      "speaker_ratio": self.speaker_ratio,
      "sam_turns": self.sam_turns,
      "turn_count": self.turn_count,
      "warnings": self.warnings,
      "errors": self.errors,
    }


@dataclass
class AuditReport:
  documents: List[AuditDocument]
  missing_metadata: List[str]
  missing_transcripts: List[str]
  top_outliers: List[dict]
  token_threshold: int
  error_count: int
  warning_count: int
  generated_at: str

  def to_dict(self) -> dict:
    return {
      "generated_at": self.generated_at,
      "documents": [doc.to_dict() for doc in self.documents],
      "missing_metadata": self.missing_metadata,
      "missing_transcripts": self.missing_transcripts,
      "top_outliers": self.top_outliers,
      "token_threshold": self.token_threshold,
      "error_count": self.error_count,
      "warning_count": self.warning_count,
      "total_documents": len(self.documents),
    }


class CorpusAuditor:
  def __init__(self, config: LoadedConfig):
    self.config = config
    self.normalizer = TranscriptNormalizer()

  def run(self) -> AuditReport:
    manifest = build_manifest(self.config.storage.transcripts_dir, self.config.storage.metadata_dir)
    manifest_map = {row["doc_id"]: row for row in manifest.to_dict(orient="records")}
    metadata_map, metadata_errors = self._load_metadata(self.config.storage.metadata_dir)
    doc_ids = sorted(set(manifest_map.keys()).union(metadata_map.keys()))
    documents: List[AuditDocument] = []
    warning_total = 0
    error_total = 0
    token_counts = []
    for doc_id in doc_ids:
      row = manifest_map.get(doc_id)
      metadata = metadata_map.get(doc_id)
      errors, warnings = [], []
      analysis: Optional[TranscriptAnalysis] = None
      if row is None:
        errors.append("Transcript file missing")
      else:
        transcript_path = Path(row["source_path"])
        if not transcript_path.exists():
          errors.append("Transcript file missing")
        else:
          try:
            text = transcript_path.read_text(encoding="utf-8")
          except UnicodeDecodeError:
            errors.append("Transcript could not be decoded as UTF-8")
          else:
            analysis = self.normalizer.analyze(doc_id, text)
            if analysis.token_count == 0:
              errors.append("Transcript is empty after normalization")
            else:
              token_counts.append(analysis.token_count)
            if analysis.speaker_ratio < 0.8:
              warnings.append("Less than 80% of lines follow speaker format")
            if analysis.sam_turns == 0:
              warnings.append("No Sam Altman speaker turns detected")
      if doc_id in metadata_errors:
        errors.append(f"Metadata parse error: {metadata_errors[doc_id]}")
      required_fields = ["title", "upload_date", "youtube_url"]
      for field in required_fields:
        value = None
        if metadata is not None:
          value = metadata.get(field)
        if self._is_missing(value) and row is not None:
          value = row.get(field)
        if self._is_missing(value):
          errors.append(f"Metadata missing field: {field}")
      document = AuditDocument(
        doc_id=doc_id,
        token_count=analysis.token_count if analysis else 0,
        speaker_ratio=analysis.speaker_ratio if analysis else 0.0,
        sam_turns=analysis.sam_turns if analysis else 0,
        turn_count=len(analysis.turns) if analysis else 0,
        warnings=warnings,
        errors=errors,
      )
      warning_total += len(warnings)
      error_total += len(errors)
      documents.append(document)
    metadata_ids = set(metadata_map.keys())
    manifest_ids = set(manifest_map.keys())
    missing_metadata = sorted(manifest_ids - metadata_ids)
    missing_transcripts = sorted(metadata_ids - manifest_ids)
    error_total += len(missing_metadata) + len(missing_transcripts)
    token_threshold = self._token_threshold(token_counts)
    top_outliers: List[dict] = []
    if token_threshold > 0:
      for doc in documents:
        if doc.token_count >= token_threshold:
          doc.warnings.append("Token count above 75th percentile")
          warning_total += 1
          top_outliers.append({"doc_id": doc.doc_id, "token_count": doc.token_count})
    generated_at = datetime.now(timezone.utc).isoformat()
    report = AuditReport(
      documents=documents,
      missing_metadata=missing_metadata,
      missing_transcripts=missing_transcripts,
      top_outliers=top_outliers,
      token_threshold=token_threshold,
      error_count=error_total,
      warning_count=warning_total,
      generated_at=generated_at,
    )
    self._write_report(report)
    if report.error_count:
      logger.error(
        "Corpus audit failed with %s errors and %s warnings",
        report.error_count,
        report.warning_count,
      )
    else:
      logger.info(
        "Corpus audit passed with %s warnings across %s documents",
        report.warning_count,
        len(documents),
      )
    if missing_metadata:
      logger.error("Missing metadata for: %s", ", ".join(missing_metadata))
    if missing_transcripts:
      logger.error("Metadata present without transcripts for: %s", ", ".join(missing_transcripts))
    return report

  def _load_metadata(self, metadata_dir: Path) -> Tuple[Dict[str, dict], Dict[str, str]]:
    lookup: Dict[str, dict] = {}
    errors: Dict[str, str] = {}
    for path in sorted(metadata_dir.glob("*.json")):
      try:
        data = json.loads(path.read_text(encoding="utf-8"))
      except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        errors[path.stem] = str(exc)
        continue
      lookup[path.stem] = data
    return lookup, errors

  def _token_threshold(self, counts: List[int]) -> int:
    if not counts:
      return 0
    sorted_counts = sorted(counts)
    index = max(int(len(sorted_counts) * 0.75) - 1, 0)
    return sorted_counts[index]

  def _write_report(self, report: AuditReport) -> None:
    path = self.config.logging.audit_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
      handle.write(json.dumps(report.to_dict()) + "\n")

  def _is_missing(self, value: Optional[object]) -> bool:
    if value is None:
      return True
    if isinstance(value, float) and math.isnan(value):
      return True
    if isinstance(value, str) and not value.strip():
      return True
    return False
