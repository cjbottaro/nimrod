#!/usr/bin/env bash
# Opt-in installation. Never overwrite another command or edit shell configuration.
set -euo pipefail
[[ $# -le 1 ]] || { printf '%s\n' 'Usage: scripts/install-cli.sh [BIN_DIRECTORY]' >&2; exit 1; }
repo=$(CDPATH= cd -P -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
launcher=$repo/bin/nimrod
bin=${1:-$HOME/.local/bin}
mkdir -p -- "$bin"
bin=$(CDPATH= cd -P -- "$bin" && pwd -P)
destination=$bin/nimrod
if [[ -e $destination || -L $destination ]]; then
  if [[ ! -L $destination || $(readlink "$destination") != "$launcher" ]]; then
    printf 'Refusing to overwrite %s. Remove or relocate it explicitly first.\n' "$destination" >&2
    exit 1
  fi
else
  ln -s -- "$launcher" "$destination"
fi
printf 'Installed %s\nEnsure %s is on PATH. Shell configuration was not changed.\n' "$destination" "$bin"
