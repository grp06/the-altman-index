export type ChunkMetadata = {
  title?: string;
  upload_date?: string;
  youtube_url?: string;
  source_path?: string;
  source_name?: string;
  doc_id?: string;
  time_span?: string;
};

export type VectorSource = 'primary' | 'summary' | 'intents' | 'docsum';

export type Chunk = {
  id: string;
  snippet: string;
  score: number;
  metadata: ChunkMetadata;
  chunkSummary: string | null;
  chunkIntents: string[];
  chunkSentiment: string | null;
  chunkClaims: string[];
  vectorSource: VectorSource;
};

export type CollectionUsage = {
  source: string;
  name: string;
  requested: number;
  returned: number;
};

export type RetrievalMetadata = {
  mode: string;
  aggregatedCount: number;
  collections: CollectionUsage[];
};

export type SearchResult = {
  chunks: Chunk[];
  meta: RetrievalMetadata;
};

export type IntentGroup = {
  intent: string;
  items: Chunk[];
};

export type SentimentGroup = {
  sentiment: string;
  items: Chunk[];
};

export type DocsumGroup = {
  docId: string;
  chunk: Chunk;
};

export function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function formatVectorSourceLabel(value: string): string {
  const lowered = value.toLowerCase();
  switch (lowered) {
    case 'primary':
      return 'Direct quotes';
    case 'summary':
      return 'Topic summaries';
    case 'intents':
      return 'Intent matches';
    case 'docsum':
      return 'Interview context';
    default:
      return value;
  }
}

export function getVectorSourceExplanation(value: string): string {
  const lowered = value.toLowerCase();
  switch (lowered) {
    case 'primary':
      return 'Exact passages from interview transcripts';
    case 'summary':
      return 'Chunks selected by their thematic summary';
    case 'intents':
      return 'Passages matched by what Sam was trying to communicate';
    case 'docsum':
      return 'Relevant interviews identified by their overall topic';
    default:
      return '';
  }
}

export function mapChunk(raw: unknown): Chunk {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid chunk payload.');
  }
  const candidate = raw as {
    id?: unknown;
    snippet?: unknown;
    score?: unknown;
    metadata?: unknown;
    chunk_summary?: unknown;
    chunk_intents?: unknown;
    chunk_sentiment?: unknown;
    chunk_claims?: unknown;
    vector_source?: unknown;
  };
  if (typeof candidate.id !== 'string' || typeof candidate.snippet !== 'string' || typeof candidate.score !== 'number') {
    throw new Error('Invalid chunk payload.');
  }
  if (typeof candidate.metadata !== 'object' || candidate.metadata === null) {
    throw new Error('Chunk metadata missing.');
  }
  const rawMetadata = candidate.metadata as Record<string, unknown>;
  const metadata: ChunkMetadata = {
    title: typeof rawMetadata.title === 'string' ? rawMetadata.title : undefined,
    upload_date: typeof rawMetadata.upload_date === 'string' ? rawMetadata.upload_date : undefined,
    youtube_url: typeof rawMetadata.youtube_url === 'string' ? rawMetadata.youtube_url : undefined,
    source_path: typeof rawMetadata.source_path === 'string' ? rawMetadata.source_path : undefined,
    source_name: typeof rawMetadata.source_name === 'string' ? rawMetadata.source_name : undefined,
    doc_id: typeof rawMetadata.doc_id === 'string' ? rawMetadata.doc_id : undefined,
    time_span: typeof rawMetadata.time_span === 'string' ? rawMetadata.time_span : undefined,
  };
  const chunkSummary =
    typeof candidate.chunk_summary === 'string' && candidate.chunk_summary.trim() ? candidate.chunk_summary.trim() : null;
  const chunkIntents = sanitizeStringArray(candidate.chunk_intents);
  const chunkClaims = sanitizeStringArray(candidate.chunk_claims);
  const chunkSentiment =
    typeof candidate.chunk_sentiment === 'string' && candidate.chunk_sentiment.trim() ? candidate.chunk_sentiment.trim() : null;
  const vectorSourceRaw = typeof candidate.vector_source === 'string' ? candidate.vector_source.toLowerCase() : null;
  if (vectorSourceRaw !== 'primary' && vectorSourceRaw !== 'summary' && vectorSourceRaw !== 'intents' && vectorSourceRaw !== 'docsum') {
    throw new Error('Vector source missing.');
  }
  return {
    id: candidate.id,
    snippet: candidate.snippet,
    score: candidate.score,
    metadata,
    chunkSummary,
    chunkIntents,
    chunkSentiment,
    chunkClaims,
    vectorSource: vectorSourceRaw,
  };
}

export function buildIntentGroups(chunks: Chunk[]): IntentGroup[] {
  const map = new Map<string, Chunk[]>();
  chunks.forEach((chunk) => {
    chunk.chunkIntents.forEach((intent) => {
      if (!map.has(intent)) {
        map.set(intent, []);
      }
      map.get(intent)!.push(chunk);
    });
  });
  return Array.from(map.entries())
    .map(([intent, items]) => ({
      intent,
      items: items.slice().sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

export function buildSentimentGroups(chunks: Chunk[]): SentimentGroup[] {
  const map = new Map<string, Chunk[]>();
  chunks.forEach((chunk) => {
    if (!chunk.chunkSentiment) {
      return;
    }
    if (!map.has(chunk.chunkSentiment)) {
      map.set(chunk.chunkSentiment, []);
    }
    map.get(chunk.chunkSentiment)!.push(chunk);
  });
  return Array.from(map.entries())
    .map(([sentiment, items]) => ({
      sentiment,
      items: items.slice().sort((a, b) => b.score - a.score),
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

export function buildDocsumGroups(chunks: Chunk[]): DocsumGroup[] {
  const map = new Map<string, Chunk>();
  chunks
    .filter((chunk) => chunk.vectorSource === 'docsum')
    .forEach((chunk) => {
      const docId = chunk.metadata.doc_id ?? chunk.id;
      if (!map.has(docId) || chunk.score > map.get(docId)!.score) {
        map.set(docId, chunk);
      }
    });
  return Array.from(map.entries())
    .map(([docId, chunk]) => ({ docId, chunk }))
    .sort((a, b) => {
      const aDate = typeof a.chunk.metadata.upload_date === 'string' ? a.chunk.metadata.upload_date : '';
      const bDate = typeof b.chunk.metadata.upload_date === 'string' ? b.chunk.metadata.upload_date : '';
      return bDate.localeCompare(aDate);
    });
}
