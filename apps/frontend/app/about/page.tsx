import type { Metadata } from 'next';
import styles from './about.module.css';

export const metadata: Metadata = {
  title: 'About | The Altman Index',
  description: 'How I built a searchable knowledge base from 100+ Sam Altman interviews using RAG, embeddings, and enriched metadata.',
};

export default function AboutPage() {
  return (
    <main className={styles.main}>
      <article className={styles.article}>
        <header className={styles.header}>
          <p className={styles.kicker}>About this project</p>
          <h1 className={styles.title}>Building a searchable Sam Altman knowledge base</h1>
          <p className={styles.subtitle}>
            What happens when you take unstructured YouTube interviews and turn them into structured, queryable data? I built this to find out.
          </p>
        </header>

        <div className={styles.content}>
          <section>
            <h2>The idea</h2>
            <p>
              YouTube has a treasure trove of information that&apos;s not indexed anywhere else on the internet. Thousands of hours of interviews, panels, and talks where people share ideas, make claims, and explain their thinking. But it&apos;s all trapped in video format—you can&apos;t easily search across it or extract insights from it.
            </p>
            <p>
              Then I found out OpenAI recently released GPT-4o-diarize, an endpoint that gives you a diarized transcript of any audio file. That&apos;s when I thought: what if I could take all that unstructured data from YouTube interviews and extract it into structured, searchable data?
            </p>
            <p>
              The next question was: what kind of data would actually be interesting to extract? Since it&apos;s kind of expensive to process these videos (diarization, embeddings, and LLM enrichment all add up), I decided to start focused. I chose Sam Altman as my subject—he&apos;s always making claims about AI, AGI, OpenAI, and the future. If I had a corpus of all his talks, I could probably extract some interesting insights.
            </p>
          </section>

          <section>
            <h2>Building the pipeline</h2>
            <p>
              I started by building an ingestion pipeline. First, I download the audio from YouTube videos. Then I send the audio through GPT-4o-diarize to get speaker-separated transcripts—so I know exactly who said what and when.
            </p>
            <p>
              Once I have the transcripts, the real work begins. I chunk them into overlapping windows (this helps with retrieval later). Each chunk then goes through an enrichment process where GPT-4o extracts:
            </p>
            <ul>
              <li><strong>Summaries</strong> – what&apos;s the main point of this chunk?</li>
              <li><strong>Intent</strong> – is Sam explaining something, making a prediction, expressing concern?</li>
              <li><strong>Sentiment</strong> – optimistic, cautious, neutral?</li>
              <li><strong>Claims</strong> – specific factual statements he&apos;s making</li>
            </ul>
            <p>
              This enrichment step was a game-changer. Instead of just searching raw text, I could now search by intent or filter by sentiment. I could find all the times Sam made predictions, or extract his most optimistic statements.
            </p>
            <p>
              All of this metadata gets cached with version tracking, so if I need to rerun the pipeline, it can reuse the work it&apos;s already done. The whole thing is deterministic—run it twice and you get the same outputs.
            </p>
          </section>

          <section>
            <h2>Multiple views of the same data</h2>
            <p>
              One thing I learned while building this: you don&apos;t want to embed just the raw text. Different questions need different kinds of search. If someone asks &quot;What did Sam say about GPT-5?&quot;, you want exact words. But if they ask &quot;How has Sam&apos;s thinking on AI safety evolved?&quot;, you need something more conceptual.
            </p>
            <p>
              So I created four different vector representations of the corpus:
            </p>
            <ul>
              <li><strong>Primary embeddings</strong> – the actual transcript text</li>
              <li><strong>Summary embeddings</strong> – embeddings of the chunk summaries</li>
              <li><strong>Intent embeddings</strong> – embeddings of the intent classifications</li>
              <li><strong>Document-summary embeddings</strong> – high-level interview summaries</li>
            </ul>
            <p>
              Each type of embedding lives in its own vector collection in Chroma. When you search, the system decides which collections to query based on your question type, then merges the results. Every result tells you which vector source found it, so you can see whether it matched on exact wording or thematic similarity.
            </p>
          </section>

          <section>
            <h2>Smart retrieval</h2>
            <p>
              When you type a question into this app, here&apos;s what happens behind the scenes:
            </p>
            <p>
              First, the question gets classified. Is it factual (&quot;When did OpenAI release GPT-4?&quot;), analytical (&quot;What&apos;s Sam&apos;s theory on AI regulation?&quot;), comparative (&quot;How do Sam&apos;s views differ from Hinton&apos;s?&quot;), or exploratory (&quot;What surprises Sam most about AI progress?&quot;)?
            </p>
            <p>
              Based on that classification, the system picks a retrieval strategy. Factual questions hit the primary collection. Analytical questions search across primary, summary, and intent collections. Comparative questions use document summaries to find relevant interviews and then drill down.
            </p>
            <p>
              The backend merges the results, adds all the enriched metadata (summaries, intents, claims), and sends it back. Then GPT-4o synthesizes an answer using those chunks, and you can see exactly which parts of which interviews contributed to the response.
            </p>
          </section>

          <section>
            <h2>Why this matters</h2>
            <p>
              The thing I&apos;m most proud of is the transparency. Every retrieval decision is visible. You can see why a chunk was selected, what intent it represents, what claims it contains. The chunk-level metadata isn&apos;t just for show—it drives the search and lets you filter or cluster results.
            </p>
            <p>
              This whole project started as an experiment to learn about RAG systems, vector databases, and LLM enrichment. Along the way, I built something that actually works end-to-end: from YouTube audio to structured knowledge you can query and reason about.
            </p>
            <p>
              If you want to see how it all fits together, check out the codebase. The ingestion pipeline, backend API, and this frontend are all there. Everything is versioned and deterministic, so you can rebuild the whole system from scratch if you want.
            </p>
          </section>
        </div>
      </article>
    </main>
  );
}

