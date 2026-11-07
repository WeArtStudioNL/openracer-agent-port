#!/usr/bin/env bash
# Builds the WebAssembly of the physics (MACOS-METAL.md, phase M3) into web/js/wasm/.
# Needs clang with the wasm32 target and wasm-ld: brew install llvm lld (Apple's clang has no wasm32).
# The .wasm is in git, so the game and the app need no compiler; run this after a change of a .c file.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../web/js/wasm"
CLANG="${CLANG:-$(ls -d /opt/homebrew/opt/llvm*/bin/clang 2>/dev/null | sort -V | tail -1)}"
WASMLD="${WASMLD:-$(command -v wasm-ld || ls /opt/homebrew/opt/lld*/bin/wasm-ld 2>/dev/null | tail -1)}"
[[ -x "$CLANG" ]] || { echo "No clang with wasm32: brew install llvm" >&2; exit 1; }
[[ -x "$WASMLD" ]] || { echo "No wasm-ld: brew install lld" >&2; exit 1; }
mkdir -p "$OUT"
for src in "$HERE"/*.c; do
    name="$(basename "$src" .c)"
    # -ffp-contract=off: no fused multiply-add, so the numbers are those of the JavaScript to the last bit
    # -fno-builtin: no calls to memset and memcpy (there is no libc)
    "$CLANG" --target=wasm32 -O3 -ffp-contract=off -fno-builtin -nostdlib -fuse-ld="$WASMLD" \
        -Wl,--no-entry -Wl,--initial-memory=33554432 -Wl,--max-memory=1073741824 -Wl,--stack-first -Wl,-z,stack-size=1048576 \
        -o "$OUT/$name.wasm" "$src"
    echo "$OUT/$name.wasm ($(wc -c < "$OUT/$name.wasm" | tr -d ' ') bytes)"
done
