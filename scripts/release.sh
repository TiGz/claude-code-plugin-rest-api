#!/bin/bash
set -e

# Release script - updates version in package.json, commits, and pushes with tag
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.0.3

if [ -z "$1" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.0.3"
  exit 1
fi

VERSION=$1
TAG="v$VERSION"

# Validate version format (simple check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: Version must be in format X.Y.Z (e.g., 1.0.3)"
  exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet HEAD; then
  echo "Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists"
  exit 1
fi

echo "Releasing version $VERSION..."

# Update package.json version
PACKAGE_JSON="packages/claude-code-plugin-rest-api/package.json"
sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$PACKAGE_JSON"
rm -f "$PACKAGE_JSON.bak"

# Commit the version bump
git add "$PACKAGE_JSON"
git commit -m "chore: Release v$VERSION

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Create and push tag
git tag "$TAG"
git push origin main
git push origin "$TAG"

echo ""
echo "✅ Released $TAG"
echo "   - Updated package.json to version $VERSION"
echo "   - Pushed commit and tag to origin"
echo "   - GitHub Actions will now publish to npm"
