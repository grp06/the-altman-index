import type { Metadata } from 'next';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About | The Altman Index',
  description: 'How I built a searchable knowledge base from 100+ Sam Altman interviews using RAG, embeddings, and enriched metadata.',
  openGraph: {
    title: 'About | The Altman Index',
    description: 'How I built a searchable knowledge base from 100+ Sam Altman interviews using RAG, embeddings, and enriched metadata.',
    url: '/about',
    siteName: 'The Altman Index',
    images: [
      {
        url: '/congress.jpg',
        width: 1200,
        height: 630,
        alt: 'About The Altman Index - Building a searchable Sam Altman knowledge base',
      },
    ],
    locale: 'en_US',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About | The Altman Index',
    description: 'How I built a searchable knowledge base from 100+ Sam Altman interviews using RAG, embeddings, and enriched metadata.',
    images: ['/congress.jpg'],
  },
};

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        <header className={styles.header}>
          <p className={styles.kicker}>About this project</p>
          <h1 className={styles.title}>Building a searchable Sam Altman knowledge base</h1>
          <p className={styles.subtitle}>
            Turning unstructured YouTube interviews into structured, queryable data.
          </p>
        </header>

        <div className={styles.content}>
          <section>
            <h2>The idea</h2>
            <p>
              YouTube has tons of information that isn&apos;t indexed anywhere else. Thousands of hours of interviews where people share ideas and explain their thinking. But it&apos;s all trapped in video format.
            </p>
            <p>
              When OpenAI released GPT-4o-diarize, I saw an opportunity. This endpoint gives you speaker-separated transcripts from any audio file. So I thought: what if I could extract all that unstructured YouTube data into something searchable?
            </p>
            <p>
              Processing videos is expensive (diarization, embeddings, and LLM enrichment add up), so I started focused. I chose Sam Altman since he&apos;s constantly making claims about AI, AGI, and the future. A corpus of all his talks seemed like it could yield interesting insights.
            </p>
          </section>

          <section>
            <h2>Building the pipeline</h2>
            <p>
              First, I download audio from YouTube videos. Then I send it through GPT-4o-diarize to get speaker-separated transcripts so I know exactly who said what.
            </p>
            <p>
              Next comes enrichment. I chunk the transcripts into overlapping windows and have GPT-4o extract:
            </p>
            <ul>
              <li><strong>Summaries</strong> – what&apos;s the main point?</li>
              <li><strong>Intent</strong> – is he explaining, predicting, or expressing concern?</li>
              <li><strong>Sentiment</strong> – optimistic, cautious, neutral?</li>
              <li><strong>Claims</strong> – specific factual statements</li>
            </ul>
            <p>
              This lets me search by intent or filter by sentiment. I can find all the times Sam made predictions, or pull out his most optimistic statements.
            </p>
            <p>
              All metadata gets cached with version tracking, so reruns can reuse previous work. The pipeline is deterministic.
            </p>
          </section>

          <section>
            <h2>Multiple views of the same data</h2>
            <p>
              Different questions need different kinds of search. &quot;What did Sam say about GPT-5?&quot; needs exact words. &quot;How has his thinking on AI safety evolved?&quot; needs something more conceptual.
            </p>
            <p>
              So I created four vector representations:
            </p>
            <ul>
              <li><strong>Primary embeddings</strong> – the actual transcript text</li>
              <li><strong>Summary embeddings</strong> – embeddings of chunk summaries</li>
              <li><strong>Intent embeddings</strong> – embeddings of intent classifications</li>
              <li><strong>Document-summary embeddings</strong> – high-level interview summaries</li>
            </ul>
            <p>
              Each lives in its own Chroma collection. When you search, the system picks which collections to query based on your question, then merges results. You can see whether it matched on exact wording or thematic similarity.
            </p>
          </section>

          <section>
            <h2>Smart retrieval</h2>
            <p>
              When you ask a question, it first gets classified: factual, analytical, comparative, or exploratory.
            </p>
            <p>
              Based on that, the system picks a retrieval strategy. Factual questions hit primary embeddings. Analytical questions search across primary, summary, and intent. Comparative questions use document summaries to find relevant interviews, then drill down.
            </p>
            <p>
              The backend merges results, adds enriched metadata, and sends it back. GPT-4o synthesizes an answer, and you can see exactly which chunks contributed.
            </p>
          </section>

          <section>
            <h2>Why this matters</h2>
            <p>
              Everything is transparent. You can see why a chunk was selected, what intent it represents, what claims it contains. The metadata drives the search and lets you filter or cluster results.
            </p>
            <p>
              This started as an experiment to learn about RAG systems and vector databases. Along the way, I built something that works end-to-end: from YouTube audio to structured knowledge you can query.
            </p>
            <p>
              The codebase is all there if you want to see how it fits together. Everything is versioned and deterministic.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

