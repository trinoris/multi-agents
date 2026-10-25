#!/usr/bin/env bash
# Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE.
# Manual public npm release. No OTP arguments; see PUBLISHING.md.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/release.mjs "$@"
