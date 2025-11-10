'use client';

import { useMemo, useState } from 'react';
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

type Stage = 'idle' | 'classifying' | 'retrieving' | 'synthesizing' | 'complete' | 'error';
type CoreStage = 'classifying' | 'retrieving' | 'synthesizing';

type QuestionTypeKey = 'factual' | 'analytical' | 'meta' | 'exploratory' | 'comparative' | 'creative';

type ClassificationResult = {
  type: QuestionTypeKey;
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
  }
> = {
  factual: {
    label: 'Factual',
    description: 'Direct answers grounded in specific interview excerpts.',
    suggestions: [
      'Did Sam Altman ever admit OpenAI broke its original open-source promise?',
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

async function retrieveChunks(query: string, type: QuestionTypeKey): Promise<SearchResult> {
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
  const [retrievalMeta, setRetrievalMeta] = useState<RetrievalMetadata | null>(null);
  const [synthesis, setSynthesis] = useState<SynthesisResult | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [synthesisTab, setSynthesisTab] = useState<'answer' | 'chunks' | 'trace'>('answer');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retrievalView, setRetrievalView] = useState<RetrievalView>('list');
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});
  const [showCollectionDetails, setShowCollectionDetails] = useState(false);

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

  const handleSuggestionClick = async (suggestion: string) => {
    if (isSubmitting) {
      return;
    }
    setQuery(suggestion);
    await handleQuerySubmit(suggestion);
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
        return 'Pending';
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
      return (
        <div className={styles.processCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>Retrieval</div>
            <div className={styles.cardHeadline}>{QUESTION_TYPES[currentTypeForVisual].visualHeadline}</div>
          </div>
          <div className={styles.cardBody}>{renderRetrievalVisual()}</div>
        </div>
      );
    }

    return (
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
                {synthesisTab === 'answer' && <div className={styles.fullAnswer}>{synthesis.answer}</div>}
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

  return (
    <main className={styles.main}>
      <section className={styles.heroSection}>
        <div className={styles.heroContent}>
          <p className={styles.kicker}>Sam Altman Interview Explorer</p>
          <h1 className={styles.title}>Transparent answers from 100 Sam Altman interviews.</h1>
          <p className={styles.subtitle}>Classify intent, pull the right passages, and inspect the sourced synthesis in one view.</p>
        </div>
      </section>
      <section className={styles.searchSection}>
        <div className={styles.searchCard}>
          <form className={styles.searchForm} onSubmit={handleSubmit}>
            <input
              className={styles.searchInput}
              placeholder="Type any question or tap a starter from the tabs below..."
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
          <div className={styles.pillHint}>Presets only change the starter prompts below. Type anything; classification adapts after you submit.</div>
          <div className={styles.suggestions}>
            <div className={styles.suggestionsHeader}>Starter questions</div>
            <div className={styles.suggestionsSubhead}>
              {QUESTION_TYPES[selectedType].label} preset selected. Tap any suggestion to auto-fill, or ignore them and keep typing your own question.
            </div>
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
