#!/usr/bin/env bash
# Bump the Colabonate app's semantic version (ADR-288) across the three
# package.json files that share a single version number: the monorepo root
# (source of truth), apps/colabonate-app (feeds __APP_VERSION__ via
# vite.config.ts → Footer), and apps/server (feeds the /health `version`
# field). Colabonate ships as one product, not independently versioned
# publishable packages, so all three stay in lockstep — never bump one alone.
#
# Does NOT commit, tag, or push. Review the diff, then commit normally.
# The git tag (vX.Y.Z) is created automatically by redeploy-surface.sh at
# deploy time, on the commit that actually ships — not on the bump commit.
#
# Usage:
#   bash scripts/version/bump-version.sh patch    # 0.1.0 -> 0.1.1
#   bash scripts/version/bump-version.sh minor    # 0.1.0 -> 0.2.0
#   bash scripts/version/bump-version.sh major    # 0.1.0 -> 1.0.0
#   bash scripts/version/bump-version.sh 0.3.0    # explicit version

set -euo pipefail

# `pwd -W` (Git Bash/MSYS) yields `H:/…`, which Windows Node can require();
# a plain `/h/…` path cannot be resolved there. Linux/macOS fall back to `pwd`.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && { pwd -W 2>/dev/null || pwd; })"
SYNCED_FILES=(
  "${ROOT_DIR}/package.json"
  "${ROOT_DIR}/apps/colabonate-app/package.json"
  "${ROOT_DIR}/apps/server/package.json"
)

ARG="${1:-}"
if [[ -z "${ARG}" ]]; then
  echo "Usage: $0 <major|minor|patch|X.Y.Z>" >&2
  exit 2
fi

CURRENT="$(node -p "require('${ROOT_DIR}/package.json').version")"
IFS='.' read -r MAJOR MINOR PATCH <<<"${CURRENT}"

case "${ARG}" in
  major) NEW="$((MAJOR + 1)).0.0" ;;
  minor) NEW="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) NEW="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  [0-9]*.[0-9]*.[0-9]*) NEW="${ARG}" ;;
  *)
    echo "ERROR: unrecognised bump '${ARG}' — use major|minor|patch or an explicit X.Y.Z" >&2
    exit 2
    ;;
esac

echo "Bumping version: ${CURRENT} -> ${NEW}"
for f in "${SYNCED_FILES[@]}"; do
  node -e "
    const fs = require('fs');
    const p = JSON.parse(fs.readFileSync('${f}', 'utf8'));
    p.version = '${NEW}';
    fs.writeFileSync('${f}', JSON.stringify(p, null, 2) + '\n');
  "
  echo "  updated: ${f#${ROOT_DIR}/}"
done

echo ""
echo "Next steps:"
echo "  git diff --stat"
echo "  git add package.json apps/colabonate-app/package.json apps/server/package.json"
echo "  git commit -m \"chore(release): bump version to ${NEW}\""
echo "  bash scripts/beta/redeploy-surface.sh   # tags v${NEW} on the deployed commit"
