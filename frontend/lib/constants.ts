import type { QuestionTypeKey, QuestionTypeConfig, ProcessStep, Stage } from '../types';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8018';

export const QUESTION_TYPES: Record<QuestionTypeKey, QuestionTypeConfig> = {
  factual: {
    label: 'Factual',
    description: 'Direct answers grounded in specific interview excerpts.',
    suggestions: [
      'What did Sam Altman say about regulating AI?',
      'How does Sam Altman define OpenAI's mission?',
      'Which interview covers Altman's thoughts on alignment?',
    ],
    visualHeadline: 'Top matching snippets',
  },
  analytical: {
    label: 'Analytical',
    description: 'Multi-source synthesis to evaluate themes and patterns.',
    suggestions: [
      'How has Sam Altman's stance on AGI safety evolved?',
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
      'Where might Altman's views still be ambiguous?',
    ],
    visualHeadline: 'Global corpus overview',
  },
  exploratory: {
    label: 'Exploratory',
    description: 'Surface adjacent themes and emerging directions.',
    suggestions: [
      'What unexpected topics does Sam Altman mention?',
      'Which interviews explore Altman's personal routines?',
      'Where does Altman discuss the future of education?',
    ],
    visualHeadline: 'Topic bubbles',
  },
  comparative: {
    label: 'Comparative',
    description: 'Contrast interviews across time or context.',
    suggestions: [
      'How did Altman's opinion on crypto change between 2019 and 2023?',
      'Which interviews juxtapose Altman's views on AI risk and growth?',
      'Where does Altman contrast OpenAI with other labs?',
    ],
    visualHeadline: 'Timeline alignment',
  },
  creative: {
    label: 'Creative',
    description: 'Inventive prompts that remix the corpus into new artifacts.',
    suggestions: [
      'Draft a commencement speech using Altman's advice.',
      'Write a startup manifesto inspired by Altman's interviews.',
      'Imagine Altman briefing policymakers on AI regulation.',
    ],
    visualHeadline: 'Creative synthesis workspace',
  },
};

export const PROCESS_STEPS: ProcessStep[] = [
  {
    stage: 'classifying',
    title: 'Classify intent',
    subtitle: 'Infer the question's purpose and tone.',
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

export const stageIndexMap: Record<Stage, number> = {
  idle: -1,
  classifying: 0,
  retrieving: 1,
  synthesizing: 2,
  complete: 3,
  error: 3,
};

