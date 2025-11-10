# The Altman Index

A searchable knowledge base of 100+ Sam Altman interviews with transparent RAG retrieval. This Next.js app allows users to ask questions about Sam Altman's interviews and see exactly how the AI retrieves and reasons about his ideas.

## Getting Started

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` to open the UI.

## Google Analytics Tracking

The app includes Google Analytics tracking for question submissions. Questions asked are tracked as "question_submitted" events with the following parameters:
- **question_length**: Character count of the question
- **question_type**: Type of question (factual, analytical, meta, exploratory, comparative, creative, or auto)
- **question_preview**: First 100 characters of the question text

View your analytics data at [Google Analytics](https://analytics.google.com/) under Events > question_submitted.

## Social Media Sharing

The app is configured for optimal social media sharing with:

- **Open Graph tags** for Facebook, LinkedIn, and other platforms
- **Twitter Card tags** for Twitter/X sharing
- **Congress.jpg** as the sharing image for all pages
- **Custom metadata** for both the main page and about page

When you share links to your site on social media, the congress.jpg image will be displayed with appropriate titles and descriptions.

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
