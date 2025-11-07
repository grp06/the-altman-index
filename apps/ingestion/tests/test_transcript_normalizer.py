from rag_ingestion.transcript import TranscriptNormalizer


def test_transcript_normalizer_collapses_consecutive_turns():
  text = "\n".join(
    [
      "Sam Altman: First thought",
      "Sam Altman: Second thought",
      "Unknown: Response",
      "Sam: Closing",
    ]
  )
  normalizer = TranscriptNormalizer()
  analysis = normalizer.analyze("doc-1", text)
  assert len(analysis.turns) == 3
  assert analysis.turns[0].speaker == "Sam Altman"
  assert "Second thought" in analysis.turns[0].text
  assert analysis.sam_turns == 2
  assert analysis.speaker_ratio == 1.0


def test_transcript_normalizer_snippet_spans_sections():
  text = "\n".join(
    [
      f"Sam Altman: Thought {idx}" if idx % 2 == 0 else f"Unknown: Remark {idx}"
      for idx in range(12)
    ]
  )
  normalizer = TranscriptNormalizer()
  analysis = normalizer.analyze("doc-2", text)
  snippet = analysis.snippet()
  assert "[0]" in snippet and "[10]" in snippet
  assert "Sam Altman" in snippet
  assert analysis.token_count > 0
