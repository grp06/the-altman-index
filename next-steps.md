# PRD: Multi-Mode RAG System for Sam Altman Interviews

## Overview

We have ~100 transcripts of Sam Altman interviews and have already built a **factual RAG system** that allows users to ask direct, fact-based questions. The next phase is to evolve this into a **multi-mode reasoning system** — one that can handle a wider variety of user queries (analytical, comparative, temporal, etc.) while maintaining architectural simplicity.

The system should intelligently adapt its retrieval and reasoning strategy based on **question type**, allowing users to explore not just *what Sam said*, but also *how his ideas evolved*, *how different themes relate*, and *what patterns emerge* across his interviews.

This PRD defines the conceptual framework, key modes, retrieval logic, and UX metaphors for this expanded RAG experience.

---

## Problem Statement

The current factual RAG pipeline works well for *precise questions* (“What did Sam say about AGI safety?”) but falls short when users ask higher-order questions that require:
- reasoning across multiple interviews,
- comparing ideas or time periods,
- identifying emerging patterns or contradictions.

We need a small, extensible set of **retrieval modes** that generalize across these use cases while being expressive enough to demonstrate advanced reasoning capabilities.

---

## Goals

- Enable users to ask **diverse question types** with natural language (e.g., “How has his view on AI regulation evolved?”).
- Automatically classify the **intent/type** of each question.
- Retrieve and synthesize information in a way that matches the question’s reasoning requirements.
- Provide clear, intuitive **visual metaphors** that make reasoning visible (e.g., cluster maps, timelines, cards).

---

## Core Idea

Most question types can be grouped into a few fundamental retrieval behaviors.
We don’t need 16 different models — just a few generalized modes that can flexibly adapt.

---

## Core Retrieval Modes

| **Mode** | **Purpose** | **Covers Question Types** | **Examples** |
|-----------|--------------|----------------------------|---------------|
| 🩵 **Factual Retrieval** | Retrieve the most semantically relevant chunks and synthesize a direct answer. | Factual, Opinion Extraction, Contextual, Sentiment | “What did Sam say about AGI risk?” |
| 💡 **Analytical / Aggregative Retrieval** | Retrieve a broader set (20–50 chunks), cluster by topic, and summarize. | Analytical, Meta, Exploratory, Synthesis | “What themes emerge in Sam’s discussions about AI governance?” |
| ⚖️ **Comparative / Temporal Retrieval** | Retrieve two or more focused sets (e.g., different time ranges or topics) and contrast them. | Comparative, Temporal, Contradiction, Causal | “How did Sam’s views on open-sourcing change between 2016 and 2024?” |

(Optionally, a future **Graph / Entity Retrieval** mode could map relationships between people, companies, and themes.)

---

## Pipeline Concept

A simplified conceptual flow:

1. **Question Classification**
   - Use an LLM to categorize user input into one of the above modes.
   - Example categories: `factual`, `analytical`, `comparative`.

2. **Mode-Specific Retrieval**
   - Each mode defines retrieval parameters (e.g., `top_k`, clustering, filters).
   - The vector store remains the same (ChromaDB or similar), but query semantics differ.

3. **Synthesis**
   - The same or a higher-tier LLM generates a structured answer.
   - The prompt adapts to mode type (e.g., "Summarize patterns" vs. "Compare viewpoints").

4. **Visualization Layer**
   - Different question types trigger different UI metaphors:
     - Factual → snippet cards with similarity scores
     - Analytical → cluster map or topic bubbles
     - Comparative → split timeline or contrast table

---

## Example Prompts (LLM Synthesis Layer)

| **Mode** | **Prompt Template (Simplified)** |
|-----------|----------------------------------|
| Factual | “Answer the question concisely using only the retrieved text. Cite supporting passages.” |
| Analytical | “Synthesize the main patterns and themes across these excerpts. Highlight recurring ideas.” |
| Comparative | “Contrast how Sam’s perspective differs between these two sets of excerpts. Focus on changes or contradictions.” |

---

## Future Extensions

- Add **entity extraction** and build a lightweight knowledge graph for relationship queries.
- Incorporate **temporal embeddings** to make trend analysis smoother.
- Support **user-driven exploration** (topic drill-downs, timeline scrubbing).

---

## To-Dos

- [ ] Define classification schema for question type detection (`factual`, `analytical`, `comparative`).
- [ ] Specify retrieval parameters per mode (`top_k`, filters, chunking granularity).
- [ ] Design prompt templates for synthesis per mode.
- [ ] Implement evaluation metrics (accuracy for factual, coherence for analytical, distinctiveness for comparative).
- [ ] Prototype minimal UI visualizations for each mode (cards, clusters, timelines).
- [ ] (Optional) Explore entity-level graph retrieval for future iteration.

---

## Guiding Principle

> A good RAG system isn’t just about *finding information* — it’s about *reasoning differently* depending on the kind of question asked.

This design aims for a **modular, mode-aware retrieval framework** that generalizes well, is visually expressive, and demonstrates deep comprehension over the Sam Altman corpus — all while keeping the architecture simple and extensible.
