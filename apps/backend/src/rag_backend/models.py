from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from .constants import QUESTION_TYPES


class ClassifyRequest(BaseModel):
  query: str = Field(..., min_length=3)


class ClassifyResponse(BaseModel):
  type: str
  confidence: float


class SearchRequest(BaseModel):
  query: str = Field(..., min_length=3)
  question_type: str = Field(..., min_length=1)
  top_k: Optional[int] = Field(None, gt=0, le=20)

  @field_validator("question_type")
  @classmethod
  def validate_question_type(cls, value: str) -> str:
    lowered = value.lower()
    if lowered not in QUESTION_TYPES:
      raise ValueError(f"Unsupported question type: {value}")
    return lowered


class ChunkMetadata(BaseModel):
  id: str
  snippet: str
  score: float
  metadata: dict


class SearchResponse(BaseModel):
  count: int
  chunks: List[ChunkMetadata]


class SynthesizeRequest(BaseModel):
  query: str = Field(..., min_length=3)
  question_type: str = Field(..., min_length=1)
  chunk_ids: List[str] = Field(..., min_length=1)

  @field_validator("question_type")
  @classmethod
  def validate_question_type(cls, value: str) -> str:
    lowered = value.lower()
    if lowered not in QUESTION_TYPES:
      raise ValueError(f"Unsupported question type: {value}")
    return lowered


class SynthesizeResponse(BaseModel):
  answer: str
  reasoning: List[str]


class HealthResponse(BaseModel):
  status: str
  chunks: int
  last_ingestion_run: Optional[dict]
  config_version: int
