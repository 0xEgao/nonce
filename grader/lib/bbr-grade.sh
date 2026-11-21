#!/usr/bin/env bash

set -euo pipefail

source "${LIB_DIR}/grade-lib.sh"

week="${1:?a week directory is required}"
student_src="${STUDENT_DIR}/weeks/${week}/src"
if [ ! -d "$student_src" ]; then
    fail_early 'Rust source directory exists' "Restore weeks/${week}/src from the starter repository and run again."
fi

# Stage only this week's source beside the grader's manifest, lockfile and tests.
# Cargo's working directory sits outside the student's workspace and config.
crate="$(mktemp -d "${TMPDIR:-/tmp}/grade-bbr-XXXXXX")"
trap 'rm -rf "$crate"' EXIT
cp -R "${TEST_DIR}/fixtures/." "$crate/"
cp -R "$student_src" "$crate/src"
cd "$crate"

status=0
cargo test --locked --color never --test assignment_tests -- --format pretty --color never \
    2>&1 | tee cargo-test.log || status=$?
python3 "$REPORT_PY" from-rust cargo-test.log "$REPORT_PATH" "$status"
