# Render Deployment Notes

## Issues Fixed

1. ✅ **Python version**: Pinned to 3.11 (via `.python-version`) to avoid pydantic-core build issues with Python 3.13
2. ✅ **Build configuration**: Created `render.yaml` with proper monorepo setup
3. ✅ **Config path**: Updated `RAG_BACKEND_CONFIG_PATH` to correct absolute path
4. ✅ **Persistent disk**: Added disk configuration to `render.yaml`

## Steps to Complete Deployment

### 1. Create Persistent Disk (Manual - Render Dashboard)

The `render.yaml` now includes a persistent disk configuration, but you need to **manually create the disk** first in the Render dashboard:

1. Go to your service: https://dashboard.render.com/web/srv-d4954ljuibrs739lpud0
2. Click on **"Disks"** in the left sidebar
3. Click **"Add Disk"**
4. Configure:
   - **Name**: `altman-index-data`
   - **Mount Path**: `/opt/render/project/src/var`
   - **Size**: 1 GB (you're using ~168MB)
5. Click **"Create Disk"**

### 2. Upload Your Data to the Disk

Once the disk is created and mounted, upload your local artifacts:

```bash
# From your project root
./scripts/upload-to-render.sh
```

This will rsync your `var/` directory (artifacts + data) to the Render service via SSH.

**What gets uploaded:**
- `var/artifacts/` - ChromaDB index, Parquet files, enrichment cache (~166MB)
- `var/data/` - Raw transcripts and metadata (~2.2MB)

### 3. Deploy with Disk Configuration

After the data is uploaded, commit and push the updated `render.yaml`:

```bash
git add render.yaml scripts/upload-to-render.sh RENDER_DEPLOY_NOTES.md
git commit -m "Add persistent disk configuration"
git push origin main
```

Then trigger a deploy:
```bash
render deploys create srv-d4954ljuibrs739lpud0 --output json --confirm
```

## Current Status

- ✅ Build succeeds
- ✅ Python 3.11 with pre-built wheels
- ✅ Config file found at correct path
- ⏳ **Next**: Need to create disk and upload data

## Architecture on Render

```
/opt/render/project/src/
├── apps/
│   └── backend/          # Your FastAPI app
├── config/
│   └── backend.yaml      # Config file ✅
└── var/                  # Mounted persistent disk
    ├── artifacts/        # ChromaDB + Parquet (needs upload)
    └── data/            # Transcripts (needs upload)
```

