import type { Stage, SynthesisResult } from '../types';
import { stageIndexMap } from '../lib/constants';
import styles from '../app/page.module.css';

type SynthesisCardProps = {
  stage: Stage;
  synthesis: SynthesisResult | null;
};

export function SynthesisCard({ stage, synthesis }: SynthesisCardProps) {
  const synthesisReady = stageIndexMap[stage] > stageIndexMap.synthesizing && synthesis;

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
  );
}

