# Podcast Analysis UI

This Next.js app surfaces locally downloaded podcast episodes, their transcripts, and AI-driven speaker insights. All data is sourced from local FastAPI services (`download_youtube_audio`, `diarized_audio`) and metadata written to disk.

## Getting Started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to open the UI.

## Data Flow

1. **Episode Catalogue**  
   - `download_youtube_audio` stores per-video metadata under `download_youtube_audio/downloads`.  
   - `app/api/episodes` reads those JSON files, enriches them with transcript availability, and now includes any saved `insights` block.

2. **Transcript Retrieval**  
   - `Get Episode Insights` first calls `app/api/get-transcript`.  
   - That route validates the YouTube URL, locates cached metadata, and reads the transcript text from `diarized_audio/transcripts`.

3. **Insight Generation**  
   - The transcript is POSTed to the n8n webhook (`http://localhost:5678/webhook-test/...`).  
   - The workflow response is normalised into an `EpisodeInsights` object (comparison summary plus per-speaker scores).

4. **Persistence**  
   - After a successful workflow response, the UI POSTs to `app/api/episode-insights`.  
   - That endpoint writes the insights into the corresponding download metadata JSON (`insights` block).  
   - `_save_metadata` in `download_youtube_audio` preserves existing `insights` when other metadata updates occur.

5. **Subsequent Loads**  
   - When the app reloads episodes, stored insights are preloaded into state so the panel opens instantly without re-running the n8n workflow.

## Metadata Structure

Each file in `download_youtube_audio/downloads` now includes:

```json
{
  "id": "jrK3PsD3APk",
  "sanitized_title": "ai_what_could_go_wrong_with_geoffrey_hinton_the_weekly_show_with_jon_stewart",
  "...": "...",
  "insights": {
    "comparisonSummary": "Overall summary text...",
    "speakers": [
      {
        "name": "Jon Stewart",
        "summary": "One sentence profile...",
        "notes": null,
        "scores": {
          "techno_optimism": 6,
          "market_vs_state": 3,
          "individualism_vs_institutionalism": 3
        }
      }
    ]
  }
}
```

The UI expects integer scores between 0–10 and at least one speaker entry. The `insights` block is optional; episodes without it default to fetching from n8n when requested.
