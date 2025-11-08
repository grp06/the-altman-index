import { describe, expect, it } from 'vitest';

import {
  Chunk,
  buildDocsumGroups,
  buildIntentGroups,
  buildSentimentGroups,
  formatVectorSourceLabel,
  mapChunk,
} from './retrieval';

function createChunk(overrides: Partial<Chunk> = {}): Chunk {
  const metadata = {
    title: 'Sample',
    upload_date: '20230101',
    doc_id: 'doc-1',
    ...overrides.metadata,
  };
  return {
    id: 'chunk-id',
    snippet: 'snippet text',
    score: 0.5,
    metadata,
    chunkSummary: 'summary',
    chunkIntents: ['Roadmap'],
    chunkSentiment: 'optimistic',
    chunkClaims: ['claim'],
    vectorSource: 'primary',
    ...overrides,
    metadata,
  };
}

describe('retrieval helpers', () => {
  it('maps chunk payloads into strongly typed objects', () => {
    const chunk = mapChunk({
      id: 'chunk-10',
      snippet: 'Evidence text',
      score: 0.78,
      metadata: { title: 'Doc', upload_date: '20240202' },
      chunk_summary: 'Chunk summary',
      chunk_intents: ['Roadmap', 'Warning'],
      chunk_sentiment: 'cautious',
      chunk_claims: ['Claim one', 'Claim two'],
      vector_source: 'summary',
    });
    expect(chunk.id).toBe('chunk-10');
    expect(chunk.chunkIntents).toEqual(['Roadmap', 'Warning']);
    expect(chunk.chunkClaims).toHaveLength(2);
    expect(chunk.vectorSource).toBe('summary');
  });

  it('clusters chunks by shared intents', () => {
    const chunks = [
      createChunk({ id: 'a', chunkIntents: ['Roadmap', 'Warning'], score: 0.9 }),
      createChunk({ id: 'b', chunkIntents: ['Roadmap'], score: 0.6 }),
      createChunk({ id: 'c', chunkIntents: ['Anecdote'], score: 0.4 }),
    ];
    const groups = buildIntentGroups(chunks);
    expect(groups[0].intent).toBe('Roadmap');
    expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('groups only labeled sentiments', () => {
    const chunks = [
      createChunk({ id: 'a', chunkSentiment: 'optimistic' }),
      createChunk({ id: 'b', chunkSentiment: 'skeptical' }),
      createChunk({ id: 'c', chunkSentiment: null }),
    ];
    const groups = buildSentimentGroups(chunks);
    expect(groups).toHaveLength(2);
    expect(groups[0].items[0].id).toBe('a');
  });

  it('selects the highest scoring doc summary per doc id and sorts by recency', () => {
    const chunks = [
      createChunk({
        id: 'latest-high',
        vectorSource: 'docsum',
        score: 0.8,
        metadata: { doc_id: 'doc-a', upload_date: '20240202' },
        snippet: 'Summary A',
      }),
      createChunk({
        id: 'latest-low',
        vectorSource: 'docsum',
        score: 0.3,
        metadata: { doc_id: 'doc-a', upload_date: '20240202' },
      }),
      createChunk({
        id: 'older',
        vectorSource: 'docsum',
        score: 0.7,
        metadata: { doc_id: 'doc-b', upload_date: '20230101' },
      }),
      createChunk({ id: 'ignored', vectorSource: 'primary' }),
    ];
    const groups = buildDocsumGroups(chunks);
    expect(groups).toHaveLength(2);
    expect(groups[0].docId).toBe('doc-a');
    expect(groups[0].chunk.id).toBe('latest-high');
  });

  it('formats vector source labels for UI badges', () => {
    expect(formatVectorSourceLabel('docsum')).toBe('Document summary');
    expect(formatVectorSourceLabel('primary')).toBe('Semantic');
    expect(formatVectorSourceLabel('unknown')).toBe('unknown');
  });
});
