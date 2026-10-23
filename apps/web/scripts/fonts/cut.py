"""Cuts the site's font files, and fits their fallback faces, from pinned upstream sources
(design-system.md, "Typography").

Run by build.sh inside a throwaway virtual environment, with `python -I`, so nothing from the
working directory or the environment is imported. It never touches the network: build.sh downloads
the sources and passes their paths. Every source, hash and size comes from fonts.lock.json, the one
owner of what goes in and what comes out.

  cut.py plan  <lock>                             print "key sha256 bytes url" for each download
  cut.py cut   <lock> <downloads> <stage> <app>   verify the sources, write every output into stage
  cut.py check <lock> <stage> <app>               exit 1 unless stage, the app and the lock agree
  cut.py write <lock> <stage> <app>               copy stage into the app; record outputs in the lock

The same sources give the same bytes: timestamps are never recalculated, and woff2's Brotli is
deterministic. `check` is how a later run proves it.
"""

import hashlib
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Google Fonts' "latin" unicode-range, plus the two arrows the design uses that it leaves out:
# U+2192 (→, "Case study →") and U+2197 (↗, links that leave the site).
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,"
    "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+2192,U+2197"
)
# Only what direction C sets in mono: printable ASCII (labels are uppercased by CSS, so capitals
# too), the no-break space, © · – — ‘ ’ “ ” …, the arrows ← ↑ → ↓ ↗, and ⌘.
MONO_C = (
    "U+0020-007E,U+00A0,U+00A9,U+00B7,U+2013-2014,U+2018-201D,U+2026,U+2190-2193,U+2197,U+2318"
)

# English letter frequencies in percent (Robert Lewand, "Cryptological Mathematics", 2000), with
# spaces as 18% of characters: the sample text Capsize and Astro also fit fallback fonts to.
LETTERS = dict(
    a=8.167, b=1.492, c=2.782, d=4.253, e=12.702, f=2.228, g=2.015, h=6.094, i=6.966, j=0.153,
    k=0.772, l=4.025, m=2.406, n=6.749, o=7.507, p=1.929, q=0.095, r=5.987, s=6.327, t=9.056,
    u=2.758, v=0.978, w=2.360, x=0.150, y=1.974, z=0.074,
)
WEIGHTS = {c: share / sum(LETTERS.values()) * 0.82 for c, share in LETTERS.items()} | {" ": 0.18}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unicodes(spec: str) -> list[int]:
    points: list[int] = []
    for part in spec.split(","):
        lo, _, hi = part.removeprefix("U+").partition("-")
        points.extend(range(int(lo, 16), int(hi or lo, 16) + 1))
    return points


def load(path: Path) -> TTFont:
    # recalcTimestamp=False: the output keeps the source's head.modified, so a re-run is identical.
    return TTFont(path, recalcTimestamp=False)


def instance(path: Path, axes: dict, static: bool = False) -> TTFont:
    """Limits or pins axes, then reloads the result from bytes: the subsetter reads tables lazily,
    and an instancer result that never went through a file fails it (KeyError in gvar)."""
    font = instancer.instantiateVariableFont(load(path), axes, static=static)
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer, recalcTimestamp=False)


def cut(font: TTFont, points: list[int], features: list[str], hinting: bool, flavor, out: Path):
    options = subset.Options()
    options.layout_features = features
    options.hinting = hinting
    options.flavor = flavor
    # Kept name records: IDs 0-6 (copyright, family, style, unique ID, full name, version,
    # PostScript name), English only, plus the axis and instance names fvar and STAT point at.
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    options.name_languages = [0x409]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), options)


DEFAULT_FEATURES = subset.Options().layout_features


# Fallback faces --------------------------------------------------------------------------------
#
# While a web font loads, or when it never arrives, the browser draws the text in a local font.
# Each local font gets its own family here, with size-adjust fitted to the web font's widths, so a
# line breaks in the same place in both and nothing moves when the web font swaps in (CLS). One
# shared size-adjust cannot fit them all: measured here, DejaVu Sans is 15% wider than Arial, and
# 20% in bold. The 80% faces serve only the name, the LCP element, so they fit the name itself.


def advance(font: TTFont, text: str) -> float:
    cmap, metrics = font.getBestCmap(), font["hmtx"].metrics
    return sum(metrics[cmap[ord(c)]][0] for c in text) / font["head"].unitsPerEm


def average(font: TTFont) -> float:
    cmap, metrics = font.getBestCmap(), font["hmtx"].metrics
    total = sum(share * metrics[cmap[ord(c)]][0] for c, share in WEIGHTS.items())
    return total / font["head"].unitsPerEm


def percent(value: float) -> str:
    return f"{value * 100:.4f}".rstrip("0").rstrip(".") + "%"


