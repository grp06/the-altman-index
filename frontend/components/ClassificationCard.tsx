import type { ClassificationResult, Stage } from '../types';
import { QUESTION_TYPES, stageIndexMap } from '../lib/constants';
import styles from '../app/page.module.css';

type ClassificationCardProps = {
  stage: Stage;
  classification: ClassificationResult | null;
};

export function ClassificationCard({ stage, classification }: ClassificationCardProps) {
  const classificationReady = stageIndexMap[stage] > stageIndexMap.classifying && classification;

  return (
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
  );
}

