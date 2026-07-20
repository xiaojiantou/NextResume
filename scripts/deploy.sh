#!/bin/bash

# NextResume Deployment Script
# Usage: npm run deploy or ./scripts/deploy.sh

set -e

echo "🚀 NextResume Deployment Script"
echo "================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Step 1: Check git status
echo -e "${BLUE}Step 1: Checking git status...${NC}"
if [[ -n $(git status -s) ]]; then
  echo -e "${YELLOW}⚠️  Uncommitted changes detected:${NC}"
  git status -s
  echo ""
  read -p "Continue with deployment? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Deployment cancelled${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}✅ Working directory clean${NC}"
fi

# Step 2: Type check
echo ""
echo -e "${BLUE}Step 2: Running TypeScript check...${NC}"
if npx tsc --noEmit; then
  echo -e "${GREEN}✅ TypeScript check passed${NC}"
else
  echo -e "${RED}❌ TypeScript check failed${NC}"
  exit 1
fi

# Step 3: Build
echo ""
echo -e "${BLUE}Step 3: Building project...${NC}"
if npm run build; then
  echo -e "${GREEN}✅ Build successful${NC}"
else
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi

# Step 4: Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo ""
echo -e "${BLUE}Step 4: Checking branch...${NC}"
echo "Current branch: $BRANCH"

if [ "$BRANCH" != "main" ]; then
  echo -e "${YELLOW}⚠️  You're not on main branch${NC}"
  read -p "Continue deployment from $BRANCH? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Deployment cancelled${NC}"
    exit 1
  fi
fi

# Step 5: Push to remote
echo ""
echo -e "${BLUE}Step 5: Pushing to remote...${NC}"
if git push origin $BRANCH; then
  echo -e "${GREEN}✅ Pushed to origin/$BRANCH${NC}"
else
  echo -e "${RED}❌ Push failed${NC}"
  exit 1
fi

# Step 6: Show deployment info
echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✅ Deployment Initiated!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""
echo -e "${BLUE}Your app is deploying...${NC}"
echo "Live URL: https://nextresume-lovat.vercel.app"
echo "Vercel Dashboard: https://vercel.com/dashboard"
echo ""
echo "Deployment typically completes in 30-60 seconds."
echo ""

# Step 7: Get last commit
LAST_COMMIT=$(git log -1 --pretty=format:"%h - %s")
echo -e "${BLUE}Last commit:${NC}"
echo "$LAST_COMMIT"
echo ""

# Step 8: Show recent commits
echo -e "${BLUE}Recent commits:${NC}"
git log --oneline -5
echo ""

echo -e "${GREEN}🎉 All done! Monitor deployment at: https://vercel.com/dashboard${NC}"
