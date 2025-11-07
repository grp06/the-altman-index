'use client';

import type { QuestionTypeKey } from '../types';
import { QUESTION_TYPES } from '../lib/constants';
import styles from '../app/page.module.css';

type QueryFormProps = {
  query: string;
  selectedType: QuestionTypeKey;
  isSubmitting: boolean;
  errorMessage: string | null;
  onQueryChange: (value: string) => void;
  onTypeChange: (type: QuestionTypeKey) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSuggestionClick: (suggestion: string) => void;
};

export function QueryForm({
  query,
  selectedType,
  isSubmitting,
  errorMessage,
  onQueryChange,
  onTypeChange,
  onSubmit,
  onSuggestionClick,
}: QueryFormProps) {
  const suggestions = QUESTION_TYPES[selectedType].suggestions;

  return (
    <div className={styles.searchCard}>
      <form className={styles.searchForm} onSubmit={onSubmit}>
        <input
          className={styles.searchInput}
          placeholder="Ask anything across the Sam Altman interview corpus..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
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
            onClick={() => onTypeChange(typeKey)}
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
              onClick={() => onSuggestionClick(suggestion)}
              disabled={isSubmitting}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

