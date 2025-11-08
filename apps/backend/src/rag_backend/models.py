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
  intent_filters: Optional[List[str]] = Field(default=None)
  sentiment_filters: Optional[List[str]] = Field(default=None)

  @field_validator("question_type")
  @classmethod
  def validate_question_type(cls, value: str) -> str:
    lowered = value.lower()
    if lowered not in QUESTION_TYPES:
      raise ValueError(f"Unsupported question type: {value}")
    return lowered

  @field_validator("intent_filters", "sentiment_filters")
  @classmethod
  def validate_filters(cls, value: Optional[List[str]]) -> Optional[List[str]]:
    if value is None:
      return value
    cleaned = []
    for item in value:
      if not isinstance(item, str) or not item.strip():
        raise ValueError("Filters must be non-empty strings")
      cleaned.append(item.strip())
    return cleaned


class ChunkMetadata(BaseModel):
  id: str
  snippet: str
  score: float
  metadata: dict
  chunk_summary: Optional[str] = None
  chunk_intents: List[str] = Field(default_factory=list)
  chunk_sentiment: Optional[str] = None
  chunk_claims: List[str] = Field(default_factory=list)
  vector_source: str

  @field_validator("vector_source")
  @classmethod
  def validate_vector_source(cls, value: str) -> str:
    allowed = {"primary", "summary", "intents", "docsum"}
    lowered = value.strip().lower()
    if lowered not in allowed:
      raise ValueError(f"Unsupported vector source: {value}")
    return lowered


class CollectionUsage(BaseModel):
  source: str
  name: str
  requested: int
  returned: int


class SearchResponse(BaseModel):
  count: int
  chunks: List[ChunkMetadata]
  aggregated_count: int
  retrieval_mode: str
  collections_used: List[CollectionUsage]


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
  secondary_embeddings_updated_at: Optional[str]
