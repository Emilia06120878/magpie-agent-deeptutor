#!/bin/sh
# Install the DeepTutor agent plugin into Magpie.
#
#   curl -fsSL https://raw.githubusercontent.com/Emilia06120878/magpie-agent-deeptutor/main/install.sh | sh
#
# MAGPIE_DEEPTUTOR_HOME overrides discovery. CHECK_ONLY=1 only prints the result.
# Set MAGPIE_BIN to point at the magpie executable when it is not on PATH.
set -eu

REPO='github:Emilia06120878/magpie-agent-deeptutor'
say() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
valid_home() { [ -n "$1" ] && [ -f "$1/data/user/settings/model_catalog.json" ]; }

DESKTOP_HOME=''
if [ "$(uname -s)" = 'Darwin' ]; then
  DESKTOP_HOME="$HOME/Library/Application Support/Open DeepTutor/workspace"
fi

SELECTED_HOME=''
# Explicit overrides win, then an existing DEEPTUTOR_HOME, then the managed
# desktop workspace. Every candidate is derived from the current user/system.
for candidate in \
  "${MAGPIE_DEEPTUTOR_HOME:-}" \
  "${DEEPTUTOR_HOME:-}" \
  "$DESKTOP_HOME" \
  "$PWD" \
  "$HOME/.deeptutor" \
  "$HOME/DeepTutor/workspace" \
  "$HOME/deeptutor/workspace" \
  "/opt/deeptutor/workspace" \
  "/usr/local/deeptutor/workspace"
do
  # An explicit relative override must not depend on Magpie's later working directory.
  case $candidate in
    /*) ;;
    ?*) candidate="$PWD/$candidate" ;;
  esac
  if valid_home "$candidate"; then
    SELECTED_HOME="$candidate"
    break
  fi
done

[ -n "$SELECTED_HOME" ] || die 'DeepTutor was not found. Open it once, or set MAGPIE_DEEPTUTOR_HOME to its workspace.'
IS_DESKTOP_HOME=0
if [ -n "$DESKTOP_HOME" ] && [ "$SELECTED_HOME" = "$DESKTOP_HOME" ]; then
  IS_DESKTOP_HOME=1
fi
say "DeepTutor workspace: $SELECTED_HOME"
if [ "${CHECK_ONLY:-0}" = '1' ]; then exit 0; fi
export DEEPTUTOR_HOME="$SELECTED_HOME"

persist_macos_environment() {
  # launchctl supplies the variable to Magpie GUI processes now. The per-user
  # LaunchAgent restores the same generic rule at each login; no app path is used.
  launchctl setenv DEEPTUTOR_HOME "$SELECTED_HOME"
  AGENT_DIR="$HOME/Library/LaunchAgents"
  AGENT_PLIST="$AGENT_DIR/ai.deeptutor.magpie-environment.plist"
  mkdir -p "$AGENT_DIR"
  # `plutil -insert` fails when a key already exists. Recreate our own plist so
  # reinstalling or updating the plugin is idempotent.
  rm -f "$AGENT_PLIST"
  plutil -create xml1 "$AGENT_PLIST"
  plutil -insert Label -string 'ai.deeptutor.magpie-environment' "$AGENT_PLIST"
  plutil -insert ProgramArguments -array "$AGENT_PLIST"
  plutil -insert ProgramArguments.0 -string '/bin/launchctl' "$AGENT_PLIST"
  plutil -insert ProgramArguments.1 -string 'setenv' "$AGENT_PLIST"
  plutil -insert ProgramArguments.2 -string 'DEEPTUTOR_HOME' "$AGENT_PLIST"
  plutil -insert ProgramArguments.3 -string "$SELECTED_HOME" "$AGENT_PLIST"
  plutil -insert RunAtLoad -bool YES "$AGENT_PLIST"
  plutil -insert LimitLoadToSessionType -string 'Aqua' "$AGENT_PLIST"
  GUI_DOMAIN="gui/$(id -u)"
  launchctl bootout "$GUI_DOMAIN" "$AGENT_PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "$GUI_DOMAIN" "$AGENT_PLIST" >/dev/null 2>&1 || launchctl load "$AGENT_PLIST"
}

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
if [ "$IS_DESKTOP_HOME" -eq 1 ]; then
  # The fixed home link rediscovers the standard desktop workspace every load.
  say 'Installed. Desktop discovery uses the home link; no environment variable or restart is required.'
else
  # Persist only after a successful install and only for explicit CLI/custom homes.
  if [ "$(uname -s)" = 'Darwin' ]; then
    persist_macos_environment
  else
    say 'For later terminal sessions, add this to your shell profile:'
    say "  export DEEPTUTOR_HOME=\"$SELECTED_HOME\""
  fi
  say 'Installed. Restart Magpie so its desktop process inherits DEEPTUTOR_HOME.'
fi
say 'Then:'
say '  1. Magpie -> Agents -> DeepTutor -> pick a model'
say '  2. DeepTutor -> Settings -> model list -> the Magpie profile'
say ""
"$MAGPIE" ls 2>/dev/null | grep -i deeptutor || true
