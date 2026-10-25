#!/usr/bin/env bash
# Rebuild vroom.wasm and vroom.mjs from pinned sources.
#
#   build/build.sh                   writes vroom.mjs, vroom.wasm here
#                                    and refreshes licenses/
#   NATIVE=1 build/build.sh          also builds the native CLIs that
#                                    test/verify.mjs compares against
#   SANITIZE=1 build/build.sh        instead builds an AddressSanitizer +
#                                    UBSan + stack-check variant into
#                                    $WORK/out-sanitize (never shipped)
#   OUT=dir OPT=-Oz LTO=1 ...        other output dir / optimisation
#
# Needs git, python3, ~2 GB free under $WORK (default
# /tmp/vroom-wasm-build) for emsdk; NATIVE=1 also needs make and g++
# (and clang++ with libc++ for the second reference build). Everything
# it downloads goes under $WORK; delete $WORK afterwards to reclaim it.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIST=$(cd "$HERE/.." && pwd)
# shellcheck source=versions.env
source "$HERE/versions.env"

WORK=${WORK:-/tmp/vroom-wasm-build}
JOBS=${JOBS:-$(nproc)}
SANITIZE=${SANITIZE:-0}
# -O3 measured fastest at an acceptable size; README has the numbers
# for -O2, -Os, -Oz and LTO.
OPT=${OPT:--O3}
LTO_FLAG=()
if [ "${LTO:-0}" = 1 ]; then LTO_FLAG=(-flto); fi
if [ "$SANITIZE" = 1 ]; then
  OUT=${OUT:-$WORK/out-sanitize}
  OPT=-O1
else
  OUT=${OUT:-$DIST}
fi
mkdir -p "$WORK" "$OUT"

log() { printf '\n== %s\n' "$*"; }

# 1. Emscripten SDK, pinned.
if [ ! -x "$WORK/emsdk/emsdk" ]; then
  log "cloning emsdk"
  git clone --quiet https://github.com/emscripten-core/emsdk.git "$WORK/emsdk"
fi
log "emsdk $EMSDK_VERSION"
"$WORK/emsdk/emsdk" install "$EMSDK_VERSION" >/dev/null
"$WORK/emsdk/emsdk" activate "$EMSDK_VERSION" >/dev/null
# shellcheck disable=SC1091
source "$WORK/emsdk/emsdk_env.sh" >/dev/null 2>&1
em++ --version | head -1
EM_ROOT=$(dirname "$(command -v em++)")

# 2. VROOM at the pinned tag and commit, plus the one submodule the
#    core needs (rapidjson). cxxopts is only used by main.cpp and
#    polylineencoder only by the routing wrappers; neither is built.
if [ ! -d "$WORK/vroom-upstream/.git" ]; then
  log "cloning VROOM $VROOM_TAG"
  git clone --quiet --depth 1 --branch "$VROOM_TAG" "$VROOM_REPO" "$WORK/vroom-upstream"
  git -C "$WORK/vroom-upstream" submodule update --quiet --init --depth 1 include/rapidjson
fi
got=$(git -C "$WORK/vroom-upstream" rev-parse HEAD)
[ "$got" = "$VROOM_COMMIT" ] || { echo "VROOM commit $got != pinned $VROOM_COMMIT" >&2; exit 1; }
got=$(git -C "$WORK/vroom-upstream/include/rapidjson" rev-parse HEAD)
[ "$got" = "$RAPIDJSON_COMMIT" ] || { echo "rapidjson commit $got != pinned $RAPIDJSON_COMMIT" >&2; exit 1; }

# 3. A fresh patched copy every time, so the build never depends on
#    leftovers.
log "applying patches"
rm -rf "$WORK/vroom-wasm"
cp -a "$WORK/vroom-upstream" "$WORK/vroom-wasm"
for p in "$HERE"/0*.patch; do
  echo "$(basename "$p")"
  git -C "$WORK/vroom-wasm" apply "$p"
done
cp "$HERE/vroom_wasm.cpp" "$WORK/vroom-wasm/src/vroom_wasm.cpp"

