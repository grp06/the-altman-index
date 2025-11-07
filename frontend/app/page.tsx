'use client';

import { useState } from 'react';
import type { Stage, QuestionTypeKey, ClassificationResult, Chunk, SynthesisResult } from '../types';
import { classifyQuestion, retrieveChunks, synthesizeAnswer } from '../lib/api';
import { QueryForm } from '../components/QueryForm';
import { ProcessStepper } from '../components/ProcessStepper';
import { ClassificationCard } from '../components/ClassificationCard';
import { RetrievalCanvas } from '../components/RetrievalCanvas';
import { SynthesisCard } from '../components/SynthesisCard';
import { FinalAnswerSection } from '../components/FinalAnswerSection';
import styles from './page.module.css';

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
        <QueryForm
          query={query}
          selectedType={selectedType}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onQueryChange={setQuery}
          onTypeChange={setSelectedType}
          onSubmit={handleSubmit}
          onSuggestionClick={handleSuggestionClick}
        />
      </section>
      <section className={styles.processSection}>
        <div className={styles.processHeader}>
          <div className={styles.processTitle}>Follow the reasoning pipeline</div>
          <div className={styles.processCaption}>Each stage updates once the backend reports progress.</div>
        </div>
        <ProcessStepper stage={stage} />
        <div className={styles.processGrid}>
          <ClassificationCard stage={stage} classification={classification} />
          <RetrievalCanvas stage={stage} chunks={chunks} classification={classification} selectedType={selectedType} />
          <SynthesisCard stage={stage} synthesis={synthesis} />
        </div>
        {stage === 'error' && errorMessage && <div className={styles.errorPanel}>{errorMessage}</div>}
      </section>
      {stage === 'complete' && synthesis && (
        <FinalAnswerSection
          synthesis={synthesis}
          chunks={chunks}
          classification={classification}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      )}
      <footer className={styles.footer}>
        <span>Built for transparent AI exploration.</span>
        <span>Sam Altman Interview Explorer</span>
      </footer>
    </main>
  );
}

