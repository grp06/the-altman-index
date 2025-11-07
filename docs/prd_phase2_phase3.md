# PRD: Analytical Retrieval & UX Rollout

This specification guides Phase 2 (“Retrieval & Reasoning”) and Phase 3 (“UX, Testing, Rollout”) for the Sam Altman RAG system. Prior phases already delivered document-level enrichment, chunk metadata, and a scalable ingestion pipeline. The following work builds analytical retrieval behaviors on top of those artifacts. Treat this document as the source of truth—no other conversations are required.

---

## Phase 2 – Retrieval & Reasoning

### 1. Configuration & Orchestrator
1. Extend `config/backend.yaml` with a new `modes` section:
   ```yaml
   modes:
     factual:
       top_k: 6
       min_docs: 2
       clustering: null
     analytical:
       top_k: 20
       min_docs: 5
       clustering:
         strategy: key_theme
         max_clusters: 6
         min_chunk_per_cluster: 2
   ```
2. Add a Pydantic model `ModeSettings` in `apps/backend/src/rag_backend/config.py`. Validate presence of `top_k`, `min_docs`, and optional `clustering`.
3. Create a `RetrievalOrchestrator` class (new file) that:
   - Loads config modes during startup.
   - Accepts query + question_type.
   - Routes to specialized flows per mode.
4. Update `/search` handler to call the orchestrator instead of `Retriever.search` directly. Keep `Retriever` for low-level vector lookups.

### 2. Analytical Query Expansion
1. Implement `QueryExpander` (within orchestrator or separate module) that:
   - Calls an LLM (OpenAI Responses API) with the user query plus doc-level metadata hints.
   - Returns 2–3 focused sub-queries covering different themes/time ranges.
2. For each sub-query:
   - Run retrieval against enriched collections:
     - Base chunk collection (existing).
     - Summary/intents/doc-summary collections once Phase 1 chunk embeddings exist (placeholders until then).
   - Collect chunk IDs, deduplicate, and record which sub-query produced each chunk.
3. Enforce coverage:
   - `min_docs`: ensure results span at least X distinct doc_ids; if not, run an additional fallback sub-query that emphasizes diversity.
   - Cap overall chunk list to `top_k`.

### 3. Clustering Layer
1. After retrieval, cluster chunks when `clustering.strategy` is set:
   - Default strategy: group by `key_theme` metadata; fallback to `doc_id` if theme missing.
   - Score each cluster using average similarity + recency (use `upload_date` or doc-level timestamp).
   - Trim to `max_clusters`; within each cluster select:
     - `representative`: highest-scoring chunk text snippet.
     - `supporting_quotes`: up to 3 additional chunks.
2. Return structured “evidence packs”:
   ```json
   {
     "clusters": [
       {
         "key": "AI governance",
         "score": 0.82,
         "representative": {...chunk fields...},
         "supporting_quotes": [...chunks...],
         "doc_ids": ["...", "..."]
       }
     ],
     "chunks": [...flat chunk list for backward compatibility...]
   }
   ```
3. Keep factual mode untouched: no clustering, direct chunk list.

### 4. Synthesis Updates
1. Modify `LLMService.synthesize`:
   - Accept optional `clusters` payload.
   - When `question_type == "analytical"`, format the prompt with:
     - Cluster summaries (key + representative snippet).
     - Supporting quotes referenced as `[Cluster X Quote Y]`.
     - Explicit instructions to extract patterns, highlight trends, note coverage gaps.
2. Preserve existing behavior for factual mode to avoid regressions.
3. Include structured reasoning array referencing clusters (e.g., “Cluster [1] shows Sam’s stance in 2017…”).

### 5. Observability
1. Emit structured logs per `/search` call:
   - `question_type`, `mode`, `chunks_requested`, `chunks_returned`, `clusters_returned`, `docs_covered`, `subqueries_executed`.
   - Write to backend log + optional JSONL under `var/artifacts/logs/retrieval_runs.jsonl`.
2. Update `/healthz` to display last retrieval log timestamp (optional but recommended).

---

## Phase 3 – UX, Testing, Rollout

### 1. API & Models
1. Update `SearchResponse` in `apps/backend/src/rag_backend/models.py`:
   - Add optional `clusters: List[ClusterEvidence]`.
   - Define `ClusterEvidence` model (key, score, representative chunk, supporting quotes, doc_ids).
   - Keep `chunks` for backward compatibility.
2. Document the new response shape in `README.md` and `docs/API.md` (new doc if needed).

### 2. Frontend Coordination
1. Update `apps/frontend` to handle:
   - Display of clusters as “topic cards” or timeline entries.
   - Fallback to old UI when `clusters` absent.
2. Provide at least one mock fixture (JSON) so frontend devs can iterate without backend running.

### 3. Testing
1. Add backend unit tests:
   - Query expansion prompt parsing.
   - Clustering logic (with synthetic chunk metadata).
   - Synthesis prompt selection per question type.
2. Add integration test (pytest) hitting `/search` with `question_type="analytical"` and mocking retriever/LLM to verify response schema.
3. (Eval scope explicitly out of this phase.)

### 4. Rollout Plan
1. Feature flag analytical mode in config (e.g., `modes.analytical.enabled`). Default `true` once tests pass.
2. Update `next-steps.md` with validation steps:
   - `make ingestion-rebuild`
   - `uv run --project apps/backend pytest`
   - Manual smoke test: question type toggling on the frontend.
3. Communicate API changes to any external consumers (if applicable).

---

## Deliverables Checklist
- [ ] Backend config & orchestrator for multi-mode retrieval.
- [ ] Analytical query expansion + clustering generating evidence packs.
- [ ] Updated synthesis prompts & logging.
- [ ] API response changes with clusters + frontend consumption plan.
- [ ] Test suite covering new logic.
- [ ] Documentation updates (`README`, API docs, next steps).

This PRD provides the full context required for an LLM or engineer to implement the outstanding Phase 2 and Phase 3 work without referring back to prior conversations.*** End Patch