# 4. Source list: exactly what upstream src/makefile builds with
#    USE_ROUTING=false and no GLPK, minus main.cpp (the CLI), plus the
#    wasm entry points. No routing/*.cpp file is compiled, so no asio,
#    no sockets, no HTTP.
cd "$WORK/vroom-wasm/src"
python3 -I - > "$WORK/sources.txt" <<'PY'
import glob
pats = ["*.cpp", "algorithms/*.cpp", "algorithms/*/*.cpp", "routing/*.cpp",
        "problems/*.cpp", "problems/*/*.cpp", "problems/*/*/*.cpp",
        "structures/generic/*.cpp", "structures/vroom/*.cpp",
        "structures/vroom/input/*.cpp", "structures/vroom/solution/*.cpp",
        "structures/*.cpp", "utils/*.cpp"]
drop = {"main.cpp", "algorithms/validation/check.cpp",
        "algorithms/validation/choose_ETA.cpp"}
seen = []
for p in pats:
    for f in sorted(glob.glob(p)):
        if f.startswith("routing/") or f in drop or f in seen:
            continue
        seen.append(f)
print("\n".join(seen))
PY
echo "$(wc -l < "$WORK/sources.txt") translation units"

# 5. Compile. -fwasm-exceptions: VROOM reports every input error by
#    throwing, so exceptions must work; native Wasm exception handling
#    is smaller and faster than the JS-emulated kind.
CXXFLAGS=(-std=c++20 "$OPT" "${LTO_FLAG[@]}" -DNDEBUG -DASIO_STANDALONE -DUSE_ROUTING=false
          -fwasm-exceptions -I. -Wall -Wextra -Wpedantic)
SAN_FLAGS=()
if [ "$SANITIZE" = 1 ]; then
  # AddressSanitizer stops at the first error. UBSan reports each site
  # once and carries on, so one run lists every site hit; verify.mjs
  # fails if any is in code these patches touch.
  SAN_FLAGS=(-fsanitize=address,undefined)
  CXXFLAGS+=("${SAN_FLAGS[@]}")
fi
log "compiling with ${CXXFLAGS[*]}"
OBJ="$WORK/obj"
rm -rf "$OBJ"
export OBJ
export CXXFLAGS_STR="${CXXFLAGS[*]}"
# shellcheck disable=SC2016
xargs -P "$JOBS" -I{} sh -c 'o="$OBJ/$(echo "{}" | sed "s/\.cpp$/.o/")"; mkdir -p "$(dirname "$o")"; em++ $CXXFLAGS_STR -c "{}" -o "$o"' < "$WORK/sources.txt"

# 6. Link. One ES module factory plus one .wasm file. No pthreads, no
#    filesystem, no eval or new Function. The only fetch is the glue
#    loading vroom.wasm from next to itself (browser) or reading it
#    from disk (Node).
LDFLAGS=("$OPT" "${LTO_FLAG[@]}" -fwasm-exceptions
         -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createVroomModule
         -sENVIRONMENT=web,worker,node
         -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB
         -sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 -sSUPPORT_LONGJMP=0
         -sTEXTDECODER=2 -sPOLYFILL=0
         -sINCOMING_MODULE_JS_API=locateFile,wasmBinary,print,printErr
         -sEXPORTED_FUNCTIONS=_vroom_solve,_vroom_version,_malloc,_free
         -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8)
if [ "$SANITIZE" = 1 ]; then
  LDFLAGS+=("${SAN_FLAGS[@]}" -sASSERTIONS=2 -sSTACK_OVERFLOW_CHECK=2)
fi
log "linking with ${LDFLAGS[*]}"
mapfile -t objs < <(sed "s#^#$OBJ/#; s#\.cpp\$#.o#" "$WORK/sources.txt")
if [ "$SANITIZE" = 1 ]; then
  em++ "${CXXFLAGS[@]}" -c "$HERE/sanitize_options.cpp" -o "$OBJ/sanitize_options.o"
  objs+=("$OBJ/sanitize_options.o")
