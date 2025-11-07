'use client';

import { useMemo, useState } from 'react';
import styles from './page.module.css';

type Stage = 'idle' | 'classifying' | 'retrieving' | 'synthesizing' | 'complete' | 'error';

type QuestionTypeKey = 'factual' | 'analytical' | 'meta' | 'exploratory' | 'comparative' | 'creative';

type ClassificationResult = {
  type: QuestionTypeKey;
  confidence: number;
};

type ChunkMetadata = {
  title?: string;
  upload_date?: string;
  youtube_url?: string;
  source_path?: string;
  source_name?: string;
};

type Chunk = {
  id: string;
  snippet: string;
  score: number;
  metadata: ChunkMetadata;
};

type SynthesisResult = {
  answer: string;
  reasoning: string[];
};

type StepStatus = 'pending' | 'active' | 'done' | 'error';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8018';

const QUESTION_TYPES: Record<
  QuestionTypeKey,
  {
    label: string;
    description: string;
    suggestions: string[];
    visualHeadline: string;
  }
> = {
  factual: {
    label: 'Factual',
    description: 'Direct answers grounded in specific interview excerpts.',
    suggestions: [
      'What did Sam Altman say about regulating AI?',
      'How does Sam Altman define OpenAI’s mission?',
      'Which interview covers Altman’s thoughts on alignment?',
    ],
    visualHeadline: 'Top matching snippets',
  },
  analytical: {
    label: 'Analytical',
    description: 'Multi-source synthesis to evaluate themes and patterns.',
    suggestions: [
      'How has Sam Altman’s stance on AGI safety evolved?',
      'What patterns appear in how Altman hires leaders?',
      'How does Altman compare startups to moonshots?',
    ],
    visualHeadline: 'Clustered perspectives',
  },
  meta: {
    label: 'Meta',
    description: 'Corpus-wide reflections without direct retrieval.',
    suggestions: [
      'How transparent are these interviews overall?',
      'What topics seem underrepresented across the corpus?',
      'Where might Altman’s views still be ambiguous?',
    ],
    visualHeadline: 'Global corpus overview',
  },
  exploratory: {
    label: 'Exploratory',
    description: 'Surface adjacent themes and emerging directions.',
    suggestions: [
      'What unexpected topics does Sam Altman mention?',
      'Which interviews explore Altman’s personal routines?',
      'Where does Altman discuss the future of education?',
    ],
    visualHeadline: 'Topic bubbles',
  },
  comparative: {
    label: 'Comparative',
    description: 'Contrast interviews across time or context.',
    suggestions: [
      'How did Altman’s opinion on crypto change between 2019 and 2023?',
      'Which interviews juxtapose Altman’s views on AI risk and growth?',
      'Where does Altman contrast OpenAI with other labs?',
    ],
    visualHeadline: 'Timeline alignment',
  },
  creative: {
    label: 'Creative',
    description: 'Inventive prompts that remix the corpus into new artifacts.',
    suggestions: [
      'Draft a commencement speech using Altman’s advice.',
      'Write a startup manifesto inspired by Altman’s interviews.',
      'Imagine Altman briefing policymakers on AI regulation.',
    ],
    visualHeadline: 'Creative synthesis workspace',
  },
};

const PROCESS_STEPS: { stage: Stage; title: string; subtitle: string }[] = [
  {
    stage: 'classifying',
    title: 'Classify intent',
    subtitle: 'Infer the question’s purpose and tone.',
  },
  {
    stage: 'retrieving',
    title: 'Retrieve evidence',
    subtitle: 'Select relevant interview passages.',
  },
  {
    stage: 'synthesizing',
    title: 'Synthesize answer',
    subtitle: 'Compose an answer with provenance.',
  },
];

const stageIndexMap: Record<Stage, number> = {
  idle: -1,
  classifying: 0,
  retrieving: 1,
  synthesizing: 2,
  complete: 3,
  error: 3,
};

