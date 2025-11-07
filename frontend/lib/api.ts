import type { ClassificationResult, Chunk, QuestionTypeKey, SynthesisResult } from '../types';
import { mapChunk, normalizeQuestionType } from './utils';
import { API_BASE_URL } from './constants';

export async function classifyQuestion(query: string): Promise<ClassificationResult> {
  const response = await fetch(`${API_BASE_URL}/classify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Classification request failed.');
  }
  const data = await response.json();
  console.info('classify response', data);
  if (typeof data.type !== 'string' || typeof data.confidence !== 'number') {
    console.error('invalid classify payload', data);
    throw new Error('Invalid classify response.');
  }
  return {
    type: normalizeQuestionType(data.type),
    confidence: data.confidence,
  };
}

export async function retrieveChunks(query: string, type: QuestionTypeKey): Promise<Chunk[]> {
  const response = await fetch(`${API_BASE_URL}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, question_type: type }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Retrieval request failed.');
  }
  const data = await response.json();
  console.info('search response', data);
  if (!Array.isArray(data.chunks)) {
    console.error('invalid search payload', data);
    throw new Error('Invalid search response.');
  }
  return data.chunks.map((chunk: unknown) => mapChunk(chunk));
}

export async function synthesizeAnswer(query: string, type: QuestionTypeKey, chunks: Chunk[]): Promise<SynthesisResult> {
  const response = await fetch(`${API_BASE_URL}/synthesize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      question_type: type,
      chunk_ids: chunks.map((chunk) => chunk.id),
    }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Synthesis request failed.');
  }
  const data = await response.json();
  console.info('synthesize response', data);
  if (typeof data.answer !== 'string' || !Array.isArray(data.reasoning)) {
    console.error('invalid synthesize payload', data);
    throw new Error('Invalid synthesize response.');
  }
  if (!data.reasoning.every((item: unknown) => typeof item === 'string')) {
    console.error('invalid reasoning entries', data.reasoning);
    throw new Error('Invalid synthesize response.');
  }
  return {
    answer: data.answer,
    reasoning: data.reasoning,
  };
}

