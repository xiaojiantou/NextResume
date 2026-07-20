#!/bin/bash
# NextResume Deploy Script - Run from root directory
# Usage: ./deploy.sh

set -e

echo "🚀 Deploying NextResume..."
echo ""

# Check TypeScript
echo "📋 Type checking..."
npx tsc --noEmit || { echo "❌ TypeScript errors"; exit 1; }

# Build
echo "🔨 Building..."
npm run build || { echo "❌ Build failed"; exit 1; }

# Push to git
echo "📤 Pushing to main..."
git add -A
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" || true
git push origin main || { echo "❌ Push failed"; exit 1; }

echo ""
echo "✅ Deployed successfully!"
echo ""
echo "🌐 Live: https://nextresume-lovat.vercel.app"
echo "📊 Dashboard: https://vercel.com/dashboard"
echo ""
echo "Deployment in progress (30-60 seconds)..."
