from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List

import tiktoken


def normalize_text(text: str) -> str:
  cleaned = text.replace("\r\n", "\n").replace("\r", "\n")
  lines = [line.strip() for line in cleaned.splitlines()]
  collapsed = "\n".join(line for line in lines if line)
  return collapsed.strip()


@dataclass
class Chunker:
  chunk_size: int
  overlap: int
  encoding_name: str = "cl100k_base"

  def __post_init__(self) -> None:
    self._encoding = tiktoken.get_encoding(self.encoding_name)

  def chunk(self, doc_id: str, text: str) -> List[dict]:
    normalized = normalize_text(text)
    tokens = self._encoding.encode(normalized)
    chunks: List[dict] = []
    start = 0
    chunk_index = 0
    total_tokens = len(tokens)
    if total_tokens == 0:
      return []
    while start < total_tokens:
      end = min(start + self.chunk_size, total_tokens)
      chunk_tokens = tokens[start:end]
      chunk_text = self._encoding.decode(chunk_tokens)
      chunks.append(
        {
          "id": f"{doc_id}::chunk::{chunk_index}",
          "doc_id": doc_id,
          "chunk_index": chunk_index,
          "text": chunk_text,
          "tokens": len(chunk_tokens),
          "start_token": start,
          "end_token": end,
        }
      )
      chunk_index += 1
      if end == total_tokens:
        break
      start = max(end - self.overlap, 0)
    return chunks
