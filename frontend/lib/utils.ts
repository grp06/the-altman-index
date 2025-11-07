import type { Chunk, QuestionTypeKey } from '../types';

export function getChunkTitle(chunk: Chunk): string {
  const title = chunk.metadata.title?.trim();
  if (title) {
    return title;
  }
  const sourceName = chunk.metadata.source_name?.trim();
  if (sourceName) {
    return sourceName;
  }
  return chunk.id;
}

export function getChunkSource(chunk: Chunk): string {
  const url = chunk.metadata.youtube_url?.trim();
  if (url) {
    return url;
  }
  const sourceName = chunk.metadata.source_name?.trim();
  if (sourceName) {
    return sourceName;
  }
  const sourcePath = chunk.metadata.source_path?.trim();
  if (sourcePath) {
    return sourcePath;
  }
  return chunk.id;
}

export function mapChunk(raw: unknown): Chunk {
  if (typeof raw !== 'object' || raw === null) {
    console.error('invalid chunk record', raw);
    throw new Error('Invalid chunk in retrieval response.');
  }
  const candidate = raw as { id?: unknown; snippet?: unknown; score?: unknown; metadata?: unknown };
  if (typeof candidate.id !== 'string' || typeof candidate.snippet !== 'string' || typeof candidate.score !== 'number') {
    console.error('invalid chunk record', raw);
    throw new Error('Invalid chunk in retrieval response.');
  }
  if (typeof candidate.metadata !== 'object' || candidate.metadata === null) {
    console.error('chunk metadata missing', raw);
    throw new Error('Invalid chunk in retrieval response.');
  }
  const rawMetadata = candidate.metadata as Record<string, unknown>;
  const metadata = {
    title: typeof rawMetadata.title === 'string' ? rawMetadata.title : undefined,
    upload_date: typeof rawMetadata.upload_date === 'string' ? rawMetadata.upload_date : undefined,
    youtube_url: typeof rawMetadata.youtube_url === 'string' ? rawMetadata.youtube_url : undefined,
    source_path: typeof rawMetadata.source_path === 'string' ? rawMetadata.source_path : undefined,
    source_name: typeof rawMetadata.source_name === 'string' ? rawMetadata.source_name : undefined,
  };
  return {
    id: candidate.id,
    snippet: candidate.snippet,
    score: candidate.score,
    metadata,
  };
}

export function isQuestionTypeKey(value: string): value is QuestionTypeKey {
  return ['factual', 'analytical', 'meta', 'exploratory', 'comparative', 'creative'].includes(value);
}

export function normalizeQuestionType(value: string): QuestionTypeKey {
  const lowered = value.toLowerCase();
  if (isQuestionTypeKey(lowered)) {
    return lowered;
  }
  throw new Error(`Unsupported question type: ${value}`);
}

export function formatUploadDate(value?: string): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  if (/^\d{8}$/.test(trimmed)) {
    year = Number(trimmed.slice(0, 4));
    month = Number(trimmed.slice(4, 6));
    day = Number(trimmed.slice(6, 8));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parts = trimmed.split('-').map((part) => Number(part));
    [year, month, day] = parts;
  }
  if (!year || !month || !day) {
    return trimmed;
  }
  const iso = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

