# ADR 0017: The firewall reads WebAssembly

Status: Proposed · 2026-10-25 · Deciders: Joseph Peterson

## Context

The content firewall ([ADR 0007](0007-content-firewall.md)) refuses, with exit 2, every file whose first bytes name a format no rule can read: archives, Office documents, executables and, until this record, WebAssembly (`\0asm`). gitleaks skips any file it types as `application/*`, so refusing was the only way to fail closed on one.

[ADR 0016](0016-route-lab-in-the-browser.md) put a WebAssembly module in the site: the Route Lab's solver, `vroom.wasm`, VROOM 1.15.0 compiled by `tools/vroom-wasm/`, 919,927 B, in `apps/web/public/lab/routes/solver/vroom-1.15.0-870d7d5e/` and so in `dist/`. Since it merged, the `firewall` job on `main` exits 2 on it ("a file no rule can read", in the tracked tree), and nothing deploys.

A module is not opaque the way an archive is. The binary format is a header and a list of sections, each an id and a length, and the parts that hold text are laid out for any reader: custom sections, each a name and bytes; the names a module imports and exports; and data segments, where a compiled program keeps its string literals. `test/wasm.test.ts` already reads the shipped module's strings for the site's held names. The firewall's rules never read it.

On 2026-10-25 Joseph approved teaching the firewall to read WebAssembly instead of refusing it. Everything else on the refuse list stays refused.

## Decision

