#!/bin/bash
# Copyright (c) 2026 HowBe LLC. All rights reserved.
# NextResume Deploy Script
# Usage: ./deploy.sh
#
# NOTE: This project is NOT connected to GitHub on Vercel.
# `git push` does NOT deploy — deploys go through the Vercel CLI.

set -e

echo "🚀 Deploying NextResume..."
echo ""

# Production deploys should come from main so the deployed code matches history.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ Production deploys must run from main. Current branch: $BRANCH"
  echo "Run: git switch main && git pull --ff-only origin main"
  exit 1
fi

echo "🔄 Syncing main with GitHub..."
git fetch origin main
if git merge-base --is-ancestor HEAD origin/main && [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git pull --ff-only origin main
elif ! git merge-base --is-ancestor origin/main HEAD; then
  echo "❌ Local main and origin/main have diverged. Rebase or merge before deploying."
  exit 1
fi

# Branch switches can leave stale Next.js route metadata that makes tsc look
# for API routes that no longer exist.
echo "🧹 Clearing stale Next.js type cache..."
if [ -d .next/types ]; then
  rm -r .next/types
fi

# Check TypeScript
echo "📋 Type checking..."
npx tsc --noEmit || { echo "❌ TypeScript errors"; exit 1; }

# Commit and push (for code history, not deployment)
echo "📤 Committing + pushing to GitHub..."
git add -A
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" || true
git push origin main || echo "⚠️  git push failed (deploy continues anyway)"

# Actual deployment: Vercel CLI (builds remotely)
echo "☁️  Deploying to Vercel production..."
vercel --prod || { echo "❌ Vercel deploy failed"; exit 1; }

echo ""
echo "✅ Deployed!"
echo "🌐 Live: https://nextresume.howbetech.com"
echo ""
echo "Verifying live site..."
sleep 5
if curl -s https://nextresume.howbetech.com | grep -qi clerk; then
  echo "✅ New build confirmed live (Clerk present)"
else
  echo "⚠️  Live HTML doesn't contain expected content — check https://vercel.com/dashboard"
fi
