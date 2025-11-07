
## Data Flow Overview

Here's how data flows through your podcast analysis application, starting from the YouTube URL input:

### 1. **User Input** (`/analyze` page)
- User enters YouTube URL in the Next.js React frontend
- Form submission posts to n8n webhook: `fa0dd22e-007e-4fc4-9314-e911a1fcd060`

### 2. **n8n Workflow Orchestration**
The n8n workflow (running on port 5678) coordinates the entire process:
- **Step 1**: Receives YouTube URL from frontend
- **Step 2**: Calls `download_youtube_audio` service (port 8014) to download audio
- **Step 3**: Calls `diarized_audio` service (port 8015) to transcribe with speaker diarization
- **Step 4**: Handles speaker name replacement via another webhook

### 3. **Audio Download** (`download_youtube_audio` service)
- Receives YouTube URL via POST to `/download`
- Uses `yt_dlp` to download best audio quality
- Saves audio file and metadata (title, filename, video ID) to `/app/downloads/`
- Returns audio file to n8n

### 4. **Audio Transcription & Diarization** (`diarized_audio` service)
- Receives uploaded audio file via POST to `/diarize`
- **Chunking**: Splits long audio into 5-minute segments for API limits
- **Transcription**: Calls OpenAI's `gpt-4o-transcribe-diarize` model with `diarized_json` format
- **Merging**: Combines chunked results chronologically
- **Speaker Labeling**: Posts raw transcript to n8n webhook `f81ec463-47de-4928-bbad-7de01bb11b42`
- **Name Replacement**: n8n returns real speaker names (e.g., "Speaker 1" → "Kevin Roose")
- Saves final transcript as `.txt` and detailed JSON to mounted volumes

### 5. **Transcript Retrieval** (`/get-transcript` API)
- Frontend calls this API with YouTube URL
- Extracts video ID and finds cached metadata from `download_youtube_audio/downloads/`
- Returns formatted transcript from `diarized_audio/transcripts/{slug}.txt`

### Key Integration Points:
- **n8n** acts as the central orchestrator and AI-powered speaker namer
- **Shared volumes** allow services to access each other's outputs
- **Caching** prevents re-processing of the same videos
- **Webhook-based** communication between services

The flow is: **URL Input → n8n → Download → Transcribe → Speaker Names → Display**