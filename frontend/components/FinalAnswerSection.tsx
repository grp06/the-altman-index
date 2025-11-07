'use client';

import type { Chunk, ClassificationResult, SynthesisResult } from '../types';
import { QUESTION_TYPES } from '../lib/constants';
import { getChunkTitle, getChunkSource } from '../lib/utils';
import styles from '../app/page.module.css';

type FinalAnswerSectionProps = {
  synthesis: SynthesisResult;
  chunks: Chunk[];
  classification: ClassificationResult | null;
  activeTab: 'answer' | 'chunks' | 'trace';
  onTabChange: (tab: 'answer' | 'chunks' | 'trace') => void;
};

export function FinalAnswerSection({ synthesis, chunks, classification, activeTab, onTabChange }: FinalAnswerSectionProps) {
  return (
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
          onClick={() => onTabChange('answer')}
        >
          Answer
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'chunks' ? styles.tabActive : ''}`}
          onClick={() => onTabChange('chunks')}
        >
          Retrieved chunks
        </button>
        <button
          type="button"
          className={`${styles.tabButton} ${activeTab === 'trace' ? styles.tabActive : ''}`}
          onClick={() => onTabChange('trace')}
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
  );
}

