# Phase 1 Implementation Plan: Corpus Audit + Document Enrichment

## 1. Objectives
- Guarantee every transcript/metadata pair is present, structurally sound, and ready for enrichment before running heavy jobs.
- Produce document-level metadata (summary, themes, timeframe, entities) that downstream retrieval modes can filter on without recomputation.
- Keep failures observable via `rag_core` logging so the ingestion pipeline (`apps/ingestion/src/rag_ingestion/pipeline.py`) stays deterministic.

## 2. Corpus Audit Command (`make ingestion-audit`)

### Deliverables
1. **CLI entry** `rag_ingestion audit` exposed via `typer`.
2. **CorpusAuditor** class that loads `ingestion.yaml`, scans `var/data/transcripts` and `var/data/metadata`, and emits a structured report.
3. **Exit behavior**: non-zero on hard failures (missing transcript, unreadable JSON, absent required metadata fields, empty transcript), zero with warnings otherwise.

### Validation Rules
| Category | Rule | Failure/Warn |
| --- | --- | --- |
| Filesystem | Transcript `.txt` exists for every metadata file and vice versa | Fail |
| Metadata schema | `title`, `upload_date`, `youtube_url` present and non-empty | Fail (missing) |
| Transcript structure | ≥1 occurrence of `Sam` or `Sam Altman` speaker tag per file | Warn (rare) |
| Speaker format | ≥80% of non-empty lines follow `Label: content` | Warn (records % coverage) |
| Token stats | Measure total tokens per transcript (tiktoken) and note outliers (>75th percentile) | Warn |
| Character encoding | Ensure UTF-8 decodes cleanly; log offending file path | Fail |

### Implementation Steps
1. **CLI wiring**
   - Add `audit` command in `apps/ingestion/src/rag_ingestion/cli.py` mirroring `rebuild` logging setup.
   - Allow `--config/-c` override, defaulting to `config/ingestion.yaml`.
2. **Auditor core**
   - New module `apps/ingestion/src/rag_ingestion/audit.py`.
   - Class `CorpusAuditor` accepts `LoadedConfig` and exposes `run()` returning `AuditReport` dataclass.
   - Internally, reuse `manifest.build_manifest` to enumerate transcripts; join against metadata directory listing to detect stragglers before chunking.
3. **Transcript analysis**
   - Normalize line endings (`chunker.normalize_text`) to reuse existing logic.
   - Regex `^(?P<speaker>[A-Za-z0-9 .’-]+):\s+(?P<content>.+)` for turn detection; aggregate counts per speaker.
   - Detect Sam coverage using case-insensitive matching on `speaker`.
4. **Reporting + Logging**
   - `AuditReport` includes totals, counts of failures/warnings, `top_outliers[]` (doc_id, token count).
   - Log summary using `logger.info`/`logger.warning` per `rag_core` conventions; dump full JSON to `var/artifacts/logs/corpus_audit.jsonl`.
   - On failure raise `typer.Exit(1)` after logging, matching “fail fast.”
5. **Make target**
   - `Makefile`: `ingestion-audit: ; uv run --project apps/ingestion rag-ingestion audit`.

## 3. Document-Level Enrichment Pass

### Pipeline Placement
1. **Normalization** immediately after manifest creation, before chunking.
2. **LLM batch enrichment** runs over normalized transcripts and writes enriched manifest.
3. **Persistence**: enrichments stored in `var/artifacts/metadata/manifest_enriched.parquet` and merged columns in canonical manifest (`doc_summary`, `key_themes`, `time_span`, `entities`).

### Transcript Normalization
1. Module `apps/ingestion/src/rag_ingestion/transcript.py` with:
   - `SpeakerTurn` dataclass `{speaker: str, text: str, char_start: int, char_end: int}`.
   - `TranscriptNormalizer` class:
     - Loads plain text.
     - Standardizes speaker labels (strip whitespace, title-case, map `Unknown` → `Unknown Speaker`, `Sam` → `Sam Altman`).
     - Collapses consecutive turns from same speaker.
     - Captures heuristic `segment_index` for later referencing.
2. Even without timestamps, compute pseudo time span:
   - Use metadata `upload_date` as `end`.
   - Derive `time_span` text (e.g., `"Recorded 2023-04-02 (upload 2023-04-04)"`) to satisfy downstream UI; fallback to `"Unknown"` with warning.

### LLM Batch Enrichment

#### Model Selection: GPT-5
- Use **GPT-5** for document enrichment to leverage advanced structured output capabilities.
- GPT-5 provides native JSON schema validation, ensuring responses strictly conform to the defined schema.
- Model name: `"gpt-5"` in API calls.

#### Structured Outputs Implementation
GPT-5's structured outputs feature guarantees that responses match a predefined JSON schema, eliminating the need for manual validation and retry logic for malformed JSON.

**Using Structured Outputs:**
1. Define a JSON schema using the `response_format` parameter with `type: "json_schema"`.
2. Set `strict: true` to enforce schema adherence.
3. The model will generate responses that conform exactly to the specified structure.

**Document Enrichment Schema:**