def face(family, locals_, adjust, web: TTFont, weight, stretch=None) -> str:
    # The overrides keep the web font's vertical metrics: the browser scales them by size-adjust,
    # so each is divided by it first (Capsize's formula, as Astro's own fallbacks use it).
    hhea, em = web["hhea"], web["head"].unitsPerEm
    lines = [
        "@font-face {",
        f"  font-family: '{family}';",
        "  src:",
        ",\n".join(f"    local('{name}')" for name in locals_) + ";",
        f"  font-weight: {weight};",
    ]
    if stretch:
        lines.append(f"  font-stretch: {stretch};")
    lines += [
        f"  size-adjust: {percent(adjust)};",
        f"  ascent-override: {percent(hhea.ascent / em / adjust)};",
        f"  descent-override: {percent(-hhea.descent / em / adjust)};",
        f"  line-gap-override: {percent(hhea.lineGap / em / adjust)};",
        "}",
    ]
    return "\n".join(lines)


def fallback_css(files: dict[str, Path], name: str) -> str:
    sans, mono = files["instrument-sans-ttf"], files["jetbrains-mono-ttf"]
    web = {
        (wdth, wght): instance(sans, {"wdth": wdth, "wght": wght}, static=True)
        for wdth, wght in [(100, 400), (100, 550), (100, 620), (90, 620), (80, 620)]
    }
    arimo, roboto = files["arimo-ttf"], files["roboto-ttf"]
    families = [
        # (family, regular local names, bold local names, regular metrics, bold metrics)
        (
            "Instrument Sans Fallback Arial",
            ["Arial", "ArialMT", "Liberation Sans", "LiberationSans", "Arimo Regular", "Arimo-Regular"],
            ["Arial Bold", "Arial-BoldMT", "Liberation Sans Bold", "LiberationSans-Bold", "Arimo Bold", "Arimo-Bold"],
            instance(arimo, {"wght": 400}, static=True),
            instance(arimo, {"wght": 700}, static=True),
        ),
        (
            "Instrument Sans Fallback Roboto",
            ["Roboto", "Roboto Regular", "Roboto-Regular"],
            ["Roboto Bold", "Roboto-Bold"],
            instance(roboto, {"wdth": 100, "wght": 400}, static=True),
            instance(roboto, {"wdth": 100, "wght": 700}, static=True),
        ),
        (
            "Instrument Sans Fallback DejaVu",
            ["DejaVu Sans", "DejaVuSans"],
            ["DejaVu Sans Bold", "DejaVuSans-Bold"],
            load(files["dejavu-sans-ttf"]),
            load(files["dejavu-sans-bold-ttf"]),
        ),
    ]
    faces = []
    for family, regular_names, bold_names, regular, bold in families:
        fit = lambda key, local: average(web[key]) / average(local)  # noqa: E731
        faces += [
            face(family, regular_names, fit((100, 400), regular), web[(100, 400)], "400 499"),
            face(family, regular_names, fit((100, 550), regular), web[(100, 550)], "500 599"),
            face(family, bold_names, fit((100, 620), bold), web[(100, 620)], "600 700"),
            face(family, bold_names, fit((90, 620), bold), web[(90, 620)], "600 700", "86% 95%"),
            face(family, bold_names, advance(web[(80, 620)], name) / advance(bold, name),
                 web[(80, 620)], "600 700", "75% 85%"),
        ]
    jbm = instance(mono, {"wght": 400}, static=True)
    for family, names, local in [
        ("JetBrains Mono Fallback Menlo", ["Menlo Regular", "Menlo-Regular", "DejaVu Sans Mono", "DejaVuSansMono"],
         load(files["dejavu-sans-mono-ttf"])),
        ("JetBrains Mono Fallback Courier", ["Courier New", "CourierNewPSMT", "Liberation Mono", "LiberationMono",
                                             "Cousine Regular", "Cousine-Regular"], load(files["cousine-ttf"])),
    ]:
        faces.append(face(family, names, advance(jbm, "0") / advance(local, "0"), jbm, "400 500"))

    sans_stack = ", ".join(f"'{family}'" for family, *_ in families) + ", sans-serif"
    mono_stack = "'JetBrains Mono Fallback Menlo', 'JetBrains Mono Fallback Courier', monospace"
    header = f"""/*
  Written by scripts/fonts/build.sh: do not edit. Metric-matched fallback faces for the two web
  fonts, one family per local font, each with size-adjust fitted to the web font's widths, so text
  breaks in the same place before and after the web font arrives.

  - Arial: Arial (Apple, Windows), Liberation Sans and Arimo (Linux), which share its widths.
    Measured from Arimo. Roboto: Android. DejaVu Sans: Linux without Liberation.
  - Menlo and DejaVu Sans Mono share one width, and so do Courier New, Liberation Mono and Cousine.
  - Faces at 100% width are fitted to English letter frequencies at the weight they stand in for.
    The 75-85% faces are fitted to "{name}", the only text set at 80%, from profile.json.
  - The stacks below are the one list of fallbacks: tokens.css puts the web fonts in front.
*/

:root {{
  --font-sans-fallbacks: {sans_stack};
  --font-mono-fallbacks: {mono_stack};
}}
"""
    return header + "\n" + "\n\n".join(faces) + "\n"


