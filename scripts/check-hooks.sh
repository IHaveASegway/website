#!/bin/sh
# Runs after every pnpm install (postinstall) and warns, loudly, when this clone's git hooks are
# off. The hooks are the content firewall's local half, and once the repository is public they are
# the only prevention (security.md, "Local parity"). core.hooksPath is set per clone, so a fresh
# clone, a cloud agent's checkout included, starts without them.
#
# It only reads: it never changes git configuration and never fails the install. CI needs no hooks.
[ -z "${CI:-}" ] || exit 0
command -v git >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

if [ "$(git config --get core.hooksPath 2>/dev/null || true)" != .githooks ]; then
  cat >&2 <<'EOF'

  !! The content firewall's git hooks are OFF in this clone: nothing is scanned before a commit or
  !! a push. Turn them on before the first commit:
  !!
  !!     git config core.hooksPath .githooks
  !!
  !! (README.md, Setup, step 3.) AI agents: stop and ask Joseph; never commit without the hooks.

EOF
fi
exit 0