```json
{
  "type": "object",
  "properties": {
    "doc_summary": {
      "type": "string",
      "description": "Concise summary of the transcript in 120 words or less"
    },
    "key_themes": {
      "type": "array",
      "description": "List of major themes discussed in the transcript",
      "items": {
        "type": "object",
        "properties": {
          "theme": {
            "type": "string",
            "description": "Name of the theme"
          },
          "evidence_turn_indices": {
            "type": "array",
            "description": "List of turn indices where this theme appears",
            "items": { "type": "integer" }
          }
        },
        "required": ["theme", "evidence_turn_indices"]
      }
    },
    "time_span": {
      "type": "string",
      "description": "Free-form description of the time period or context (e.g., 'Post-ChatGPT launch reflections', 'Early YC days')"
    },
    "entities": {
      "type": "array",
      "description": "Key people, organizations, and concepts mentioned",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Name of the entity"
          },
          "type": {
            "type": "string",
            "enum": ["person", "organization", "concept"],
            "description": "Type of entity"
          },
          "role": {
            "type": "string",
            "description": "Role or significance in the conversation"
          }
        },
        "required": ["name", "type", "role"]
      }
    },
    "stance_notes": {
      "type": "string",
      "description": "Optional notes on Sam Altman's positions or perspectives expressed in this transcript"
    }
  },
  "required": ["doc_summary", "key_themes", "time_span", "entities"],
  "additionalProperties": false
}
```

**API Request Structure (using Responses API):**

The Responses API is OpenAI's newer stateful, multimodal API designed for agentic applications. It combines capabilities from previous APIs into a unified experience.

```python
from openai import OpenAI

client = OpenAI()

response = client.responses.create(
    model="gpt-5",
    messages=[
        {
            "role": "system",
            "content": "You are an expert at analyzing transcripts and extracting structured metadata."
        },
        {
            "role": "user",
            "content": f"Analyze this transcript and extract metadata:\n\n{transcript_snippet}"
        }
    ],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "document_enrichment",
            "strict": True,
            "schema": {
                # ... schema as defined above
            }
        }
    }
)

enrichment_data = json.loads(response.choices[0].message.content)
```

#### Batch Runner Implementation
1. **Module structure**
   - New module `enrichment.py` housing `DocumentEnricher`.
   - Uses OpenAI **Responses API** (`client.responses.create`) with GPT-5.
   - Process documents in batches sized by `config.embedding.batch_size` to stay under rate limits.
   - Accepts structured payload `{doc_id, transcript_snippet (first + middle + last turns), speakers[], token_stats}`.

2. **Error handling**
   - With `strict: True`, schema validation errors will fail at the API level with clear error messages.
   - Implement exponential backoff for rate limits and transient errors.
   - Log any failures to `var/artifacts/logs/enrichment_errors.jsonl` with full context.
   - No retry logic needed for malformed JSON (GPT-5 structured outputs guarantee valid JSON).

3. **Caching + Idempotency**
   - Write raw LLM responses per doc under `var/artifacts/enrichment/raw/{doc_id}.json` for auditing.
   - Skip calls when cache exists unless `--force` flag is passed to new CLI command `enrich`.
   - Store schema version in cache metadata to detect schema changes requiring re-enrichment.

### Persistence & Manifest Integration
1. Extend manifest columns:
   - `doc_summary` (string), `key_themes` (array of strings or JSON), `time_span` (string), `entities` (array of structs serialized as JSON), `speaker_stats` (JSON storing counts).
2. `IngestionPipeline` adjustments:
   - After `manifest = build_manifest(...)`, call `EnrichmentService.ensure_enriched(manifest)` which returns enriched DataFrame.
   - Write enriched manifest to `config.storage.manifest_path` so downstream chunk metadata inherits new columns when chunk rows are created (`pipeline._chunk_manifest` attaches doc-level columns).
   - Update summary log to include `enrichment_version` and doc count with enrichment.
3. Provide standalone CLI command `rag_ingestion enrich` to run enrichment without rebuilding embeddings, enabling iterative metadata refinement.

### Quality + Observability
- Add unit tests for `TranscriptNormalizer` using sample transcripts (fixtures under `apps/ingestion/tests/fixtures/`).
- Integration test for `DocumentEnricher` with mocked OpenAI client to ensure schema validation and caching.
- Metrics logged per document: token count, turns count, Sam coverage %, enrichment latency.

## 4. Execution Order
1. `make ingestion-audit` → ensures corpus soundness; fix any failures.
2. `make ingestion-enrich` (new target) → runs normalization + LLM pass, updates manifest.
3. Existing `make ingestion-rebuild` → now consumes enriched manifest and continues chunking/embedding.

## 5. Open Questions / Follow-Ups
- Should `key_themes` remain free-text or map to controlled vocabulary for easier filtering? (decide before surfacing in backend filters).
- Define retry/timeout policy for enrichment job (global cap or per-doc).
- Consider storing normalized speaker turns as auxiliary Parquet (`var/artifacts/metadata/turns.parquet`) to power future timeline UIs.
- Evaluate cost impact of LLM enrichment once transcript count finalized; may need smaller context windows or heuristics (sample 3 segments) to reduce spend.