# Outputs: where each file goes (relative to apps/web), and how it is made. ---------------------


def outputs(files: dict[str, Path], name: str) -> list[tuple[str, object]]:
    sans, mono = files.get("instrument-sans-ttf"), files.get("jetbrains-mono-ttf")

    def sans_web(out: Path):  # both axes, wdth 75-100 and wght 400-700
        cut(load(sans), unicodes(LATIN), DEFAULT_FEATURES, False, "woff2", out)

    def mono_web(out: Path):  # wght limited to 400-500, the two weights C uses; kern only
        cut(instance(mono, {"wght": (400, 500)}), unicodes(MONO_C), ["kern"], True, "woff2", out)

    def static(src: Path, axes: dict[str, float], spec: str, features: list[str]):
        # Satori draws a variable font at its default instance and ignores font-stretch, so the
        # Open Graph template gets one static TrueType file per style it draws (spec B10).
        def make(out: Path):
            cut(instance(src, axes, static=True), unicodes(spec), features, False, None, out)

        return make

    return [
        ("src/assets/fonts/instrument-sans-latin.woff2", sans_web),
        ("src/assets/fonts/jetbrains-mono-c.woff2", mono_web),
        ("src/og/fonts/instrument-sans-80-620.ttf", static(sans, {"wdth": 80, "wght": 620}, LATIN, DEFAULT_FEATURES)),
        ("src/og/fonts/instrument-sans-100-550.ttf", static(sans, {"wdth": 100, "wght": 550}, LATIN, DEFAULT_FEATURES)),
        ("src/styles/font-fallbacks.css", lambda out: out.write_text(fallback_css(files, name), "utf-8")),
        ("public/fonts/OFL-InstrumentSans.txt", lambda out: shutil.copyfile(files["instrument-sans-ofl"], out)),
        ("public/fonts/OFL-JetBrainsMono.txt", lambda out: shutil.copyfile(files["jetbrains-mono-ofl"], out)),
    ]


def verify(path: Path, entry: dict, label: str):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != entry["bytes"] or digest != entry["sha256"]:
        sys.exit(f"cut.py: {label} is {len(data)} B, sha256 {digest}; the lock pins "
                 f"{entry['bytes']} B, sha256 {entry['sha256']}")


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        sys.exit(__doc__)
    command, lock_path = argv[0], Path(argv[1])
    lock = json.loads(lock_path.read_text("utf-8"))

    if command == "plan":
        for key, entry in lock["sources"].items():
            if "url" in entry:
                print(key, entry["sha256"], entry["bytes"], entry["url"])
        return

    if command == "cut":
        fetched, stage, app = Path(argv[2]), Path(argv[3]), Path(argv[4])
        name = json.loads((app / "src/content/profile.json").read_text("utf-8"))["basics"]["name"]
        files: dict[str, Path] = {}
        for key, entry in lock["sources"].items():
            if "url" in entry:
                files[key] = fetched / key
            else:
                # A member of a downloaded archive, read by its exact name and written under a name
                # chosen here: no path from inside the archive is ever used on disk.
                with zipfile.ZipFile(files[entry["from"]]) as archive:
                    data = archive.read(entry["member"])
                files[key] = fetched / f"{key}.member"
                files[key].write_bytes(data)
            verify(files[key], entry, key)
        for relative, make in outputs(files, name):
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            make(target)
            print(f"{target.stat().st_size:>8} B  {relative}")
        return

    stage, app = Path(argv[2]), Path(argv[3])
    produced = sorted(p.relative_to(stage).as_posix() for p in stage.rglob("*") if p.is_file())

    if command == "check":
        problems = []
        recorded = lock.get("outputs", {})
        if sorted(recorded) != produced:
            problems.append(f"the lock records {sorted(recorded)}, the cut produced {produced}")
        for relative in produced:
            fresh, committed = stage / relative, app / relative
            entry = recorded.get(relative, {})
            if sha256(fresh) != entry.get("sha256") or fresh.stat().st_size != entry.get("bytes"):
                problems.append(f"{relative}: the cut differs from the lock")
            if not committed.exists() or committed.read_bytes() != fresh.read_bytes():
                problems.append(f"{relative}: the committed file differs from the cut")
        if problems:
            sys.exit("cut.py: not reproducible\n  " + "\n  ".join(problems))
        print(f"cut.py: {len(produced)} outputs match the lock and the committed files, byte for byte")
        return

    if command == "write":
        recorded = {}
        for relative in produced:
            target = app / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(stage / relative, target)
            recorded[relative] = {"sha256": sha256(target), "bytes": target.stat().st_size}
        lock["outputs"] = recorded
        lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"cut.py: wrote {len(produced)} outputs and recorded them in {lock_path.name}")
        return

    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
