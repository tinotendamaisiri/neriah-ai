#!/bin/bash
# scripts/pre-push.sh
# Runs the full Neriah test suite before every git push.
# Installed as .git/hooks/pre-push by: cp scripts/pre-push.sh .git/hooks/pre-push

set -euo pipefail

echo "Running Neriah test suite before push..."
cd "$(git rev-parse --show-toplevel)"

python -m pytest tests/ -v --tb=short

if [ $? -ne 0 ]; then
    echo ""
    echo "Tests failed. Push aborted."
    exit 1
fi

echo ""
echo "All tests passed. Pushing..."
