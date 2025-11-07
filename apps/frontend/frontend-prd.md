# Project: Sam Altman Interview Explorer

## Overview
We’re building a **transparent AI search app** that lets users ask any question about a corpus of 100 Sam Altman interviews and **see how the AI thinks step-by-step**.
The app will visualize the RAG (Retrieval-Augmented Generation) process — showing query classification, retrieval, and reasoning — in a clear, educational UI.

Users can:
- Ask freeform questions or pick from suggested ones.
- Watch the system classify their question (factual, analytical, meta, etc.).
- See retrieved chunks, reasoning traces, and the final synthesized answer.

---

## Data Sources & Backend Integration
- **Transcript Corpus:** `/Users/georgepickett/n8n-local/diarized_audio/transcripts/` (36 processed interview transcripts)
- **Metadata Store:** `/Users/georgepickett/n8n-local/download_youtube_audio/downloads/individual_metadata/` (106+ structured metadata entries for full interview corpus)
- **Frontend Location:** `/Users/georgepickett/podcast-analysis/` (Next.js app)

---

## Goals
- Teach users how RAG and embeddings work through an interactive interface.
- Demonstrate transparency in AI reasoning.
- Showcase query classification, vector retrieval, and synthesis visually.

---

## Core UI Flow
1. **Header Explanation**
   - A short summary of what this app does.
   - Tagline: “See how AI retrieves and reasons about 100 Sam Altman interviews.”

2. **Search Interface**
   - Central search bar for freeform user input.
   - Below it: horizontally scrollable “question type pills” (e.g., Factual, Analytical, Meta, Exploratory, Comparative, Creative).
   - When a pill is selected, show example questions beneath it.
   - Clicking a suggested question autofills and triggers the query.

3. **Process Visualization**
   - Step 1: “Classifying question type…” → display classification result (type + confidence).
   - Step 2: “Retrieving chunks…” → visual changes depending on question type:
     - Factual → 3–5 snippet cards fade in.
     - Analytical → cluster animation with “summarizing multiple interviews.”
     - Meta → global corpus animation (no retrieval).
     - Exploratory → topic bubbles.
     - Comparative → timeline view.
   - Step 3: “Synthesizing answer…” → final answer card appears.

4. **Final Answer Display**
   - Show concise answer.
   - Optional tabs:
     - “Retrieved Chunks” — collapsible cards showing snippets + similarity scores.
     - “Reasoning Trace” — brief natural-language explanation of how the answer was derived.

---

## Frontend Tasks (High-Level TODOs)

### 🔹 Layout & Components
- [x] Create app shell with header, main content area, and footer.
- [x] Implement central search bar with submit + example input states.
- [x] Add pill component for question types (scrollable, selectable).
- [x] Create “suggested question” list component that updates by selected pill.
- [x] Build progress visualization section with animated stages:
  - Classification
  - Retrieval
  - Reasoning
- [x] Create animated visual variants per question type (e.g., cluster, timeline, bubbles).
- [x] Build “Final Answer” card component with expandable tabs for “chunks” and “reasoning trace.”

### 🔹 Data Flow & API Integration
- [x] Hook up `/classify` endpoint (fast LLM) to get question type + confidence.
- [x] Display classification result inline after API response.
- [x] Trigger `/search` endpoint with classification result.
- [x] Render retrieved chunks dynamically.
- [x] Trigger `/synthesize` endpoint for final answer.
- [x] Animate transitions between each phase (loading → reveal).

### 🔹 UX & Feedback
- [x] Add loading animations for each stage (“thinking”, “retrieving”, “summarizing”).
- [x] Display progress bar or step indicator (1. Classify → 2. Retrieve → 3. Synthesize).
- [x] Ensure clear, educational microcopy at each stage explaining what’s happening.
- [x] Add subtle visual feedback (spinners, glowing transitions, etc.).

### 🔹 Polish
- [x] Responsive design for desktop & mobile.
- [x] Consistent visual language (cards, spacing, typography).

### 🔹 Backend Tasks
- [ ] Verify `/classify` endpoint in n8n-local services returns question type + confidence
- [ ] Test `/search` endpoint integration with transcript corpus and metadata
- [ ] Validate `/synthesize` endpoint for final answer generation
- [ ] Ensure CORS configuration for frontend-backend communication
- [ ] Document API response schemas for frontend integration

---

## Tech Stack
- **Frontend:** `/Users/georgepickett/podcast-analysis/` - React (Next.js) + Tailwind CSS + Framer Motion
- **Backend:** `/Users/georgepickett/n8n-local/` - Docker services with API routes for `/classify`, `/search`, `/synthesize`
- **Data:** Transcript corpus + vector embeddings for RAG pipeline
- **Hosting:** Vercel or similar static hosting

---

## Deliverables
- [x] Functional interactive demo (classification → retrieval → synthesis)
- [x] Minimal yet elegant design showing AI reasoning process
- [ ] Example dataset loaded (100 Sam Altman interviews)
- [ ] Deployed web app ready to share as a portfolio project

---
