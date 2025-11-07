# How to Try Out the RAG Backend

Your `rag_backend` is now running and ready to use! Here are several ways to try it out:

## 1. Quick Test with the Python Script

The easiest way to test all three endpoints at once:

```bash
cd /Users/georgepickett/n8n-local
python3 test_rag_backend.py "What does Sam Altman think about AI safety?"
```

Try different questions:
```bash
python3 test_rag_backend.py "What are Sam Altman's views on AGI?"
python3 test_rag_backend.py "How does Sam think about OpenAI's mission?"
python3 test_rag_backend.py "What did Sam say about Y Combinator?"
```

## 2. Test Individual Endpoints with cURL

### Check Health
```bash
curl http://localhost:8018/healthz | python3 -m json.tool
```

### Classify a Question
```bash
curl -X POST http://localhost:8018/classify \
  -H "Content-Type: application/json" \
  -d '{"query": "What does Sam Altman think about AI safety?"}' \
  | python3 -m json.tool
```

### Search for Relevant Chunks
```bash
curl -X POST http://localhost:8018/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What does Sam Altman think about AI safety?",
    "question_type": "factual",
    "top_k": 5
  }' | python3 -m json.tool
```

### Synthesize an Answer
```bash
curl -X POST http://localhost:8018/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What does Sam Altman think about AI safety?",
    "question_type": "factual",
    "chunk_ids": [
      "20240514_sam_altman_talks_gpt_4o_and_predicts_the_future_of_ai::chunk::5",
      "20230114_fireside_chat_sam_altman_ceo_of_openai_w_elad_gil::chunk::1"
    ]
  }' | python3 -m json.tool
```

## 3. Connect Your Next.js Frontend

Your frontend in `/Users/georgepickett/podcast-analysis` can now connect to the backend.

1. Create/update `.env.local` in the frontend directory:
```bash
cd /Users/georgepickett/podcast-analysis
echo "NEXT_PUBLIC_API_BASE_URL=http://localhost:8018" > .env.local
```

2. Start the frontend (in a new terminal):
```bash
cd /Users/georgepickett/podcast-analysis
npm run dev
```

3. Open http://localhost:3000 in your browser

## 4. Backend Management

### View Backend Logs
```bash
docker logs -f n8n-local-rag_backend-1
```

### Restart Backend
```bash
docker compose restart rag_backend
```

### Rebuild After Code Changes
```bash
docker compose build rag_backend && docker compose up rag_backend -d
```

### Stop Backend
```bash
docker compose stop rag_backend
```

## What the Backend Does

The backend implements a **3-phase RAG pipeline**:

1. **`/classify`** - Classifies your question into one of 6 types:
   - `factual` - Direct facts
   - `analytical` - Deeper analysis
   - `meta` - Questions about the interviews
   - `exploratory` - Broad exploration
   - `comparative` - Comparisons
   - `creative` - Hypothetical scenarios

2. **`/search`** - Finds the 5 most relevant chunks from 790 embedded transcript chunks across 106 Sam Altman interviews

3. **`/synthesize`** - Uses GPT-4o to generate an answer with reasoning based on the retrieved chunks

## Current Status

✅ Backend is running on `http://localhost:8018`  
✅ Loaded 790 chunks from 106 transcripts  
✅ All endpoints working with OpenAI Responses API  
✅ Ready to connect to your Next.js frontend  

## Troubleshooting

If you get errors:
- Make sure `OPENAI_API_KEY` is set in your `.env` file
- Check logs: `docker logs n8n-local-rag_backend-1`
- Restart: `docker compose restart rag_backend`

