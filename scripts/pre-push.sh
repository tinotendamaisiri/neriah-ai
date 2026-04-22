#!/bin/bash
# scripts/pre-push.sh
# Runs the Neriah test suite before every git push.
# Installed as .git/hooks/pre-push by: cp scripts/pre-push.sh .git/hooks/pre-push
#
# Tests that require a running Ollama instance are skipped automatically when
# Ollama is not reachable — they pass in CI/production (Vertex AI backend).

set -euo pipefail

echo "Running Neriah test suite before push..."
cd "$(git rev-parse --show-toplevel)"

# Check if Ollama is running locally
OLLAMA_UP=0
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_UP=1
fi

if [ "$OLLAMA_UP" -eq 0 ]; then
  echo "Ollama not running — skipping tests that require local inference."
  # test_integration.py is wholesale excluded — every test in it depends on
  # mark_response, which hits live Gemma through Vertex AI. The two other
  # names cover a grade-submission test and a scheme-generation suite that
  # both require live inference (Ollama or Vertex).
  SKIP_EXPR="-k 'not (test_integration or test_grade_submission_non_empty or TestSchemeGeneration)'"
else
  SKIP_EXPR=""
fi

eval python -m pytest tests/ -v --tb=short $SKIP_EXPR

if [ $? -ne 0 ]; then
    echo ""
    echo "Tests failed. Push aborted."
    exit 1
fi

echo ""
echo "All tests passed. Pushing..."
