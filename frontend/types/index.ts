export type Stage = 'idle' | 'classifying' | 'retrieving' | 'synthesizing' | 'complete' | 'error';

export type QuestionTypeKey = 'factual' | 'analytical' | 'meta' | 'exploratory' | 'comparative' | 'creative';

export type ClassificationResult = {
  type: QuestionTypeKey;
  confidence: number;
};

export type ChunkMetadata = {
  title?: string;
  upload_date?: string;
  youtube_url?: string;
  source_path?: string;
  source_name?: string;
};

export type Chunk = {
  id: string;
  snippet: string;
  score: number;
  metadata: ChunkMetadata;
};

export type SynthesisResult = {
  answer: string;
  reasoning: string[];
};

export type StepStatus = 'pending' | 'active' | 'done' | 'error';

export type QuestionTypeConfig = {
  label: string;
  description: string;
  suggestions: string[];
  visualHeadline: string;
};

export type ProcessStep = {
  stage: Stage;
  title: string;
  subtitle: string;
};

