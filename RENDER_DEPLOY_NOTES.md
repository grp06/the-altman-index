# Render Deployment Notes

## Issues Fixed

1. **Python version**: Pinned to 3.11 (via `.python-version`) to avoid pydantic-core build issues with Python 3.13
2. **Build configuration**: Created `render.yaml` with proper monorepo setup

## Manual Steps Required in Render Dashboard

The deployment is failing because there's a pre-existing environment variable `RAG_BACKEND_CONFIG_PATH` set in the Render dashboard that's overriding the render.yaml configuration.

### To Fix:

1. Go to the Render dashboard for `the-altman-index` service
2. Navigate to Environment tab
3. **Remove or update** the `RAG_BACKEND_CONFIG_PATH` environment variable to: `/opt/render/project/src/config/backend.yaml`
4. Make sure `OPENAI_API_KEY` is set
5. Trigger a new deploy

## Current Status

- ✅ Build succeeds
- ✅ Python 3.11 with pre-built wheels
- ❌ Service fails to start due to config path issue

The service is looking for `/workspace/config/backend.yaml` but the config file is actually at `/opt/render/project/src/config/backend.yaml`.

## Important: Missing Data Files

Even after fixing the config path, the service will fail because it needs the ingestion artifacts (`var/artifacts/` directory with ChromaDB index and Parquet files). These need to be:

1. Generated locally with `make ingestion-rebuild`
2. Uploaded to a Render Persistent Disk mounted at `/opt/render/project/src/var`

OR

Run the ingestion pipeline once on Render using a separate service or background job.

