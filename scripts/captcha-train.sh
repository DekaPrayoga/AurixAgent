#!/bin/bash

# AURIX Captcha Training Automation Script
# Drives AURIX to solve reCAPTCHA and generate training data

AURIX_BIN="/root/main/aurix-agent/bin/aurix.js"
ROUNDS=${1:-5}
MODEL="ag/gemini-3-flash"
BASE_URL="http://127.0.0.1:20128"

echo "=== AURIX Captcha Training ==="
echo "Rounds: $ROUNDS"
echo "Model: $MODEL"
echo "Base URL: $BASE_URL"
echo ""

for ((i=1; i<=ROUNDS; i++)); do
  echo "--- Round $i/$ROUNDS ---"
  
  node "$AURIX_BIN" --non-interactive --message "Navigate to https://www.google.com/recaptcha/api2/demo and solve the reCAPTCHA. Use vision model to classify each tile. Save the training data to training/captcha-training.json with timestamp, instruction, objectType, grid layout, matchedIndices, and your vision response. Do NOT skip - analyze every tile carefully." \
    --env AURIX_BASE_URL="$BASE_URL" \
    --env AURIX_MODEL="$MODEL" \
    --env AURIX_VISION_BASE_URL="$BASE_URL" \
    --env AURIX_VISION_MODEL="$MODEL" \
    --timeout 180
  
  echo ""
  echo "Round $i complete. Waiting 5s..."
  sleep 5
done

echo ""
echo "=== Training Complete ==="
echo "Results saved to: training/captcha-training.json"
