'use client';

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styles from './page.module.css';
import {
  Chunk,
  RetrievalMetadata,
  SearchResult,
  buildIntentGroups,
  buildSentimentGroups,
  formatVectorSourceLabel,
  getVectorSourceExplanation,
  mapChunk,
} from './lib/retrieval';
import { trackQuestionSubmitted } from './lib/analytics';

type Stage = 'idle' | 'classifying' | 'retrieving' | 'synthesizing' | 'complete' | 'error';
type CoreStage = 'classifying' | 'retrieving' | 'synthesizing';

type QuestionTypeKey = 'auto' | 'factual' | 'analytical' | 'meta' | 'exploratory' | 'comparative' | 'creative';

type ClassificationResult = {
  type: Exclude<QuestionTypeKey, 'auto'>;
  confidence: number;
};

type SynthesisResult = {
  answer: string;
  reasoning: string[];
};

type StepStatus = 'pending' | 'active' | 'done' | 'error';

type RetrievalView = 'list' | 'intents' | 'sentiment';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8018';

const QUESTION_TYPES: Record<
  QuestionTypeKey,
  {
    label: string;
    description: string;
    suggestions: string[];
    visualHeadline: string;
    icon: string;
  }
> = {
  auto: {
    label: 'Auto',
    description: "We'll classify intent after you ask.",
    suggestions: [],
    visualHeadline: 'Auto-classified',
    icon: '✨',
  },
  factual: {
    label: 'Factual',
    description: 'Direct answers grounded in specific interview excerpts.',
    icon: '📌',
    suggestions: [
      'Has Altman ever addressed criticisms about OpenAI\'s commercialization?',
      'What\'s the most apocalyptic prediction Altman has made about AGI timelines?',
      'Has Altman ever criticized Elon Musk by name in an interview?',
      'What does Altman say about whether AGI will cause mass unemployment?',
      'Did Altman ever acknowledge specific mistakes or failures at OpenAI?',
      'What\'s the highest probability Altman has given for AI causing human extinction?',
    ],
    visualHeadline: 'Top matching snippets',
  },
  analytical: {
    label: 'Analytical',
    description: 'Multi-source synthesis to evaluate themes and patterns.',
    icon: '🧠',
    suggestions: [
      'Does Altman sound more like a techno-optimist or a doomer when discussing AGI risks?',
      'How often does Altman dodge questions about OpenAI\'s Microsoft partnership?',
      'What contradictions exist between Altman\'s libertarian past and current regulatory advocacy?',
      'How has Altman\'s rhetoric about "democratizing AI" changed as OpenAI became less accessible?',
      'Does Altman show more concern for AI safety or beating competitors to AGI?',
      'What patterns emerge in how Altman responds to criticism from former OpenAI employees?',
    ],
    visualHeadline: 'Clustered perspectives',
  },
  meta: {
    label: 'Meta',
    description: 'Corpus-wide reflections without direct retrieval.',
    icon: '🧩',
    suggestions: [
      'Which controversial topics does Altman consistently avoid across all interviews?',
      'Do interviewers ever successfully challenge Altman\'s narratives, or do they softball him?',
      'Is there a pattern of Altman revising his public stance after negative press?',
      'How often does Altman give vague non-answers compared to concrete commitments?',
      'Are there questions that make Altman visibly uncomfortable or defensive?',
      'Does the corpus reveal a consistent worldview or someone who adapts to their audience?',
    ],
    visualHeadline: 'Global corpus overview',
  },
  exploratory: {
    label: 'Exploratory',
    description: 'Surface adjacent themes and emerging directions.',
    icon: '🔭',
    suggestions: [
      'Has Altman ever discussed psychedelics, effective altruism, or life extension?',
      'What does Altman say about his firing and dramatic reinstatement at OpenAI?',
      'Where does Altman reveal his most unguarded opinions about competitors like Anthropic?',
      'Does Altman ever talk about his personal wealth, equity stakes, or financial motivations?',
      'What are Altman\'s most controversial takes on politics, government, or democracy?',
      'Has Altman discussed scenarios where AGI development should be halted or slowed?',
    ],
    visualHeadline: 'Topic bubbles',
  },
  comparative: {
    label: 'Comparative',
    description: 'Contrast interviews across time or context.',
    icon: '⚖️',
    suggestions: [
      'When did Altman stop saying "open" AI should actually be open?',
      'How has Altman\'s tone toward AI regulation shifted as OpenAI gained more market power?',
      'Compare Altman in 2017 versus 2023: idealist founder or corporate executive?',
      'How did Altman\'s AGI timeline predictions change before and after ChatGPT\'s success?',
      'Compare how Altman talks about safety when speaking to AI researchers versus journalists.',
      'Track the evolution: when did "AGI for humanity" become "AGI for profit"?',
    ],
    visualHeadline: 'Timeline alignment',
  },
  creative: {
    label: 'Creative',
    description: 'Inventive prompts that remix the corpus into new artifacts.',
    icon: '✍️',
    suggestions: [
      'Write a scathing investigative exposé using only Altman\'s own contradictory quotes.',
      'Create a debate between 2017 Sam and 2024 Sam about OpenAI\'s direction.',
      'Generate a satirical press release announcing "ClosedAI" using Altman\'s actual rhetoric.',
      'Draft an open letter from Altman to his critics addressing their most damning accusations.',
      'Imagine Altman\'s private pitch deck to venture capitalists versus his public mission statements.',
      'Create a "greatest hits" compilation of Altman\'s most cringe-worthy predictions and pivots.',
    ],
    visualHeadline: 'Creative synthesis workspace',
  },
};

