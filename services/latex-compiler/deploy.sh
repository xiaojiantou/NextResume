#!/bin/bash
# Copyright (c) 2026 HowBe LLC. All rights reserved.
#
# Builds the LaTeX compile service and deploys it to Cloud Run.
#
#   PROJECT_ID=my-gcp-project ./services/latex-compiler/deploy.sh
#
# The app stays on Vercel; only this container runs on GCP, because a TeX
# distribution does not fit in a serverless function and compiling user
# LaTeX needs its own isolation boundary. Re-run after changing server.js or
# the Dockerfile. Safe to re-run: every create step skips what already exists.
set -euo pipefail

# Explicit on purpose: the gcloud default project on this machine belongs to
# another product, and a resume compiler must not land there by accident.
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-east1}"            # same side of the US as Vercel's iad1
SERVICE="${SERVICE:-latex-compiler}"
REPO="${REPO:-nextresume}"
SECRET="${SECRET:-latex-compile-token}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"     # the image is ~2-3 GB; a cold start is 10-20s

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Set PROJECT_ID, e.g. PROJECT_ID=nextresume-prod $0"; exit 1
fi
cd "$(dirname "$0")"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}"

echo "🔧 Project ${PROJECT_ID} · region ${REGION} · service ${SERVICE}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com --project "$PROJECT_ID" --quiet

if ! gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "📦 Creating Artifact Registry repo ${REPO}..."
  gcloud artifacts repositories create "$REPO" --repository-format=docker \
    --location "$REGION" --project "$PROJECT_ID" --quiet
fi

if ! gcloud secrets describe "$SECRET" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "🔑 Creating compile token secret ${SECRET}..."
  # No trailing newline: Cloud Run injects the secret bytes verbatim, and the
  # service compares the header against them exactly, so a stray "\n" made
  # every request a 401 on the first deploy.
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create "$SECRET" --data-file=- --project "$PROJECT_ID" --quiet
fi
TOKEN="$(gcloud secrets versions access latest --secret "$SECRET" --project "$PROJECT_ID")"

# Cloud Run's runtime service account must be allowed to read the secret.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT_ID" --quiet \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor >/dev/null

echo "🏗  Building image (Cloud Build)..."
gcloud builds submit --tag "$IMAGE" --project "$PROJECT_ID" --quiet

echo "☁️  Deploying to Cloud Run..."
# Unauthenticated at the platform level: the service enforces X-Compile-Token
# itself (a wrong token is a 401). Concurrency 2 keeps two pdflatex runs from
# fighting over one CPU.
gcloud run deploy "$SERVICE" --image "$IMAGE" --project "$PROJECT_ID" --region "$REGION" \
  --platform managed --allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 2 --timeout 60 \
  --min-instances "$MIN_INSTANCES" --max-instances 3 \
  --set-secrets "COMPILE_TOKEN=${SECRET}:latest" --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"

echo ""
echo "🩺 Health check..."
if curl -fsS "${URL}/health" | grep -q ok; then
  echo "✅ ${URL}/health -> ok"
else
  echo "⚠️  Health check failed — inspect logs: gcloud run services logs read ${SERVICE} --region ${REGION}"
fi

cat <<EOF

✅ Deployed: ${URL}

Set these on Vercel (Production), then deploy the app once:
  LATEX_COMPILER_URL=${URL}
  LATEX_COMPILER_TOKEN=${TOKEN}
  NEXT_PUBLIC_LATEX_COMPILER=1

  vercel env add LATEX_COMPILER_URL production
  vercel env add LATEX_COMPILER_TOKEN production
  vercel env add NEXT_PUBLIC_LATEX_COMPILER production
EOF
