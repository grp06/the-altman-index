QUESTION_TYPES = [
  "factual",
  "analytical",
  "meta",
  "exploratory",
  "comparative",
  "creative",
]

QUESTION_TYPE_DEFINITIONS = {
  "factual": "Asks for specific facts, events, statements, or data points.",
  "analytical": "Seeks reasoning, causes, implications, or deeper meaning across sources.",
  "meta": "Questions about the system, sources, coverage, or information availability.",
  "exploratory": "Open-ended queries looking for broad understanding or adjacent themes.",
  "comparative": "Contrasts multiple things, time periods, or perspectives.",
  "creative": "Invites hypotheticals, predictions, or speculative scenarios.",
}

QUESTION_TYPE_PROMPTS = {
  "factual": "Deliver concise answers grounded in direct snippets or chunk_claims. Prioritize precise wording, avoid speculation, and cite the exact supporting source for every statement.",
  "analytical": "Synthesize multiple chunks to explain causes, implications, or patterns. Use chunk_claims and chunk_intents to group arguments, call out tensions, and describe evidence limits.",
  "meta": "Describe what the provided context reveals about the corpus itself. Reference metadata such as title, source_name, or upload_date, and be explicit whenever the context lacks coverage.",
  "exploratory": "Map the landscape of ideas surfaced in the context. Lean on chunk_summary and chunk_intents to cluster themes, highlight adjacent topics, and note emerging directions.",
  "comparative": "Emphasize contrasts between interviews, time periods, or viewpoints. Cite differences explicitly, pulling from metadata like source_name, title, or upload_date when present.",
  "creative": "Adopt an imaginative tone while keeping every detail tied to the supplied context. Use chunk_summary to scaffold storytelling, flag any speculative leaps, and still cite sources.",
}
