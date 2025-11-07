import type { Chunk, ClassificationResult, QuestionTypeKey, Stage } from '../types';
import { QUESTION_TYPES, stageIndexMap } from '../lib/constants';
import { formatUploadDate, getChunkTitle } from '../lib/utils';
import styles from '../app/page.module.css';

type RetrievalCanvasProps = {
  stage: Stage;
  chunks: Chunk[];
  classification: ClassificationResult | null;
  selectedType: QuestionTypeKey;
};

export function RetrievalCanvas({ stage, chunks, classification, selectedType }: RetrievalCanvasProps) {
  const retrievalReady = stageIndexMap[stage] > stageIndexMap.retrieving && chunks.length > 0;
  const currentTypeForVisual = classification?.type ?? selectedType;

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
    <div className={styles.processCard}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>Retrieval</div>
        <div className={styles.cardHeadline}>{QUESTION_TYPES[currentTypeForVisual].visualHeadline}</div>
      </div>
      <div className={styles.cardBody}>{renderRetrievalVisual()}</div>
    </div>
  );
}

