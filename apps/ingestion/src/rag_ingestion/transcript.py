from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from typing import Dict, List

import tiktoken

from .chunker import normalize_text


@dataclass
class SpeakerTurn:
  index: int
  speaker: str
  text: str
  char_start: int
  char_end: int


@dataclass
class TranscriptAnalysis:
  doc_id: str
  text: str
  turns: List[SpeakerTurn]
  matched_lines: int
  non_empty_lines: int
  token_count: int
  speaker_counts: Dict[str, int]

  @property
  def speaker_ratio(self) -> float:
    if self.non_empty_lines == 0:
      return 0.0
    return self.matched_lines / self.non_empty_lines

  @property
  def sam_turns(self) -> int:
    total = 0
    for name, count in self.speaker_counts.items():
      if "sam" in name.lower():
        total += count
    return total

  def snippet(self, sample_size: int = 4) -> str:
    if not self.turns:
      return ""
    total = len(self.turns)
    indices: List[int] = []
    indices.extend(range(0, min(sample_size, total)))
    if total > sample_size * 2:
      mid_start = max((total // 2) - sample_size // 2, 0)
      indices.extend(range(mid_start, min(mid_start + sample_size, total)))
    indices.extend(range(max(total - sample_size, 0), total))
    seen = set()
    segments = []
    for idx in indices:
      if idx < 0 or idx >= total or idx in seen:
        continue
      seen.add(idx)
      turn = self.turns[idx]
      segments.append(f"[{turn.index}] {turn.speaker}: {turn.text}")
    return "\n".join(segments)


class TranscriptNormalizer:
  def __init__(self, encoding_name: str = "cl100k_base"):
    self.encoding = tiktoken.get_encoding(encoding_name)
    self.pattern = re.compile(r"^(?P<speaker>[A-Za-z0-9 .’'\-]+):\s+(?P<content>.+)$")

  def analyze(self, doc_id: str, text: str) -> TranscriptAnalysis:
    normalized = normalize_text(text)
    lines = normalized.split("\n") if normalized else []
    turns: List[SpeakerTurn] = []
    matched_lines = 0
    non_empty_lines = 0
    cursor = 0
    for idx, line in enumerate(lines):
      stripped = line.strip()
      length = len(stripped)
      char_start = cursor
      char_end = cursor + length
      cursor = char_end + (1 if idx < len(lines) - 1 else 0)
      if not stripped:
        continue
      non_empty_lines += 1
      match = self.pattern.match(stripped)
      if not match:
        continue
      matched_lines += 1
      speaker = self._normalize_speaker(match.group("speaker"))
      content = match.group("content").strip()
      if not content:
        continue
      if turns and turns[-1].speaker == speaker:
        merged = f"{turns[-1].text} {content}".strip()
        turns[-1].text = merged
        turns[-1].char_end = char_end
      else:
        turns.append(
          SpeakerTurn(
            index=len(turns),
            speaker=speaker,
            text=content,
            char_start=char_start,
            char_end=char_end,
          )
        )
    speaker_counts = Counter()
    for turn in turns:
      speaker_counts[turn.speaker] += 1
    tokens = len(self.encoding.encode(normalized)) if normalized else 0
    return TranscriptAnalysis(
      doc_id=doc_id,
      text=normalized,
      turns=turns,
      matched_lines=matched_lines,
      non_empty_lines=non_empty_lines,
      token_count=tokens,
      speaker_counts=dict(speaker_counts),
    )

  def _normalize_speaker(self, label: str) -> str:
    cleaned = label.strip()
    lowered = cleaned.lower()
    if lowered in {"sam", "sam altman", "s. altman"}:
      return "Sam Altman"
    if lowered in {"unknown", "speaker", "host"}:
      return "Unknown Speaker"
    return cleaned.title()
