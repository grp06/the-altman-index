#!/bin/bash

# Script to upload local artifacts to Render persistent disk
# This uploads the var/ directory to the Render service via rsync over SSH

set -e

SERVICE_SSH="srv-d4954ljuibrs739lpud0@ssh.oregon.render.com"
REMOTE_PATH="/opt/render/project/src/var/"
LOCAL_PATH="var/"

echo "🚀 Uploading artifacts to Render..."
echo "   Local: $LOCAL_PATH"
echo "   Remote: $SERVICE_SSH:$REMOTE_PATH"
echo ""

# Upload using rsync over SSH
# -a: archive mode (preserves permissions, timestamps, etc.)
# -v: verbose
# -z: compress during transfer
# --progress: show progress
# --delete: delete files on remote that don't exist locally
rsync -avz --progress \
  "$LOCAL_PATH" \
  "$SERVICE_SSH:$REMOTE_PATH"

echo ""
echo "✅ Upload complete!"
echo ""
echo "Next steps:"
echo "1. The disk configuration in render.yaml will be applied on next deploy"
echo "2. Trigger a new deploy: render deploys create srv-d4954ljuibrs739lpud0 --output json --confirm"

