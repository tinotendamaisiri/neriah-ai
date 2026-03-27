#!/usr/bin/env bash
# scripts/deploy.sh
# Deploys Neriah infrastructure and backend in one command.
# Usage: bash scripts/deploy.sh <environment>   (environment = dev | prod)

set -euo pipefail

ENVIRONMENT="${1:-dev}"
RESOURCE_GROUP="neriah-rg-${ENVIRONMENT}"
LOCATION="southafricanorth"
FUNC_APP_NAME="neriah-func-${ENVIRONMENT}"   # must match functions.bicep output

echo "==> Deploying Neriah to environment: ${ENVIRONMENT}"

# ── 1. Ensure resource group exists ──────────────────────────────────────────
echo "==> Ensuring resource group: ${RESOURCE_GROUP}"
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --output none

# ── 2. Deploy Bicep infrastructure ────────────────────────────────────────────
echo "==> Deploying Bicep infrastructure..."
az deployment group create \
  --resource-group "${RESOURCE_GROUP}" \
  --template-file infra/main.bicep \
  --parameters "infra/parameters/${ENVIRONMENT}.bicepparam" \
  --output table

# TODO: capture outputs (functionsEndpoint, storageAccountName) from deployment result
# TODO: write them to a .deployment-outputs.json file for use in subsequent steps

# ── 3. Deploy Azure Functions ─────────────────────────────────────────────────
echo "==> Deploying Azure Functions backend..."
cd backend
func azure functionapp publish "${FUNC_APP_NAME}" \
  --python \
  --build remote

cd ..

# ── 4. (Optional) Deploy web dashboard ───────────────────────────────────────
# TODO: add Azure Static Web Apps or Blob Storage static site deployment for web app
# echo "==> Building web dashboard..."
# cd app/web && npm ci && npm run build && cd ../..
# echo "==> Uploading web dist to Azure Static Web Apps..."

echo "==> Deployment complete."
echo "    Environment: ${ENVIRONMENT}"
echo "    Resource group: ${RESOURCE_GROUP}"
# TODO: print APIM gateway URL from deployment outputs
