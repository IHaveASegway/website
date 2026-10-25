# VROOM in WebAssembly

The real VROOM solver, version 1.15.0, compiled with Emscripten 6.0.13 for matrix-only input on one thread. It ships as one 919,927 B `vroom.wasm` (248,655 B brotli, 343,650 B gzip) and an 8,403 B ES module. It runs in a module Web Worker under `script-src 'self' 'wasm-unsafe-eval'`: no `eval`, no `new Function`, no network access apart from fetching its own `.wasm`.

It returns the same answers as native VROOM. On 46 cases (7 inputs at every exploration level 0–5, a 200-stop input at level 0, and 3 error inputs) its output is byte-identical to a native clang/libc++ build. Against the unpatched upstream g++ build, the only difference is the order of the top-level `unassigned` list, in 12 cases. Under AddressSanitizer, UBSan and a stack-overflow check it is still byte-identical, with 0 memory errors.

Solving 25 jobs with 3 vans takes 140 ms in Node at the default exploration level 5. Solving 60 jobs with 4 vans takes 1,254 ms. By VROOM's own timings that is 1.0–1.3× as long as native single-threaded VROOM. Wasm memory stays at 17.2 MiB over 243 solves in one module.

Built and measured on 2026-10-24 and 2026-10-25, Linux x86-64, 4 CPUs, Node 22.22.0, headless Chromium 153.0.8010.12.

## Prior art: none to reuse

- npm has no package: `vroom-wasm` returns 404. Searches for "vroom wasm", "vrp wasm" and "vroom emscripten" find nothing related. `vroom@1.0.2` is an unrelated package, and `@fleetbase/vroom-engine` is a server-side Fleetbase extension.
- VROOM-Project/vroom issue #690, "wasm (webassembly)", was opened on 2022-03-28 and closed as stale on 2022-05-11. The maintainer wrote that, as far as he knew, nobody had tried a port. He also noted that VROOM only makes HTTP calls (through asio) when no matrices are given. No fork, branch or build is linked from it.
- The project's own interfaces are the CLI, vroom-express (HTTP), pyvroom (Python) and a Docker image. None of them runs in a browser.

So this build compiles upstream VROOM directly.

## Files

