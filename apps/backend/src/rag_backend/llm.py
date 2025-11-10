from __future__ import annotations

import json
from typing import List, Optional

from openai import OpenAI
from rag_core.logging import get_logger

from .config import LoadedConfig
from .constants import QUESTION_TYPES, QUESTION_TYPE_DEFINITIONS, QUESTION_TYPE_PROMPTS

logger = get_logger(__name__)

BASE_SYNTHESIS_PROMPT = (
  "You are an expert at answering questions about Sam Altman using retrieved source documents. "
  "Your goal is to provide accurate, grounded answers that cite the provided context.\n\n"
  "CRITICAL RULES:\n"
  "1. Use ONLY information from the provided context chunks. Do not add external knowledge.\n"
  "2. When possible, quote directly from the source using quotation marks.\n"
  "3. If the context doesn't contain enough information, say so explicitly.\n"
  "4. Reference which source(s) support each claim using [1], [2], etc.\n"
  "5. If sources conflict, acknowledge the discrepancy.\n"
  "6. For factual questions: provide specific, precise answers with direct quotes.\n"
  "7. For analytical questions: synthesize insights but clearly attribute them to sources.\n"
  "8. For exploratory or comparative questions: organize the answer around themes or contrasts drawn from the sources.\n"
  "9. Use chunk_summary, chunk_claims, and chunk_intents to keep explanations structured and traceable.\n\n"
  "OUTPUT FORMAT:\n"
  "Return valid JSON with two fields:\n"
  "- \"answer\": A clear, well-structured response that references sources [1], [2], etc.\n"
  "- \"reasoning\": Array of strings explaining: which chunks you used, how they support your answer, "
  "and any limitations or gaps in the available information.\n\n"
  "Example reasoning: [\"Source [1] directly states that...\", \"Source [2] provides context about...\", "
  "\"No information found about X, so cannot address that part\"]\n\n"
  "Remember: Accuracy and groundedness in the sources is more important than completeness."
)


class LLMService:
  def __init__(self, config: LoadedConfig):
    self.client = OpenAI()
    self.config = config
    self.classifier_prompt = self._build_classifier_prompt()

  def classify(self, query: str) -> dict:
    instructions = self.classifier_prompt
    response = self.client.responses.create(
      model=self.config.models.classifier,
      input=[
        {
          "role": "system",
          "content": [{"type": "input_text", "text": instructions}],
        },
        {
          "role": "user",
          "content": [{"type": "input_text", "text": f"Question: {query}"}],
        },
      ],
    )
    message_output = next((item for item in response.output if item.type == 'message'), None)
    if not message_output or not message_output.content:
      raise ValueError("No message content in response")
    content = message_output.content[0].text
    if content.startswith("```"):
      lines = content.strip().split("\n")
      content = "\n".join(lines[1:-1])
    data = json.loads(content)
    label = data["type"].strip().lower()
    if label not in QUESTION_TYPES:
      raise ValueError(f"Unsupported question type: {label}")
    confidence = float(data["confidence"])
    return {"type": label, "confidence": confidence}

  def synthesize(self, query: str, question_type: str, contexts: List[dict]) -> dict:
    context_lines = []
    for idx, ctx in enumerate(contexts, start=1):
      title = ctx.get("title") or ctx.get("source_name") or ctx["doc_id"]
      source = ctx.get("youtube_url") or ctx.get("source_path")
      snippet = ctx["text"]
      summary = self._string_or_none(ctx.get("chunk_summary"))
      claims = self._parse_list(ctx.get("chunk_claims"))
      context_lines.append(
        "\n".join(
          [
            f"[{idx}] Title: {title}",
            f"Source: {source}",
            *( [f"Summary: {summary}"] if summary else [] ),
            *( [f"Claims: {'; '.join(claims[:4])}"] if claims else [] ),
            f"Chunk: {snippet}",
          ]
        )
      )
    joined_context = "\n\n".join(context_lines) if context_lines else "No context provided."
    instructions = self._build_synthesis_prompt(question_type)
    response = self.client.responses.create(
      model=self.config.models.synthesizer,
      input=[
        {
          "role": "system",
          "content": [{"type": "input_text", "text": instructions}],
        },
        {
          "role": "user",
          "content": [{"type": "input_text", "text": f"Question type: {question_type}\nQuestion: {query}\nContext:\n{joined_context}"}],
        },
      ]
    )
    message_output = next((item for item in response.output if item.type == 'message'), None)
    if not message_output or not message_output.content:
      raise ValueError("No message content in response")
    content = message_output.content[0].text
    if content.startswith("```"):
      lines = content.strip().split("\n")
      content = "\n".join(lines[1:-1])
    data = json.loads(content)
    answer = data["answer"].strip()
    reasoning = data.get("reasoning")
    if not isinstance(reasoning, list) or not all(isinstance(item, str) for item in reasoning):
      raise ValueError("Reasoning must be a list of strings")
    return {"answer": answer, "reasoning": reasoning}

  def _build_classifier_prompt(self) -> str:
    lines = []
    for name in QUESTION_TYPES:
      description = QUESTION_TYPE_DEFINITIONS.get(name, "")
      lines.append(f"- {name}: {description}")
    definitions = "\n".join(lines)
    return (
      "You are a question classifier for a RAG system about Sam Altman. "
      f"Classify the question into exactly one of these types: {QUESTION_TYPES}\n\n"
      "Type definitions:\n"
      f"{definitions}\n\n"
      'Respond with JSON {"type": str, "confidence": float between 0 and 1}.'
    )

  def _build_synthesis_prompt(self, question_type: str) -> str:
    specific = QUESTION_TYPE_PROMPTS.get(question_type)
    if specific:
      return f"{BASE_SYNTHESIS_PROMPT}\n\nType-specific guidance ({question_type}):\n{specific}"
    return BASE_SYNTHESIS_PROMPT

  def _parse_list(self, value: object) -> List[str]:
    if value is None:
      return []
    if isinstance(value, list):
      return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    if isinstance(value, str):
      text = value.strip()
      if not text:
        return []
      try:
        parsed = json.loads(text)
      except json.JSONDecodeError:
        parsed = [text]
      if isinstance(parsed, list):
        result = []
        for entry in parsed:
          entry_str = str(entry).strip()
          if entry_str:
            result.append(entry_str)
        return result
      return [text]
    return []

  def _string_or_none(self, value: object) -> Optional[str]:
    if value is None:
      return None
    text = str(value).strip()
    return text or None