`scripts/firewall/check.sh` reads a WebAssembly module wherever it finds one, by its first bytes, whatever the file is called: in the tracked tree, in `dist/` and in the staged files (surface 5), and in every file a commit range or the history adds (`--range`, `--history` and CI's range), since the git scan sees a module only as raw bytes. It writes the module's text to a file and scans it with the rules through `gitleaks stdin`, as it does a PDF's text.

### What it reads

- **Every custom section**, whatever its name (`name`, `producers`, `sourceMappingURL`, `target_features` or any other): the name, then the bytes.
- **Every import's module and name, and every export's name.**
- **Every data segment's bytes**, active or passive.

Each becomes a line of text. Control bytes (0x00 to 0x1f, and 0x7f) become line breaks, so each string stands alone; bytes from 0x80 stay, so a UTF-8 name reads whole. Names are cut at their declared lengths, so a length byte never joins the name after it: read as raw bytes, a name 65 bytes long starts with the letter `A`, and no rule's `\b` holds before a term at its start. The other sections (type, function, table, memory, tag, global, start, element, data count and code) are stepped over by their declared lengths.

The reader fails closed, exit 2, on anything it does not expect: a version other than 1; a section id outside WebAssembly 3.0's 0 to 13, a section out of order, or one twice; a length past the end of its section or of the file; a LEB128 cut short, or longer than its type allows; an import, export, data segment or offset expression of a kind it does not know; bytes left over at the end of a section, or after the last one; a module larger than 8 MiB, or with more than 20,000 strings (names, custom sections and data segments; below). `vroom.wasm` parses end to end, and its text came out byte for byte the same as an independent reader's (a Python script, run once, not committed) on 2026-10-25.

The scan carries a known answer. gitleaks types the first bytes of what it reads and silently skips whatever it types as `application/*`; with 8.30.1 on 2026-10-25, text with `ustar` at byte 257 passed unread with exit 0, a term in it. Text taken from a binary could look like that by chance. So the text opens with a fixed line, and closes with the run's canary, which gitleaks must report on that line or the scan exits 2. A canary-shaped string elsewhere in a module is still a finding.

### Why bash and od

The reader is bash with `od`, `dd` and `tr`, POSIX tools in every base system that the hooks and CI have (the canary is already made with `od`). Nothing else the hooks and CI all have can read bytes: `jq` reads only JSON, node is optional for the pre-commit hook and not set up in the `firewall` job, and python is not on every Mac. `od` prints a window of the file as hex pairs into an array, and text goes out through `printf`'s `\x` escapes, or, for a run of 512 bytes or more, through `dd`, which seeks to the run, so no byte is ever held in a shell variable as itself and no run costs more than its own length. It costs speed: `vroom.wasm` reads in about 1.6 s on Linux with bash 5.2 (2026-10-25), and CI reads it twice, in the tree and in `dist/`.

### Two caps on what it reads

Bash spends a few microseconds on every string and on every byte of a short one, so the reader's time depends on a module's shape as well as its size. A review of this change on 2026-10-25 measured a module of many tiny sections reading at about 2,000 sections a second, so a crafted one of a few MiB would outrun the `firewall` job's 10-minute timeout. That fails closed, but as a timeout instead of a verdict. So the reader refuses, with exit 2, a module larger than 8 MiB (`WASM_MAX`, 9 times `vroom.wasm`) or with more than 20,000 strings, counting names, custom sections and data segments (`WASM_STRINGS`, 17 times the 1,145 in `vroom.wasm`).

Inside both caps the slowest shape is a module made only of strings just under 512 bytes, the longest the reader copies byte by byte: 8 MiB of 511-byte data segments reads in 90 s, about 11 s per MiB. 20,000 one-byte segments read in 5.5 s, and `vroom.wasm`, 919,927 bytes of mostly long runs, in 1.6 s (Linux, bash 5.2, 4 CPUs, 2026-10-25). CI reads a module in the tree, in `dist/`, and once for each version of it in the range. A real module past either cap raises it in a new record, with these timings measured again.

### What it still cannot see

- **Compiled code is not text.** A function can build a string at run time: from arithmetic, from bytes spread over several segments, from its input. No reading of the binary shows that string, and the reader steps over code bodies by their length. A term split across two segments, or stored encoded, passes too, as it would in a text file: the firewall guards against accident, not an adversary ([security.md](../security.md#content-firewall-design)).
- **Why that risk is accepted for this module.** `vroom.wasm` is a reproducible build of public source: VROOM and its dependencies at pinned commits, and Emscripten's libraries at a pinned release, all named in `tools/vroom-wasm/build/versions.env`, with three small patches, built by `tools/vroom-wasm/build/build.sh`. That source is public and was written outside this repository; the build, the pins and the patches are text in this repository, scanned like the rest. The bytes that ship are pinned twice: `apps/web/src/lib/route-lab/solver.lock.json` holds each file's sha256, and the solver's folder is named for a hash of all five of its files, so a different module is a different URL and a failing lock check. `test/wasm.test.ts` holds the shipped module to the lock, to no custom section, and to exactly the imports and exports the lock lists. A term could reach the compiled code only through text the firewall already reads.
- **What this record does not cover.** A module built from source that is not public, or that no build in `tools/` reproduces, such as a vendor binary: its strings are read, but whatever its code computes is not. Such a module is a new decision.

## Alternatives considered

| Option | What it reads | Verdict |
|---|---|---|
| **Read the module's text, in bash (chosen)** | Custom sections, import and export names, data segments; exit 2 on anything else | Chosen: it reads what a module can say in text, and fails closed on what it cannot follow |
| Keep refusing WebAssembly | Nothing | Rejected: `main` cannot deploy the Route Lab, and the refusal hides strings a reader can see |
| Admit the pinned `vroom.wasm` by its sha256 | Nothing | Rejected: it passes bytes no rule read, and every rebuild needs an edit to the firewall |
| Read every printable run of the file, as `strings` does | Everything, code included, but cut at no boundary | Rejected: a length byte joins the name after it, and it cannot tell a malformed module from a sound one |
| A parser in node or python | The same as chosen | Rejected: neither is in every mode (above) |
| wabt or wasm-tools, pinned like gitleaks | The same, and more | Rejected: a second binary to pin by sha256 per platform, for what about 260 lines of bash do |

## Consequences

- `main` stops exiting 2 on the solver: both copies are read, in about 3 s of the `firewall` job.
- `check.sh` grows from about 560 lines to about 890, and the self-test from 75 cases to 105: modules built byte by byte (with the term in an active segment, a passive segment, a custom section's name and its bytes, an import and an export, under a name that is not `.wasm`, in a module added and removed inside a range, and in the last bytes of a module exactly at both caps), a clean module with every kind of section, `vroom.wasm` itself in every mode, and eleven malformed modules, one whose text gitleaks would skip and two one past a cap, each of which exits 2. The whole self-test went from 6 min 26 s to 10 min 6 s on 4 CPUs (2026-10-25).
- Commit ranges and the history now read WebAssembly. Other packed formats there are still not typed ([security.md](../security.md#scan-surfaces)).
- A valid module that uses a feature the reader does not know, such as garbage-collected types or a new section, exits 2 until the reader learns it, with a known answer. That is a false alarm, the cheap failure.
- So does a valid module larger than 8 MiB or with more than 20,000 strings, until a record raises the cap. `vroom.wasm` is at 11% and 6% of them.
- The firewall has a format reader to keep. It is one block of `check.sh`, with its own cases in the self-test.

## Door

Two-way. The reader is one block of `check.sh`; reverting it puts `\0asm` back on the refuse list, and `main` stops deploying the Route Lab again.

## Revisit if

- A WebAssembly module that is not a reproducible build of public source is proposed: private code, a vendor binary, or a module no build in `tools/` makes.
- The solver's build stops being reproducible from `tools/vroom-wasm/`, or the lock and the folder's hash stop pinning its bytes.
- The reader exits 2 on a valid module: teach it the feature, with a case in the self-test. If the module is past a cap, measure the reader on it before raising the cap, against the `firewall` job's timeout.
- gitleaks changes how it types its input. The known answer turns that into exit 2, not a silent pass.
