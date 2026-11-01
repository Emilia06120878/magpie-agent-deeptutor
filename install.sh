#!/bin/sh
# Install the DeepTutor agent plugin into Magpie.
#
#   curl -fsSL https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.sh | sh
#
# Set MAGPIE_BIN to point at the magpie executable when it is not on PATH.
set -eu

REPO='github:Emilia06120878/magpie-agent-deeptutor'

say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

find_magpie() {
  if [ -n "${MAGPIE_BIN:-}" ]; then
    [ -x "$MAGPIE_BIN" ] || die "MAGPIE_BIN=$MAGPIE_BIN is not executable"
    printf '%s\n' "$MAGPIE_BIN"
    return 0
  fi
  if command -v magpie >/dev/null 2>&1; then
    command -v magpie
    return 0
  fi
  for candidate in \
    "$HOME/.local/bin/magpie" \
    "$HOME/.magpie/bin/magpie" \
    "/usr/local/bin/magpie" \
    "/opt/homebrew/bin/magpie" \
    "/Applications/Magpie.app/Contents/MacOS/magpie"
  do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

MAGPIE="$(find_magpie)" || die "magpie was not found. Install Magpie first: https://usemagpie.ai"

say "magpie: $MAGPIE"
say "adding $REPO"

"$MAGPIE" plugin add "$REPO" || die "magpie plugin add failed"

say ""
say "Installed. Next:"
say "  1. Magpie -> Agents -> DeepTutor -> pick a model"
say "  2. DeepTutor -> Settings -> model list -> the Magpie profile"
say ""
"$MAGPIE" ls 2>/dev/null | grep -i deeptutor || true
