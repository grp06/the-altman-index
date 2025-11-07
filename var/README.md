This directory stores runtime data that should not be committed.

- Place authoritative transcripts under `var/data/transcripts/`.
- Place transcript-level metadata JSON under `var/data/metadata/`.
- Allow the ingestion pipeline to write and update `var/artifacts/`.

All contents other than this file are ignored by Git.
