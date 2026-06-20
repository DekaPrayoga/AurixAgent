#!/bin/bash

# Test captcha training with gemini-3-flash via local router
BASE_URL="http://127.0.0.1:20128"
MODEL="ag/gemini-3-flash"
TRAINING_DIR="training"
OUTPUT_FILE="$TRAINING_DIR/gemini-training-$(date +%Y%m%d-%H%M%S).json"

mkdir -p "$TRAINING_DIR"

echo "=== Captcha Training Test with $MODEL ==="
echo "Base URL: $BASE_URL"
echo "Model: $MODEL"
echo "Output: $OUTPUT_FILE"
echo ""

# Test prompt for captcha classification
test_image_base64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

prompt='Look at this image tile from a reCAPTCHA grid. The task is to find tiles containing "traffic lights".

Does this image show traffic lights (or a recognizable part of it, like a pole/sign/housing associated with traffic lights)?

- Answer YES if you can identify traffic lights or a significant part of it
- Answer NO if it clearly does not contain traffic lights

Answer with exactly one word: YES or NO'

echo "Testing API connection..."

# Make API call
response=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"messages\": [{
      \"role\": \"user\",
      \"content\": [
        {\"type\": \"text\", \"text\": \"$prompt\"},
        {\"type\": \"image_url\", \"image_url\": {\"url\": \"data:image/png;base64,$test_image_base64\"}}
      ]
    }],
    \"max_tokens\": 100
  }")

# Check if response is valid JSON
if echo "$response" | jq empty 2>/dev/null; then
  echo "✓ API connection successful"
  echo ""
  echo "Response:"
  echo "$response" | jq '.'
  
  # Extract content
  content=$(echo "$response" | jq -r '.choices[0].message.content // "NO RESPONSE"')
  
  # Save to JSON
  echo "$response" | jq "{
    timestamp: $(date +%s),
    model: \"$MODEL\",
    baseUrl: \"$BASE_URL\",
    prompt: \"$prompt\",
    response: .,
    extracted_content: \"$content\"
  }" > "$OUTPUT_FILE"
  
  echo ""
  echo "✓ Results saved to: $OUTPUT_FILE"
  echo ""
  echo "Extracted content: $content"
else
  echo "✗ API connection failed"
  echo ""
  echo "Raw response:"
  echo "$response"
  exit 1
fi

echo ""
echo "=== Training Test Complete ==="