const PROCESS_STEPS: { stage: CoreStage; title: string; subtitle: string }[] = [
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

function isQuestionTypeKey(value: string): value is QuestionTypeKey {
  return ['auto', 'factual', 'analytical', 'meta', 'exploratory', 'comparative', 'creative'].includes(value);
}

function normalizeQuestionType(value: string): Exclude<QuestionTypeKey, 'auto'> {
  const lowered = value.toLowerCase();
  if (isQuestionTypeKey(lowered) && lowered !== 'auto') {
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

async function retrieveChunks(query: string, type: Exclude<QuestionTypeKey, 'auto'>): Promise<SearchResult> {
  const payload: Record<string, unknown> = {
    query,
    question_type: type,
  };
  const response = await fetch(`${API_BASE_URL}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
  if (typeof data.retrieval_mode !== 'string' || typeof data.aggregated_count !== 'number') {
    console.error('missing retrieval metadata', data);
    throw new Error('Invalid search response.');
  }
  if (!Array.isArray(data.collections_used)) {
    console.error('invalid collection usage payload', data.collections_used);
    throw new Error('Invalid search response.');
  }
  const collections = data.collections_used.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) {
      console.error('invalid collection entry', entry);
      throw new Error('Invalid search response.');
    }
    const usage = entry as { source?: unknown; name?: unknown; requested?: unknown; returned?: unknown };
    if (typeof usage.source !== 'string' || typeof usage.name !== 'string' || typeof usage.requested !== 'number' || typeof usage.returned !== 'number') {
      console.error('invalid collection usage entry', entry);
      throw new Error('Invalid search response.');
    }
    return usage;
  });
  return {
    chunks: data.chunks.map((chunk: unknown) => mapChunk(chunk)),
    meta: {
      mode: data.retrieval_mode,
      aggregatedCount: data.aggregated_count,
      collections,
    },
  };
}

async function synthesizeAnswer(query: string, type: Exclude<QuestionTypeKey, 'auto'>, chunks: Chunk[]): Promise<SynthesisResult> {
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
  const [selectedType, setSelectedType] = useState<QuestionTypeKey>('auto');
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [retrievalMeta, setRetrievalMeta] = useState<RetrievalMetadata | null>(null);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [synthesisTab, setSynthesisTab] = useState<'answer' | 'chunks' | 'trace'>('answer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retrievalView, setRetrievalView] = useState<RetrievalView>('list');
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});
  const [showCollectionDetails, setShowCollectionDetails] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showExamplesSheet, setShowExamplesSheet] = useState(false);
  const [recentQueries, setRecentQueries] = useState<string[]>([]);

  const activeType = selectedType === 'auto' ? (classification?.type ?? 'auto') : selectedType;
  const suggestions = useMemo(() => {
    if (selectedType === 'auto') {
      return activeType !== 'auto' ? QUESTION_TYPES[activeType].suggestions.slice(0, 6) : [];
    }
    return QUESTION_TYPES[selectedType].suggestions;
  }, [selectedType, activeType]);

  const currentTypeForVisual = classification?.type ?? (selectedType === 'auto' ? 'factual' : selectedType);

  const handleQuerySubmit = async (input: string) => {
    // Track the question submission
    trackQuestionSubmitted(input, selectedType);

    if (!input.trim()) {
      setErrorMessage('Enter a question to begin.');
      return;
    }
    setRecentQueries((prev) => {
      const updated = [input, ...prev.filter((q) => q !== input)].slice(0, 2);
      return updated;
    });
    console.info('submitting query', { query: input, selectedType });
    setIsSubmitting(true);
    setStage('classifying');
    setErrorMessage(null);
    setClassification(null);
    setChunks([]);
    setRetrievalMeta(null);
    setSynthesis(null);
    setSynthesisTab('answer');
    setRetrievalView('list');
    setExpandedChunks({});
    setShowCollectionDetails(false);
    try {
      const classificationResult = await classifyQuestion(input);
      setClassification(classificationResult);
      setStage('retrieving');
      const retrievalResult = await retrieveChunks(input, classificationResult.type);
      if (retrievalResult.chunks.length === 0) {
        throw new Error('Retrieval returned no chunks.');
      }
      setChunks(retrievalResult.chunks);
      setRetrievalMeta(retrievalResult.meta);
      setStage('synthesizing');
      const synthesisResult = await synthesizeAnswer(input, classificationResult.type, retrievalResult.chunks);
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

  const handleSuggestionInsert = (suggestion: string) => {
    setQuery(suggestion);
    if (selectedType === 'auto' && activeType !== 'auto') {
      setSelectedType(activeType);
    }
    setShowExamplesSheet(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSubmitting && query.trim()) {
        handleQuerySubmit(query);
      }
    }
  };

  const toggleChunkExpansion = (chunkId: string) => {
    setExpandedChunks((previous) => ({
      ...previous,
      [chunkId]: !previous[chunkId],
    }));
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
  const retrievalReady = stageIndexMap[stage] > stageIndexMap.retrieving && chunks.length > 0 && !!retrievalMeta;
  const synthesisReady = stageIndexMap[stage] > stageIndexMap.synthesizing && synthesis;

  const renderRetrievalVisual = () => {
    if (stage === 'idle') {
      return <div className={styles.placeholderText}>The retrieval canvas activates once a question is running.</div>;
    }
    if (stage === 'classifying') {
      return <div className={styles.placeholderText}>Waiting for classification to complete...</div>;
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
    if (!retrievalReady || !retrievalMeta) {
      return <div className={styles.placeholderText}>Retrieval output will appear once chunks are available.</div>;
    }
    const intentGroups = buildIntentGroups(chunks);
    const sentimentGroups = buildSentimentGroups(chunks);
    const hasIntentData = intentGroups.length > 0;
    const hasSentimentData = sentimentGroups.length > 0;
    const viewOptions: { key: RetrievalView; label: string; enabled: boolean }[] = [
      { key: 'list' as RetrievalView, label: 'Ranked list', enabled: true },
      { key: 'intents' as RetrievalView, label: 'Intent clusters', enabled: hasIntentData },
      { key: 'sentiment' as RetrievalView, label: 'Sentiment bands', enabled: hasSentimentData },
    ].filter((option) => option.enabled);
    const availableKeys = viewOptions.map((option) => option.key);
    const activeView = availableKeys.includes(retrievalView) ? retrievalView : 'list';
    const normalizedMode = retrievalMeta.mode.trim() || 'Mode';
    const modeLabel = `${normalizedMode.charAt(0).toUpperCase()}${normalizedMode.slice(1)} retrieval`;
    const totalReturned = retrievalMeta.collections.reduce((sum, col) => sum + col.returned, 0);
    const renderListView = () => (
      <div className={styles.retrievalScroller}>
        {chunks.map((chunk) => {
          const formattedDate = formatUploadDate(chunk.metadata.upload_date);
          const youtubeUrl = chunk.metadata.youtube_url?.trim();
          const isExpanded = !!expandedChunks[chunk.id];
          const hasDetails = chunk.chunkIntents.length > 0 || chunk.chunkClaims.length > 0;
          const showToggle =
            hasDetails ||
            (chunk.chunkSummary ? chunk.chunkSummary.length > 160 : false) ||
            (chunk.snippet ? chunk.snippet.length > 220 : false);
          return (
            <article key={chunk.id} className={styles.retrievalCard}>
              <div className={styles.retrievalHeader}>
                <div>
                  <div className={styles.retrievalTitle}>{getChunkTitle(chunk)}</div>
                  <div className={styles.vectorSourceTag}>{formatVectorSourceLabel(chunk.vectorSource)}</div>
                </div>
                <div className={styles.retrievalScore}>{(chunk.score * 100).toFixed(1)}%</div>
              </div>
              <div className={styles.retrievalMeta}>
                {formattedDate && <span className={styles.retrievalMetaBadge}>{formattedDate}</span>}
                {chunk.chunkSentiment && <span className={`${styles.retrievalMetaBadge} ${styles.sentimentBadge}`}>{chunk.chunkSentiment}</span>}
              </div>
              {chunk.chunkSummary && (
                <div className={`${styles.chunkSummary} ${isExpanded ? styles.expandableOpen : styles.collapsibleTwo}`}>{chunk.chunkSummary}</div>
              )}
              <div className={`${styles.retrievalSnippet} ${isExpanded ? styles.expandableOpen : styles.collapsibleFour}`}>{chunk.snippet}</div>
              {isExpanded && hasDetails && (
                <div className={styles.retrievalDetails}>
                  {chunk.chunkIntents.length > 0 && (
                    <div className={styles.intentChips}>
                      {chunk.chunkIntents.slice(0, 6).map((intent) => (
                        <span key={`${chunk.id}-${intent}`} className={styles.intentChip}>
                          {intent}
                        </span>
                      ))}
                    </div>
                  )}
                  {chunk.chunkClaims.length > 0 && (
                    <ul className={styles.claimList}>
                      {chunk.chunkClaims.slice(0, 3).map((claim) => (
                        <li key={`${chunk.id}-claim-${claim}`} className={styles.claimItem}>
                          {claim}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {(youtubeUrl || showToggle) && (
                <div className={styles.retrievalFooter}>
                  {youtubeUrl && (
                    <a href={youtubeUrl} target="_blank" rel="noreferrer" className={styles.retrievalLink}>
                      Open interview
                    </a>
                  )}
                  {showToggle && (
                    <button type="button" className={styles.expandToggle} onClick={() => toggleChunkExpansion(chunk.id)}>
                      {isExpanded ? 'Hide details' : 'Expand details'}
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    );
    const renderIntentClusters = () => {
      if (intentGroups.length === 0) {
        return <div className={styles.placeholderText}>No intent annotations available for this answer.</div>;
      }
      return (
        <div className={styles.clusterGrid}>
          {intentGroups.slice(0, 6).map((group) => (
            <div key={group.intent} className={styles.clusterCard}>
              <div className={styles.clusterTitle}>{group.intent}</div>
              <div className={styles.clusterCount}>{group.items.length} chunks</div>
              <ul className={styles.clusterItems}>
                {group.items.slice(0, 4).map((chunk) => (
                  <li key={`${group.intent}-${chunk.id}`} className={styles.clusterItem}>
                    {getChunkTitle(chunk)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    };
    const renderSentimentClusters = () => {
      if (sentimentGroups.length === 0) {
        return <div className={styles.placeholderText}>No sentiment annotations available.</div>;
      }
      return (
        <div className={styles.clusterGrid}>
          {sentimentGroups.map((group) => (
            <div key={group.sentiment} className={styles.clusterCard}>
              <div className={styles.clusterTitle}>{group.sentiment}</div>
              <div className={styles.clusterCount}>{group.items.length} chunks</div>
              <ul className={styles.clusterItems}>
                {group.items.slice(0, 4).map((chunk) => (
                  <li key={`${group.sentiment}-${chunk.id}`} className={styles.clusterItem}>
                    {getChunkTitle(chunk)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );
    };
    return (
      <div className={styles.retrievalPanel}>
        <div className={styles.retrievalMetaBar}>
          <div className={styles.retrievalModePill}>{modeLabel}</div>
          <div className={styles.retrievalMetaStats}>
            <span>{`${totalReturned} passages retrieved`}</span>
            {retrievalMeta.collections.length > 1 && (
              <button
                type="button"
                className={styles.collectionToggle}
                onClick={() => setShowCollectionDetails(!showCollectionDetails)}
              >
                {showCollectionDetails ? 'Hide sources' : `${retrievalMeta.collections.length} search strategies`}
              </button>
            )}
          </div>
        </div>
        {showCollectionDetails && retrievalMeta.collections.length > 0 && (
          <div className={styles.collectionDetails}>
            <div className={styles.collectionExplainer}>
              To improve accuracy, we search multiple ways—matching exact wording, thematic summaries, and communicative intent. Each strategy finds different relevant passages.
            </div>
            <div className={styles.collectionList}>
              {retrievalMeta.collections.map((collection) => (
                <div key={collection.source} className={styles.collectionItem}>
                  <div className={styles.collectionLabel}>
                    <strong>{formatVectorSourceLabel(collection.source)}</strong>
                    <span className={styles.collectionCount}>{collection.returned} found</span>
                  </div>
                  <div className={styles.collectionExplanation}>{getVectorSourceExplanation(collection.source)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {viewOptions.length > 1 && (
          <div className={styles.retrievalViews}>
            {viewOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`${styles.retrievalViewButton} ${activeView === option.key ? styles.retrievalViewActive : ''}`}
                onClick={() => setRetrievalView(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {activeView === 'list' && renderListView()}
        {activeView === 'intents' && renderIntentClusters()}
        {activeView === 'sentiment' && renderSentimentClusters()}
      </div>
    );
  };

  const renderProcessContent = (stepStage: CoreStage) => {
    if (stepStage === 'classifying') {
      const classificationHeadline = (() => {
        if (stage === 'error' && !classificationReady) {
          return 'Error';
        }
        if (stage === 'classifying') {
          return 'Running';
        }
        if (classificationReady && classification) {
          return 'Ready';
        }
        return '';
      })();

      return (
        <div className={styles.processCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Classification</div>
            <div className={styles.cardHeadline}>{classificationHeadline}</div>
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
                </div>
                <p className={styles.classificationDescription}>{QUESTION_TYPES[classification.type].description}</p>
              </div>
            )}
            {stage === 'error' && !classificationReady && <div className={styles.placeholderText}>Classification failed.</div>}
          </div>
        </div>
      );
    }

    if (stepStage === 'retrieving') {
      const retrievalHeadline = (() => {
        if (stage === 'error' && !retrievalReady) {
          return 'Error';
        }
        if (stage === 'retrieving') {
          return 'Running';
        }
        if (retrievalReady && retrievalMeta) {
          return QUESTION_TYPES[currentTypeForVisual].visualHeadline;
        }
        if (stage === 'classifying') {
          return 'Pending';
        }
        return '';
      })();

      return (
        <div className={styles.processCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Retrieval</div>
            <div className={styles.cardHeadline}>{retrievalHeadline}</div>
          </div>
          <div className={styles.cardBody}>{renderRetrievalVisual()}</div>
        </div>
      );
    }

    const synthesisHeadline = (() => {
      if (stage === 'error' && !synthesisReady) {
        return 'Error';
      }
      if (stage === 'synthesizing') {
        return 'Running';
      }
      if (synthesisReady && synthesis) {
        return 'Answer complete';
      }
      if (stage === 'classifying' || stage === 'retrieving') {
        return 'Pending';
      }
      return '';
    })();

    return (
      <div className={styles.processCard}>
        <div className={styles.cardHeader}>
          <div className={styles.cardTitle}>Synthesis</div>
          <div className={styles.cardHeadline}>{synthesisHeadline}</div>
        </div>
        <div className={styles.cardBody}>
          {stage === 'idle' && <div className={styles.placeholderText}>The synthesis card unlocks after retrieval.</div>}
          {(stage === 'classifying' || stage === 'retrieving') && (
            <div className={styles.placeholderText}>Waiting for previous steps to complete...</div>
          )}
          {stage === 'synthesizing' && (
            <div className={styles.loadingRow}>
              <div className={styles.spinner} />
              <span>Synthesizing final answer with source trace.</span>
            </div>
          )}
          {synthesisReady && synthesis && (
            <div className={styles.synthesisContent}>
              <div className={styles.tabList}>
                <button
                  type="button"
                  className={`${styles.tabButton} ${synthesisTab === 'answer' ? styles.tabActive : ''}`}
                  onClick={() => setSynthesisTab('answer')}
                >
                  Answer
                </button>
                <button
                  type="button"
                  className={`${styles.tabButton} ${synthesisTab === 'chunks' ? styles.tabActive : ''}`}
                  onClick={() => setSynthesisTab('chunks')}
                >
                  Retrieved chunks
                </button>
                <button
                  type="button"
                  className={`${styles.tabButton} ${synthesisTab === 'trace' ? styles.tabActive : ''}`}
                  onClick={() => setSynthesisTab('trace')}
                >
                  Source trace
                </button>
              </div>
              <div className={styles.tabPanel}>
                {synthesisTab === 'answer' && <div className={styles.fullAnswer}><ReactMarkdown>{synthesis.answer}</ReactMarkdown></div>}
                {synthesisTab === 'chunks' && (
                  <div className={styles.chunkList}>
                    {chunks.length === 0 && <div className={styles.placeholderText}>No chunks were required for this answer.</div>}
                    {chunks.map((chunk) => (
                      <div key={chunk.id} className={styles.chunkCard}>
                        <div className={styles.chunkHeader}>
                          <div>
                            <div className={styles.chunkTitle}>{getChunkTitle(chunk)}</div>
                            <div className={styles.vectorSourceTag}>{formatVectorSourceLabel(chunk.vectorSource)}</div>
                          </div>
                          <div className={styles.chunkScore}>{(chunk.score * 100).toFixed(1)}%</div>
                        </div>
                        {chunk.chunkSentiment && (
                          <div className={styles.chunkSourceRow}>
                            <span className={styles.sentimentBadge}>{chunk.chunkSentiment}</span>
                          </div>
                        )}
                        {chunk.chunkSummary && <p className={styles.chunkSummary}>{chunk.chunkSummary}</p>}
                        <p className={styles.chunkSnippet}>{chunk.snippet}</p>
                        {chunk.chunkIntents.length > 0 && (
                          <div className={styles.intentChips}>
                            {chunk.chunkIntents.slice(0, 4).map((intent) => (
                              <span key={`${chunk.id}-intent-${intent}`} className={styles.intentChip}>
                                {intent}
                              </span>
                            ))}
                          </div>
                        )}
                        {chunk.chunkClaims.length > 0 && (
                          <ul className={styles.claimList}>
                            {chunk.chunkClaims.slice(0, 3).map((claim) => (
                              <li key={`${chunk.id}-detail-${claim}`} className={styles.claimItem}>
                                {claim}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {synthesisTab === 'trace' && (
                  <ol className={styles.traceList}>
                    {synthesis.reasoning.map((step, index) => (
                      <li key={`${step}-${index}`} className={styles.traceItem}>
                        {step}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
          {stage === 'error' && !synthesisReady && <div className={styles.placeholderText}>Synthesis failed.</div>}
        </div>
      </div>
    );
  };

  const isIdle = stage === 'idle';
  const allTypeKeys = (Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).filter((key) => key !== 'auto' || isIdle);
  const displaySuggestions = isInputFocused && isIdle ? suggestions.slice(0, 3) : suggestions.slice(0, 6);

  return (
    <main className={styles.main}>
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>
          <h1 className={styles.title}>Search 100+ Sam Altman interviews.</h1>
          <p className={styles.subtitle}>Ask any question. See exactly how the AI retrieves and reasons about his ideas.</p>
        </div>
      </section>
      <section className={styles.searchSection}>
        <div className={styles.searchCard}>
          <form className={styles.searchForm} onSubmit={handleSubmit}>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>🔎</span>
              <input
                className={styles.searchInput}
                placeholder="Ask a question…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setTimeout(() => setIsInputFocused(false), 200)}
                onKeyDown={handleKeyDown}
                disabled={isSubmitting}
              />
              <button className={styles.submitButtonInline} type="submit" disabled={isSubmitting || !query.trim()}>
                {isSubmitting ? 'Running' : 'Analyze'}
              </button>
            </div>
            {!isInputFocused && (
              <div className={styles.inputHelper}>
                Enter ↵ to run • Shift+Enter for newline
              </div>
            )}
          </form>
          {errorMessage && <div className={styles.errorMessage}>{errorMessage}</div>}
          <div className={styles.pillRow}>
            {allTypeKeys.map((typeKey) => (
              <div key={typeKey} className={styles.pillWrapper}>
                <button
                  type="button"
                  className={`${styles.pillButton} ${selectedType === typeKey ? styles.pillActive : ''}`}
                  onClick={() => setSelectedType(typeKey)}
                  disabled={isSubmitting}
                  title={QUESTION_TYPES[typeKey].description}
                >
                  {QUESTION_TYPES[typeKey].icon && <span className={styles.pillIcon}>{QUESTION_TYPES[typeKey].icon}</span>}
                  {QUESTION_TYPES[typeKey].label}
                </button>
                {typeKey === 'auto' && (
                  <button
                    type="button"
                    className={styles.infoButton}
                    title={QUESTION_TYPES[typeKey].description}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    aria-label="Info"
                  >
                    ⓘ
                  </button>
                )}
              </div>
            ))}
          </div>
          {!isInputFocused && (
            <>
              {displaySuggestions.length > 0 && (
                <div className={styles.examplesSection}>
                  <div className={styles.examplesHeader}>
                    <span className={styles.examplesLabel}>Try these:</span>
                    {suggestions.length > 6 && (
                      <button
                        type="button"
                        className={styles.showMoreButton}
                        onClick={() => setShowExamplesSheet(true)}
                      >
                        Show more examples
                      </button>
                    )}
                  </div>
                  <div className={styles.examplesChips}>
                    {displaySuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className={styles.exampleChip}
                        onClick={() => handleSuggestionInsert(suggestion)}
                        disabled={isSubmitting}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {isIdle && (
                <div className={styles.emptyHint}>
                  We&apos;ll show sources & the pipeline after you run.
                </div>
              )}
            </>
          )}
          {isInputFocused && isIdle && (
            <div className={styles.focusSuggestions}>
              {displaySuggestions.length > 0 && (
                <div className={styles.focusExamples}>
                  {displaySuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className={styles.exampleChip}
                      onClick={() => handleSuggestionInsert(suggestion)}
                      disabled={isSubmitting}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
              {recentQueries.length > 0 && (
                <div className={styles.recentsSection}>
                  <span className={styles.recentsLabel}>Recents:</span>
                  {recentQueries.map((recent) => (
                    <button
                      key={recent}
                      type="button"
                      className={styles.exampleChip}
                      onClick={() => handleSuggestionInsert(recent)}
                      disabled={isSubmitting}
                    >
                      {recent}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      {showExamplesSheet && (
        <div className={styles.sheetOverlay} onClick={() => setShowExamplesSheet(false)}>
          <div className={styles.sheetContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>Examples & Templates</h2>
              <button
                type="button"
                className={styles.sheetClose}
                onClick={() => setShowExamplesSheet(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.sheetTabs}>
              {(Object.keys(QUESTION_TYPES) as QuestionTypeKey[]).filter((key) => key !== 'auto').map((typeKey) => (
                <button
                  key={typeKey}
                  type="button"
                  className={`${styles.sheetTab} ${selectedType === typeKey ? styles.sheetTabActive : ''}`}
                  onClick={() => setSelectedType(typeKey)}
                >
                  {QUESTION_TYPES[typeKey].icon} {QUESTION_TYPES[typeKey].label}
                </button>
              ))}
            </div>
            <div className={styles.sheetExamples}>
              {QUESTION_TYPES[selectedType === 'auto' ? 'factual' : selectedType].suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.sheetExampleChip}
                  onClick={() => handleSuggestionInsert(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <section className={styles.processSection}>
        <div className={styles.processHeader}>
          <div className={styles.processTitle}>Trace the retrieval workflow</div>
          <div className={styles.processCaption}>We surface every backend step so you can verify how the answer was assembled.</div>
        </div>
        <div className={styles.processStream}>
          {PROCESS_STEPS.map((step, index) => {
            const status = renderStepStatus(step.stage);
            return (
              <div key={step.stage} className={styles.processRow}>
                <div
                  className={`${styles.processMeta} ${status === 'done' ? styles.processMetaDone : ''} ${
                    status === 'active' ? styles.processMetaActive : ''
                  } ${status === 'error' ? styles.processMetaError : ''}`}
                >
                  <div className={styles.processMetaIndicator}>
                    <span>{index + 1}</span>
                  </div>
                  <div>
                    <div className={styles.processMetaTitle}>{step.title}</div>
                    <div className={styles.processMetaSubtitle}>{step.subtitle}</div>
                  </div>
                </div>
                <div className={styles.processContent}>{renderProcessContent(step.stage)}</div>
              </div>
            );
          })}
        </div>
        {stage === 'error' && errorMessage && <div className={styles.errorPanel}>{errorMessage}</div>}
      </section>
    </main>
  );
}