fi
em++ "${LDFLAGS[@]}" "${objs[@]}" -o "$OUT/vroom.mjs"
if [ "$OUT" != "$DIST" ]; then
  cp "$DIST/vroom-solver.mjs" "$DIST/vroom-worker.mjs" "$OUT/"
fi

log "outputs in $OUT"
for f in "$OUT/vroom.mjs" "$OUT/vroom.wasm"; do
  printf '%-11s %8d B  sha256 %s\n' "$(basename "$f")" "$(wc -c < "$f")" "$(sha256sum "$f" | cut -d' ' -f1)"
done

# 7. Licence texts for everything compiled into vroom.wasm/vroom.mjs,
#    taken from the exact sources used.
if [ "$SANITIZE" != 1 ]; then
  L="$OUT/licenses"
  mkdir -p "$L"
  cp "$WORK/vroom-upstream/LICENSE" "$L/VROOM-BSD-2-Clause.txt"
  cp "$WORK/vroom-upstream/include/rapidjson/license.txt" "$L/RapidJSON-MIT.txt"
  cp "$EM_ROOT/LICENSE" "$L/Emscripten-MIT-or-NCSA.txt"
  cp "$EM_ROOT/system/lib/libcxx/LICENSE.TXT" "$L/LLVM-libcxx-Apache-2.0-WITH-LLVM-exception.txt"
  cp "$EM_ROOT/system/lib/libcxxabi/LICENSE.TXT" "$L/LLVM-libcxxabi-Apache-2.0-WITH-LLVM-exception.txt"
  cp "$EM_ROOT/system/lib/compiler-rt/LICENSE.TXT" "$L/LLVM-compiler-rt-Apache-2.0-WITH-LLVM-exception.txt"
  cp "$EM_ROOT/system/lib/libc/musl/COPYRIGHT" "$L/musl-MIT.txt"
  echo "licences refreshed in $L"
fi

# 8. Optional native reference builds for test/verify.mjs.
#    gcc:          upstream, unpatched, built exactly as upstream's
#                  makefile builds it (g++ and libstdc++).
#    clang-libcxx: upstream plus patch 0001 only (without it no libc++
#                  build compiles), clang++ and libc++: the same C++
#                  standard library family as Emscripten.
if [ "${NATIVE:-0}" = 1 ]; then
  # The CLI's option parser; only main.cpp uses it.
  git -C "$WORK/vroom-upstream" submodule update --quiet --init --depth 1 include/cxxopts
  got=$(git -C "$WORK/vroom-upstream/include/cxxopts" rev-parse HEAD)
  [ "$got" = "$CXXOPTS_COMMIT" ] || { echo "cxxopts commit $got != pinned $CXXOPTS_COMMIT" >&2; exit 1; }
  log "native reference: gcc (unpatched)"
  rm -rf "$WORK/vroom-native"
  cp -a "$WORK/vroom-upstream" "$WORK/vroom-native"
  make -C "$WORK/vroom-native/src" USE_ROUTING=false -j"$JOBS" >/dev/null
  "$WORK/vroom-native/bin/vroom" -v
  if echo 'int main(){}' | clang++ -x c++ -std=c++20 -stdlib=libc++ - -o /dev/null 2>/dev/null; then
    log "native reference: clang-libcxx (patch 0001)"
    rm -rf "$WORK/vroom-native-libcxx"
    cp -a "$WORK/vroom-upstream" "$WORK/vroom-native-libcxx"
    git -C "$WORK/vroom-native-libcxx" apply "$HERE/0001-vrp-include-semaphore.patch"
    make -C "$WORK/vroom-native-libcxx/src" USE_ROUTING=false -j"$JOBS" \
      CXX="clang++ -stdlib=libc++ -fexperimental-library" >/dev/null
    "$WORK/vroom-native-libcxx/bin/vroom" -v
  else
    echo "clang++ with libc++ not found: skipping the clang-libcxx reference"
  fi
fi
