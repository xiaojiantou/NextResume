#!/bin/bash
# NextResume Deploy Script
# Usage: ./deploy.sh
#
# NOTE: This project is NOT connected to GitHub on Vercel.
# `git push` does NOT deploy — deploys go through the Vercel CLI.

set -e

echo "🚀 Deploying NextResume..."
echo ""

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
echo "🌐 Live: https://nextresume-lovat.vercel.app"
echo ""
echo "Verifying live site..."
sleep 5
if curl -s https://nextresume-lovat.vercel.app | grep -qi clerk; then
  echo "✅ New build confirmed live (Clerk present)"
else
  echo "⚠️  Live HTML doesn't contain expected content — check https://vercel.com/dashboard"
fi