| File               | What it is                                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vroom.wasm`       | The solver. Its only imports are abort, a clock, a timer, heap resize and two environment-string calls. It has no socket, file or fetch imports.          |
| `vroom.mjs`        | The Emscripten ES module factory: `MODULARIZE`, `EXPORT_ES6`, `export default createVroomModule`. It runs on the web, in a worker and in Node.            |
| `vroom-solver.mjs` | A 1,328 B wrapper: `createVroom()` gives `{ version, solve(input, opts), solveJson(text, opts) }`.                                                        |
| `vroom-worker.mjs` | A 1,002 B module worker: post `{ id, input, options }`, receive `{ id, output, ms, version }`.                                                            |
| `build/`           | `build.sh`, `versions.env`, three patches, `vroom_wasm.cpp` (the entry point) and `sanitize_options.cpp` (sanitizer build only).                          |
| `test/`            | Fixture generator, native comparison (`verify.mjs`), browser test, memory check, sizes, benchmark, `run-all.sh`, and the last results in `test/results/`. |
| `licenses/`        | Licence texts for everything compiled in (see Licences).                                                                                                  |

## API

```js
import { createVroom } from './vroom-solver.mjs';
const vroom = await createVroom();
const out = vroom.solve(
  {
    vehicles: [
      { id: 1, start_index: 0, end_index: 0, capacity: [12], time_window: [25200, 46800] },
    ],
    jobs: [
      { id: 7, location_index: 1, service: 180, delivery: [1], time_windows: [[28800, 36000]] },
    ],
    matrices: {
      car: {
        durations: [
          [0, 600],
          [600, 0],
        ],
        distances: [
          [0, 5200],
          [5200, 0],
        ],
      },
    },
  },
  { explorationLevel: 5 },
);
// out is VROOM's output object, exactly what `vroom` prints:
// out.code, out.summary.{cost,duration,distance,...}, out.routes[].steps[], out.unassigned[]
```

- The input is VROOM's own JSON format (VROOM `docs/API.md`). Every location must be an index into `matrices` (or the legacy `matrix`). `durations` is required; `distances` and `costs` are optional. Several profiles work.
- `explorationLevel` is the CLI's `-x` (0–5, default 5). `timeoutMs` is the CLI's `-l` in milliseconds; leave it out, or pass a negative number, for no limit. The limit is a C `int`: since 2026-10-25 `vroom-solver.mjs` clamps a larger one to 2^31 − 1 ms, where `| 0` had wrapped it negative, which means no limit.
- Errors do not throw. You get VROOM's own `{ code, error }`: code 2 for bad input; code 3, "VROOM compiled without routing support.", if a location has coordinates but no matrix index.
- The underlying C export is `const char* vroom_solve(const char* json, int exploration_level, int timeout_ms)`. `vroom_version()` returns `"1.15.0"`.
- Not in this build: routing engines (OSRM, ORS, Valhalla), `-g` route geometry, `-c` check mode (it needs GLPK), the debug `-f` TSPFix and more than one thread.

## What changed in VROOM, and why

77 translation units are compiled: exactly the files upstream's `src/makefile` builds with `USE_ROUTING=false` and no GLPK, minus `main.cpp`. No `routing/*.cpp` file is compiled, so asio, HTTP and sockets are never reached. `vroom_wasm.cpp` takes the place of `main.cpp`: it parses the input, calls `Input::solve(level, 1, timeout)` and serialises with VROOM's own `io::to_json` and the same rapidjson `Writer` the CLI uses.

Three patches, applied in order (`git apply`):

1. `0001-vrp-include-semaphore.patch` (+1 line). `problems/vrp.h` uses `std::counting_semaphore` without `#include <semaphore>`. libstdc++ hides this through transitive includes, but no libc++ build compiles without the include. I checked natively: clang 18 with libc++ 18 fails on upstream with "no member named 'counting_semaphore'". This could go upstream.
2. `0002-tw-route-libcxx-array-iterator.patch`. `structures/vroom/tw_route.cpp` explicitly instantiates two templates for both `std::vector<Index>::const_iterator` and `std::array<Index, 1>::const_iterator`. Under libc++ ABI v2, which Emscripten uses, those are the same type, so the code fails with "duplicate explicit instantiation". A type alias now keeps the original type whenever the two types differ; when they are identical it falls back to `const Index*`, an unused instantiation. Under libstdc++ and libc++ ABI v1 nothing changes. This could also go upstream.
3. `0003-inline-jthread-without-pthreads.patch`. VROOM starts a `std::jthread` per search, per matrix profile and per TSP look-up range, even with one thread. Without `-pthread`, Emscripten's `pthread_create` returns EAGAIN, so every solve would throw. The patch adds `src/utils/thread_compat.h` and swaps `std::jthread` for `compat::jthread` at its 9 uses. Only in an Emscripten build without pthreads does `compat::jthread` run the callable to completion in its constructor, after decay-copying the arguments as `std::thread` does; there `join()` does nothing. In every other build it is `using jthread = std::jthread;`.

Two side effects of patch 3:

- **Deterministic answers.** Searches run in rank order. Native VROOM is not deterministic even with `-t 1`. It starts every search thread at once and they queue on a semaphore in OS order. When two searches build starting solutions that score the same, only the first to get there goes on to local search (`problems/vrp.h`), so the thread order decides the routes. On `03-vrptw-25x3` at `-x 1`, 100 native runs gave 2 different answers of equal cost (vans 1 and 2 swap routes): 69/31 with g++ and 43/57 with clang. 100 wasm runs gave 1 answer. `verify.mjs` therefore reruns the native CLI up to 20 times until one run matches. In the recorded runs the first native run always matched.
- **Errors come back as JSON.** An exception that escapes a thread body becomes VROOM's JSON error instead of `std::terminate`. VROOM's search and matrix thread bodies already catch their own exceptions, so this only matters on an error path.

## Build

From the repository root:

```sh
tools/vroom-wasm/build/build.sh             # tools/vroom-wasm/vroom.{mjs,wasm}, licenses/
NATIVE=1 tools/vroom-wasm/build/build.sh    # plus the two native reference CLIs
SANITIZE=1 tools/vroom-wasm/build/build.sh  # ASan + UBSan + stack check build in $WORK/out-sanitize
tools/vroom-wasm/test/run-all.sh            # every check below
node tools/vroom-wasm/install.mjs           # into the site, with its lock (Install, below)
rm -rf /tmp/vroom-wasm-build                # reclaim ~2 GB when done
```

`vroom.mjs` and `vroom.wasm` land next to the wrappers, where the tests import them, and git ignores them there: the one committed copy is the site's.

Pinned in `build/versions.env`:

| Input                       | Version                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| VROOM                       | v1.15.0, commit `43dd7d0b8b560431eb555bf335cf4797eb7343c4` (2026-03-12), the latest release on 2026-10-24                |
| rapidjson (VROOM submodule) | `973dc9c06dcd3d035ebd039cfb9ea457721ec213`                                                                               |
| cxxopts (native CLI only)   | `eb787304d67ec22f7c3a184ee8b4c481d04357fd`                                                                               |
| Emscripten SDK              | 6.0.13, the "latest" on 2026-10-24 (clang 24.0.0git `83ee07799c34`, binaryen version_133)                                |
| Native references           | g++ 13.3.0 with libstdc++ (Ubuntu 24.04); clang 18.1.3 with libc++ 18 (`apt-get install libc++-18-dev libc++abi-18-dev`) |

The script downloads everything under `$WORK` (default `/tmp/vroom-wasm-build`), checks each commit hash, applies the patches to a fresh copy and compiles the 77 files in parallel. Compile flags: `-std=c++20 -O3 -DNDEBUG -DUSE_ROUTING=false -fwasm-exceptions`. It then links:

```
-O3 -fwasm-exceptions -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createVroomModule
-sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1MB
-sFILESYSTEM=0 -sDYNAMIC_EXECUTION=0 -sSUPPORT_LONGJMP=0 -sTEXTDECODER=2 -sPOLYFILL=0
-sINCOMING_MODULE_JS_API=locateFile,wasmBinary,print,printErr
-sEXPORTED_FUNCTIONS=_vroom_solve,_vroom_version,_malloc,_free
-sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToNewUTF8
```

The build is reproducible. Three builds from fresh copies produced the same bytes:

- `vroom.wasm` sha256 `60086074ad9ffd3bfcf5afb053bdbd479e0356128b373c0e30dc9fa95f43af51`
- `vroom.mjs` sha256 `c50b16cb3418cc2dbc7ffa027e6a4781ae02fba16e672a7cf7f1b27754238d18`

A full build takes about 2.5 minutes on 4 CPUs once emsdk is installed.

**For the next rebuild.** The heap may grow to WebAssembly's 2 GiB, as `-sALLOW_MEMORY_GROWTH=1` allows with no maximum. The page's largest day peaks at 17 MiB, and the solver runs in a worker the page stops after 15 s, so a runaway heap costs only that worker; still, the next build should add `-sMAXIMUM_MEMORY=256MB` (security review, 2026-10-25). It changes the binary, so the lock, the golden solve and the sizes move with it, which is why it waits for a rebuild rather than shipping alone.

`-fwasm-exceptions` uses Wasm's own exception handling, which is smaller and faster than JS-emulated exceptions. VROOM needs exceptions because it reports every input error by throwing. One build serves web, worker and Node, so the tests exercise the same bytes that ship; the Node branch of the glue never runs in a browser.

## Install

`install.mjs` copies a build into the website at `apps/web/public/lab/routes/solver/vroom-<version>-<sha8>/`: `vroom.wasm`, `vroom.mjs`, the two wrappers from this folder, and `LICENSES.txt`, every licence text from `licenses/` under one header each. The folder is named for VROOM's version and the first 8 hex digits of a SHA-256 over all five files, the licence text included, so its URL changes whenever any byte does and `_headers` can cache it as immutable (until 2026-10-25 the hash read only the four code files, so a change to the licences alone would have kept a stale copy cached for a year). The script removes any other solver folder, so exactly one ships, and writes `apps/web/src/lib/route-lab/solver.lock.json`: the pinned versions, each file's size and SHA-256, the module's imports and exports, and the source paths left in its strings. `apps/web/test/wasm.test.ts` holds `dist/` to that lock and solves a known day from the shipped bytes ([ADR 0016](../../docs/adr/0016-route-lab-in-the-browser.md)).

```sh
node tools/vroom-wasm/install.mjs [<directory with vroom.mjs and vroom.wasm>]
```

The directory defaults to this folder. A new build that answers differently changes the golden solve in `wasm.test.ts` in the same pull request as the lock.

## Verification

All checks pass. The last full run of `test/run-all.sh` took 6 min 38 s on 2026-10-25; its results are in `test/results/`.

| Check                                                                                                                                    | Result                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Fixtures regenerate to the recorded bytes (`gen-fixtures.mjs`, seeded; `test/fixtures.sha256`)                                           | pass                                                                                                                                 |
| wasm vs unpatched upstream g++ CLI, `-t 1`, timings removed: 7 inputs × levels 0–5, the 200-stop input at x=0, 3 error inputs (46 cases) | 34 byte-identical, 12 differ only in the order of `unassigned`, 0 other differences                                                  |
| wasm vs clang/libc++ CLI (upstream plus patch 0001), same 46 cases                                                                       | 46 byte-identical                                                                                                                    |
| AddressSanitizer + UBSan + `STACK_OVERFLOW_CHECK=2` + `ASSERTIONS=2` build vs clang/libc++                                               | 46 byte-identical, 0 ASan reports, 0 stack overflows; 1 UBSan site, upstream, outside patched code (below)                           |
| Native `-t 4` at `-x 5` vs wasm, one run each                                                                                            | same answer on all 7 solvable inputs                                                                                                 |
| Same input solved twice in one module                                                                                                    | identical every time                                                                                                                 |
| `timeoutMs: 250` on 60 jobs × 4 vans at x=5                                                                                              | returns in 252–262 ms with a valid solution (cost 35,828–36,064 vs 35,088 untimed; a timed solve depends on the clock, so it varies) |
| 200 jobs × 8 vans (201 × 201 matrix, 452 KB of JSON)                                                                                     | solves, same as native                                                                                                               |
| Headless Chromium 153, module worker, 4 CSP combinations (below)                                                                         | every combination behaves as expected; all 8 browser answers equal Node's                                                            |
| Memory (`memory.mjs`): 30 solves of 25×3 at x=5, 10 of 60×4 at x=5, 200 of 60×4 at x=0, 3 of 200×8, one module                           | wasm memory stays 17.2 MiB throughout (no growth, no leak)                                                                           |

The inputs (`test/fixtures/`, written by `node test/gen-fixtures.mjs` and not committed; `run-all.sh` writes them first and checks them against `test/fixtures.sha256`, and the other test scripts read them from there), all synthetic, around a depot in Seattle, with matrices from straight-line distance × 1.3 at trip-length-dependent speeds:

1. `01-tsp-12`: 1 van, 12 stops, durations only (VROOM's TSP path).
2. `02-cvrp-20x2`: 2 vans with capacity, 20 stops, durations and distances.
3. `03-vrptw-25x3`: 3 vans, shift windows, job time windows, capacities, service times; 3 jobs cannot fit.
4. `04-shipments-breaks`: pickup-and-delivery shipments, 30-minute breaks, skills, priorities, `max_tasks`, per-van `fixed`, `per_hour` and `per_km` costs.
5. `05-unassigned-profiles`: two profiles (car and a slow "bike" matrix), different start and end places, a van with no end; 11 jobs cannot fit.
6. `bench-25x3`, `bench-60x4`: the benchmark inputs.
7. `big-200x8`: run at x=0 only.
8. Three error inputs: coordinates only, a matrix too small and text that is not JSON.

Why `unassigned` order differs from the g++ build: VROOM builds that list by iterating a `std::unordered_set` (`src/utils/helpers.cpp`). Iteration order is up to the standard library. libc++ (clang, Emscripten) and libstdc++ (g++) list the same jobs in a different order. The clang/libc++ comparison shows that is the only difference.

The UBSan site is upstream code that the patches do not touch: `algorithms/heuristics/heuristics.cpp:195`, a signed 64-bit overflow when an insertion lower bound adds a cost to the "infinite" sentinel. It wraps the same way natively and in wasm, so answers still match. It is worth reporting upstream.

## Sizes

| File             |   Raw B | gzip -9 B | brotli 11 B |
| ---------------- | ------: | --------: | ----------: |
| vroom.wasm       | 919,927 |   343,650 |     248,655 |
| vroom.mjs        |   8,403 |     3,122 |       2,824 |
| vroom-solver.mjs |   1,328 |       624 |         538 |
| vroom-worker.mjs |   1,002 |       493 |         421 |
| total            | 930,660 |   347,889 |     252,438 |

Measured with Node zlib by `test/sizes.mjs`. gzip(1) `-9` gives 340,799 B for the wasm.

Other optimisation levels, same patches and flags:

| Build         | wasm raw B | gzip -9 B | brotli 11 B | 25×3 x=5 ms | 60×4 x=5 ms |
| ------------- | ---------: | --------: | ----------: | ----------: | ----------: |
| -O3 (shipped) |    919,927 |   343,650 |     248,655 |         157 |       1,257 |
| -O2           |    995,603 |   358,428 |     262,918 |         143 |       1,257 |
| -Os           |    759,400 |   284,540 |     213,292 |         198 |       1,689 |
| -Oz           |    619,786 |   252,618 |     192,287 |         248 |       2,336 |
| -O3 -flto     |  1,008,177 |   379,285 |     272,845 |         135 |       1,183 |
| -Os -flto     |    839,458 |   316,424 |     237,545 |         166 |       1,563 |

-O3 is shipped. -Oz would save 56 KB brotli but nearly doubles the 60-stop solve. LTO is 6% faster and 10% bigger. Times here are medians of 5 runs in one comparison session; run-to-run noise is about 10%.

## Solve times

Node 22.22.0, one solve after a warm-up, median of 5. "wasm wall" is the time around `solveJson`, including copying the JSON in and out. "native" is VROOM's own reported loading plus solving time for `vroom -t 1`. Module start-up (compile and instantiate from disk) is 10.7 ms.

| Input            |   x |   Cost | wasm wall ms | native g++ ms | native clang ms |
| ---------------- | --: | -----: | -----------: | ------------: | --------------: |
| 25 jobs × 3 vans |   0 | 16,084 |         10.0 |             7 |               7 |
| 25 jobs × 3 vans |   2 | 16,084 |         30.7 |            28 |              26 |
| 25 jobs × 3 vans |   5 | 16,084 |        140.5 |           122 |             115 |
| 60 jobs × 4 vans |   0 | 35,390 |         80.4 |            69 |              70 |
| 60 jobs × 4 vans |   2 | 35,179 |        288.1 |           233 |             224 |
| 60 jobs × 4 vans |   3 | 35,172 |        468.3 |           402 |             391 |
| 60 jobs × 4 vans |   5 | 35,088 |      1,253.8 |         1,076 |           1,026 |

All levels are in `test/results/bench.json`. In the Chromium module worker, single solves with no warm-up take about the same: 128–194 ms for 25×3 at x=5 and 1,091–1,162 ms for 60×4 at x=5, over the four passing runs in two sessions.

## Browser and CSP

| Page response CSP           | Worker response CSP         | Result                |
| --------------------------- | --------------------------- | --------------------- |
| `'self' 'wasm-unsafe-eval'` | `'self' 'wasm-unsafe-eval'` | solves, 0 violations  |
| `'self'`                    | `'self' 'wasm-unsafe-eval'` | solves, 0 violations  |
| `'self' 'wasm-unsafe-eval'` | `'self'`                    | CompileError: blocked |
| `'self'`                    | `'self'`                    | CompileError: blocked |

In every row the policy is `default-src 'none'; script-src …; worker-src 'self'; connect-src 'self'`.

Only the worker script's own response (`vroom-worker.mjs`) needs `'wasm-unsafe-eval'`, because a worker takes its CSP from its own response, not from the page. The page that starts the worker can keep its current policy, provided it allows `worker-src 'self'` (or a `script-src` that `worker-src` falls back to). A `<meta>` CSP on the page does not reach the worker, so the worker's header must be set for its path (for example in `_headers`). A header policy that matches the worker's path as well, such as the website's page policy on `/*` since 2026-10-25, must be detached there first (`! Content-Security-Policy`): two policies on one response are both enforced, and one without `'wasm-unsafe-eval'` blocks the compile, as in the last two rows ([ADR 0018](../../docs/adr/0018-page-policy-as-a-header.md)). `vroom.wasm` must be served as `application/wasm`, which streaming compilation needs; the glue falls back to an ArrayBuffer compile if not. The worker also needs `connect-src 'self'` to fetch the `.wasm`.

The module uses legacy Wasm exception handling, bulk-memory operations, non-trapping float-to-int, sign extension and BigInt integration. By the webassembly.org feature table that means Chrome 95, Firefox 100, Safari 15.2 and Node 17 or later; exception handling sets those limits. Module workers and `'wasm-unsafe-eval'` add their own minimum versions, which I did not check here. Only Chromium was tested; Firefox and Safari were not available in this container.

## Notes for the demo page

- **Cost.** $0 at runtime. Everything runs in the visitor's browser and the files are static. The download is 252 KB brotli.
- **Unused vans.** VROOM minimises total cost (travel time by default) and may leave a van at home: on `bench-25x3` it used 2 of the 3 vans offered. Say so ("VROOM needed 2 of your 3 vans") rather than forcing work onto a van. Vehicle shift windows or `max_tasks` are the honest way to make every van work.
- **The "order the orders came in" baseline.** VROOM cannot price a fixed route in this build: check mode needs GLPK. Compute the baseline in page JS from the same matrix: the sum of durations along the arrival order, plus service times.
- **Exploration level.** At x=5, 25 stops take about 140 ms and 60 stops about 1.25 s. At x=2 the 60-stop answer is 0.26% worse and takes 0.29 s. Either works with a progress state.
- **Matrices.** Use integer seconds and integer metres. A 60-stop matrix with distances is 44 KB of JSON. Send a fresh matrix built from the precomputed road data.
- **Vans with no end location.** Give every van `start_index` and `end_index` at the bakery. A van with no start or no end is the shape that reaches the upstream overflow above: its lower bound stays at the sentinel while its route is empty.

## Licences

| Component                                                                         | Licence                            | Text                                  |
| --------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------- |
| VROOM                                                                             | BSD-2-Clause                       | `licenses/VROOM-BSD-2-Clause.txt`     |
| RapidJSON (only MIT code is compiled; its JSON-licensed `bin/jsonchecker` is not) | MIT                                | `licenses/RapidJSON-MIT.txt`          |
| Emscripten runtime and JS glue                                                    | MIT or University of Illinois/NCSA | `licenses/Emscripten-MIT-or-NCSA.txt` |
| LLVM libc++, libc++abi, compiler-rt                                               | Apache-2.0 WITH LLVM-exception     | `licenses/LLVM-*.txt`                 |
| musl libc (Emscripten's libc)                                                     | MIT                                | `licenses/musl-MIT.txt`               |
| dlmalloc (Emscripten's malloc)                                                    | Public domain (CC0)                | header of `system/lib/dlmalloc.c`     |
| The three patches, `vroom_wasm.cpp`, the JS wrappers and the tests                | Offered under VROOM's BSD-2-Clause |                                       |

Redistributing `vroom.wasm` must keep the VROOM and RapidJSON notices; shipping `licenses/` next to it, or linking to it from the page, does that. `build.sh` copies these texts from the exact sources it builds. No map data is involved here.