function getChunkTitle(chunk: Chunk): string {
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

function getChunkSource(chunk: Chunk): string {
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

function mapChunk(raw: unknown): Chunk {
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
  const metadata: ChunkMetadata = {
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

function isQuestionTypeKey(value: string): value is QuestionTypeKey {
  return ['factual', 'analytical', 'meta', 'exploratory', 'comparative', 'creative'].includes(value);
}

function normalizeQuestionType(value: string): QuestionTypeKey {
  const lowered = value.toLowerCase();
  if (isQuestionTypeKey(lowered)) {
    return lowered;
  }
  throw new Error(`Unsupported question type: ${value}`);
}

function formatUploadDate(value?: string): string | null {
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

async function classifyQuestion(query: string): Promise<ClassificationResult> {
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

async function retrieveChunks(query: string, type: QuestionTypeKey): Promise<Chunk[]> {
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

async function synthesizeAnswer(query: string, type: QuestionTypeKey, chunks: Chunk[]): Promise<SynthesisResult> {
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

export default function Home() {
  const [query, setQuery] = useState('');
  const [selectedType, setSelectedType] = useState<QuestionTypeKey>('factual');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'answer' | 'chunks' | 'trace'>('answer');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const suggestions = useMemo(() => QUESTION_TYPES[selectedType].suggestions, [selectedType]);

  const currentTypeForVisual = classification?.type ?? selectedType;

  const handleQuerySubmit = async (input: string) => {
    if (!input.trim()) {
      setErrorMessage('Enter a question to begin.');
      return;
    }
    console.info('submitting query', { query: input, selectedType });
    setIsSubmitting(true);
    setStage('classifying');
    setErrorMessage(null);
    setClassification(null);
    setChunks([]);
    setSynthesis(null);
    setActiveTab('answer');
    try {
      const classificationResult = await classifyQuestion(input);
      setClassification(classificationResult);
      setStage('retrieving');
      const retrievedChunks = await retrieveChunks(input, classificationResult.type);
      if (retrievedChunks.length === 0) {
        throw new Error('Retrieval returned no chunks.');
      }
      setChunks(retrievedChunks);
      setStage('synthesizing');
      const synthesisResult = await synthesizeAnswer(input, classificationResult.type, retrievedChunks);
      setSynthesis(synthesisResult);
      setStage('complete');
    } catch (error) {
      console.error('pipeline failure', error);
      setStage('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unexpected error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }
    await handleQuerySubmit(query);
  };

  const handleSuggestionClick = async (suggestion: string) => {
    if (isSubmitting) {
      return;
    }
    setQuery(suggestion);
    await handleQuerySubmit(suggestion);
  };

  const renderStepStatus = (stepStage: Stage): StepStatus => {
    const currentIndex = stageIndexMap[stage];
    const stepIndex = stageIndexMap[stepStage];
    if (stage === 'error' && currentIndex === stepIndex) {
      return 'error';
    }
    if (currentIndex > stepIndex) {
      return 'done';
    }
    if (currentIndex === stepIndex) {
      return 'active';
    }
    return 'pending';
  };

  const classificationReady = stageIndexMap[stage] > stageIndexMap.classifying && classification;
  const retrievalReady = stageIndexMap[stage] > stageIndexMap.retrieving && chunks.length > 0;
  const synthesisReady = stageIndexMap[stage] > stageIndexMap.synthesizing && synthesis;

  const renderRetrievalVisual = () => {
    if (stage === 'idle') {
      return <div className={styles.placeholderText}>The retrieval canvas activates once a question is running.</div>;
    }
    if (stage === 'classifying') {
      return (
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Waiting for classification before retrieval begins.</span>
        </div>
      );
    }
    if (stage === 'retrieving' && !retrievalReady) {
      return (
        <div className={styles.loadingRow}>
          <div className={styles.spinner} />
          <span>Retrieving high-confidence chunks.</span>
        </div>
      );
    }
    if (stage === 'error' && !retrievalReady) {
      return <div className={styles.placeholderText}>Retrieval failed.</div>;
    }
    if (!retrievalReady) {
      return <div className={styles.placeholderText}>Retrieval output will appear once chunks are available.</div>;
    }
    return (
      <div className={styles.retrievalScroller}>
        {chunks.map((chunk) => {
          const formattedDate = formatUploadDate(chunk.metadata.upload_date);
          const badges = formattedDate ? [formattedDate] : [];
          const youtubeUrl = chunk.metadata.youtube_url?.trim();
          return (
            <article key={chunk.id} className={styles.retrievalCard}>
              <div className={styles.retrievalHeader}>
                <div className={styles.retrievalTitle}>{getChunkTitle(chunk)}</div>
                <div className={styles.retrievalScore}>{(chunk.score * 100).toFixed(1)}%</div>
              </div>
              {badges.length > 0 && (
                <div className={styles.retrievalMeta}>
                  {badges.map((badge) => (
                    <span key={`${chunk.id}-${badge}`} className={styles.retrievalMetaBadge}>
                      {badge}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.retrievalSnippet}>{chunk.snippet}</div>
              {youtubeUrl && (
                <a href={youtubeUrl} target="_blank" rel="noreferrer" className={styles.retrievalLink}>
                  Open interview
                </a>
              )}
            </article>
          );
        })}
      </div>
    );
  };

  return (
    <main className={styles.main}>
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>
          <p className={styles.kicker}>Sam Altman Interview Explorer</p>
          <h1 className={styles.title}>See how AI retrieves and reasons about 100 interviews.</h1>
          <p className={styles.subtitle}>
            Ask a question, follow the pipeline from intent classification to chunk retrieval, and study the final synthesis with full context.
          </p>
        </div>
        <div className={styles.heroBadge}>Transparent RAG Pipeline</div>
      </section>
      <section className={styles.searchSection}>
        <div className={styles.searchCard}>
          <form className={styles.searchForm} onSubmit={handleSubmit}>
            <input
              className={styles.searchInput}
              placeholder="Ask anything across the Sam Altman interview corpus..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isSubmitting}
            />
            <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Running' : 'Run analysis'}
            </button>
          </form>
          {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
          <div className={styles.pillRow}>
            {(Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).map((typeKey) => (
              <button
                key={typeKey}
                type="button"
                className={`${styles.pillButton} ${selectedType === typeKey ? styles.pillActive : ''}`}
                onClick={() => setSelectedType(typeKey)}
                disabled={isSubmitting}
              >
                {QUESTION_TYPES[typeKey].label}
              </button>
            ))}
          </div>
          <div className={styles.pillDescription}>{QUESTION_TYPES[selectedType].description}</div>
          <div className={styles.suggestions}>
            <div className={styles.suggestionsHeader}>Example questions</div>
            <div className={styles.suggestionList}>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.suggestionButton}
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={isSubmitting}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className={styles.processSection}>
        <div className={styles.processHeader}>
          <div className={styles.processTitle}>Follow the reasoning pipeline</div>
          <div className={styles.processCaption}>Each stage updates once the backend reports progress.</div>
        </div>
        <div className={styles.stepper}>
          {PROCESS_STEPS.map((step, index) => {
            const status = renderStepStatus(step.stage);
            return (
              <div
                key={step.stage}
                className={`${styles.step} ${status === 'done' ? styles.stepDone : ''} ${status === 'active' ? styles.stepActive : ''} ${
                  status === 'error' ? styles.stepError : ''
                }`}
              >
                <div className={styles.stepIndicator}>
                  <span>{index + 1}</span>
                </div>
                <div>
                  <div className={styles.stepTitle}>{step.title}</div>
                  <div className={styles.stepSubtitle}>{step.subtitle}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.processGrid}>
          <div className={styles.processCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>Classification</div>
              <div className={styles.cardHeadline}>{classification ? QUESTION_TYPES[classification.type].label : 'Pending'}</div>
            </div>
            <div className={styles.cardBody}>
              {stage === 'idle' && <div className={styles.placeholderText}>Submit a question to trigger classification.</div>}
              {stage === 'classifying' && (
                <div className={styles.loadingRow}>
                  <div className={styles.spinner} />
                  <span>Classifying question intent.</span>
                </div>
              )}
              {classificationReady && classification && (
                <div className={styles.classificationSummary}>
                  <div className={styles.classificationType}>{QUESTION_TYPES[classification.type].label}</div>
                  <div className={styles.confidenceMeter}>
                    <div className={styles.confidenceTrack}>
                      <div className={styles.confidenceFill} style={{ width: `${Math.round(classification.confidence * 100)}%` }} />
                    </div>
                    <span>{Math.round(classification.confidence * 100)}% confidence</span>
                  </div>
                  <p className={styles.classificationDescription}>{QUESTION_TYPES[classification.type].description}</p>
                </div>
              )}
              {stage === 'error' && !classificationReady && <div className={styles.placeholderText}>Classification failed.</div>}
            </div>
          </div>
          <div className={styles.processCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>Retrieval</div>
              <div className={styles.cardHeadline}>{QUESTION_TYPES[currentTypeForVisual].visualHeadline}</div>
            </div>
            <div className={styles.cardBody}>{renderRetrievalVisual()}</div>
          </div>
          <div className={styles.processCard}>
            <div className={styles.cardHeader}>
              <div className={styles.cardTitle}>Synthesis</div>
              <div className={styles.cardHeadline}>{synthesisReady && synthesis ? 'Answer complete' : 'Awaiting output'}</div>
            </div>
            <div className={styles.cardBody}>
              {stage === 'idle' && <div className={styles.placeholderText}>The synthesis card unlocks after retrieval.</div>}
              {stage === 'synthesizing' && (
                <div className={styles.loadingRow}>
                  <div className={styles.spinner} />
                  <span>Synthesizing final answer with reasoning trace.</span>
                </div>
              )}
              {synthesisReady && synthesis && (
                <div className={styles.synthesisPreview}>
                  <div className={styles.answerPreview}>{synthesis.answer}</div>
                  <ul className={styles.reasoningPreview}>
                    {synthesis.reasoning.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage === 'error' && !synthesisReady && <div className={styles.placeholderText}>Synthesis failed.</div>}
            </div>
          </div>
        </div>
        {stage === 'error' && errorMessage && <div className={styles.errorPanel}>{errorMessage}</div>}
      </section>
      {stage === 'complete' && synthesis && (
        <section className={styles.answerSection}>
          <div className={styles.answerHeader}>
            <h2 className={styles.answerTitle}>Final answer</h2>
            {classification && (
              <div className={styles.answerMeta}>
                <span>{QUESTION_TYPES[classification.type].label}</span>
                <span>Confidence {Math.round(classification.confidence * 100)}%</span>
              </div>
            )}
          </div>
          <div className={styles.tabList}>
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'answer' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('answer')}
            >
              Answer
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'chunks' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('chunks')}
            >
              Retrieved chunks
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'trace' ? styles.tabActive : ''}`}
              onClick={() => setActiveTab('trace')}
            >
              Reasoning trace
            </button>
          </div>
          <div className={styles.tabPanel}>
            {activeTab === 'answer' && <div className={styles.fullAnswer}>{synthesis.answer}</div>}
            {activeTab === 'chunks' && (
              <div className={styles.chunkList}>
                {chunks.length === 0 && <div className={styles.placeholderText}>No chunks were required for this answer.</div>}
                {chunks.map((chunk) => (
                  <div key={chunk.id} className={styles.chunkCard}>
                    <div className={styles.chunkHeader}>
                      <div className={styles.chunkTitle}>{getChunkTitle(chunk)}</div>
                      <div className={styles.chunkScore}>{(chunk.score * 100).toFixed(1)}%</div>
                    </div>
                    <p className={styles.chunkSnippet}>{chunk.snippet}</p>
                    <div className={styles.chunkSource}>{getChunkSource(chunk)}</div>
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'trace' && (
              <ol className={styles.traceList}>
                {synthesis.reasoning.map((step, index) => (
                  <li key={`${step}-${index}`} className={styles.traceItem}>
                    {step}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}
      <footer className={styles.footer}>
        <span>Built for transparent AI exploration.</span>
        <span>Sam Altman Interview Explorer</span>
      </footer>
    </main>
  );
}
