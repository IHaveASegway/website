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

# Google Fonts' "latin" unicode-range: Latin-1, the general punctuation block and a few symbols.
# Every face is cut to it. Barlow draws no arrow, so the design sets none (design-system.md, "The
# faces"): the arrows the old cut added for "→" and "↗" are gone with them.
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,"
    "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)

# The layout features kept: kerning, the fi and fl ligatures, composition and local forms, and both
# figure widths, since Barlow's figures are proportional and changing numbers set tabular-nums.
# fontTools' default list drops tnum, and its fractions (frac, numr, dnom) are never set here.
FEATURES = ["kern", "liga", "ccmp", "locl", "tnum", "pnum"]

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


def instance(path: Path, axes: dict) -> TTFont:
    """A static instance of a variable font, reloaded from bytes: fontTools reads tables lazily, and
    an instancer result that never went through a file can fail a later read (KeyError in gvar)."""
    font = instancer.instantiateVariableFont(load(path), axes, static=True)
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    return TTFont(buffer, recalcTimestamp=False)


def cut(font: TTFont, points: list[int], flavor, out: Path):
    options = subset.Options()
    options.layout_features = FEATURES
    # Unhinted: the hints are about half of each file, and the screens that read them (Windows at
    # small sizes) draw these faces cleanly without (design-system.md, "The faces").
    options.hinting = False
    options.flavor = flavor
    # Kept name records: IDs 0-6 (copyright, family, style, unique ID, full name, version,
    # PostScript name), English only.
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    options.name_languages = [0x409]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=points)
    subsetter.subset(font)
    out.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(out), options)


# The faces the site serves: (source key, file name, CSS weight). Each is a static instance as
# google/fonts publishes it, so none has an axis.
FACES = [
    ("barlow-condensed-ttf", "barlow-condensed-semibold", 600),
    ("barlow-semi-condensed-ttf", "barlow-semi-condensed-medium", 500),
    ("barlow-ttf", "barlow-regular", 400),
    ("barlow-semibold-ttf", "barlow-semibold", 600),
    ("b612-mono-ttf", "b612-mono-regular", 400),
]

# The Open Graph card draws its title in the condensed face and its label in the semi-condensed one
# (lib/og.ts). Satori reads TrueType, not WOFF2, so these two are cut again as .ttf.
OG_FACES = [
    ("barlow-condensed-ttf", "barlow-condensed-semibold"),
    ("barlow-semi-condensed-ttf", "barlow-semi-condensed-medium"),
]


# Fallback faces --------------------------------------------------------------------------------
#
# While a web font loads, or when it never arrives, the browser draws the text in a local font.
# Each local font gets its own family per web face here, with size-adjust fitted to the web face's
# widths, so a line breaks in the same place in both and nothing moves when the web font swaps in
# (CLS). Each fallback family declares the weights its web family has, no more, so a weight the
# design never sets resolves to the same face in both. One shared size-adjust cannot fit them all: DejaVu Sans is about 15% wider than Arial, and
# 20% in bold. The condensed face sets the name, the LCP element on Home, so its fallbacks fit the
# name itself; the others fit English text.


def advance(font: TTFont, text: str) -> float:
    cmap, metrics = font.getBestCmap(), font["hmtx"].metrics
    return sum(metrics[cmap[ord(c)]][0] for c in text) / font["head"].unitsPerEm


def average(font: TTFont) -> float:
    cmap, metrics = font.getBestCmap(), font["hmtx"].metrics
    total = sum(share * metrics[cmap[ord(c)]][0] for c, share in WEIGHTS.items())
    return total / font["head"].unitsPerEm


def percent(value: float) -> str:
    return f"{value * 100:.4f}".rstrip("0").rstrip(".") + "%"


def face(family, locals_, adjust, web: TTFont, weight) -> str:
    # The overrides keep the web face's vertical metrics: the browser scales them by size-adjust,
    # so each is divided by it first (Capsize's formula, as Astro's own fallbacks use it).
    hhea, em = web["hhea"], web["head"].unitsPerEm
    return "\n".join(
        [
            "@font-face {",
            f"  font-family: '{family}';",
            "  src:",
            ",\n".join(f"    local('{name}')" for name in locals_) + ";",
            f"  font-weight: {weight};",
            f"  size-adjust: {percent(adjust)};",
            f"  ascent-override: {percent(hhea.ascent / em / adjust)};",
            f"  descent-override: {percent(-hhea.descent / em / adjust)};",
            f"  line-gap-override: {percent(hhea.lineGap / em / adjust)};",
            "}",
        ]
    )


# The local fonts a reader may have, by the name a stylesheet can ask for, and the file whose
# widths stand in for each: (suffix, regular names, bold names, regular metrics, bold metrics).
def locals_for(files: dict[str, Path]):
    arimo, roboto = files["arimo-ttf"], files["roboto-ttf"]
    return [
        (
            "Arial",
            ["Arial", "ArialMT", "Liberation Sans", "LiberationSans", "Arimo Regular", "Arimo-Regular"],
            ["Arial Bold", "Arial-BoldMT", "Liberation Sans Bold", "LiberationSans-Bold", "Arimo Bold", "Arimo-Bold"],
            instance(arimo, {"wght": 400}),
            instance(arimo, {"wght": 700}),
        ),
        (
            "Roboto",
            ["Roboto", "Roboto Regular", "Roboto-Regular"],
            ["Roboto Bold", "Roboto-Bold"],
            instance(roboto, {"wdth": 100, "wght": 400}),
            instance(roboto, {"wdth": 100, "wght": 700}),
        ),
        (
            "DejaVu",
            ["DejaVu Sans", "DejaVuSans"],
            ["DejaVu Sans Bold", "DejaVuSans-Bold"],
            load(files["dejavu-sans-ttf"]),
            load(files["dejavu-sans-bold-ttf"]),
        ),
    ]


def fallback_css(files: dict[str, Path], name: str) -> str:
    condensed = load(files["barlow-condensed-ttf"])
    semi = load(files["barlow-semi-condensed-ttf"])
    regular = load(files["barlow-ttf"])
    semibold = load(files["barlow-semibold-ttf"])
    mono = load(files["b612-mono-ttf"])
    locals_ = locals_for(files)

    def fit(web: TTFont, local: TTFont) -> float:
        return average(web) / average(local)

    stacks: dict[str, list[str]] = {"display": [], "label": [], "sans": []}
    faces = []
    for suffix, regular_names, bold_names, local_regular, local_bold in locals_:
        # The name and the titles: Barlow Condensed SemiBold, against the bold local face, fitted to
        # the name's own widths.
        family = f"Barlow Condensed Fallback {suffix}"
        stacks["display"].append(family)
        faces.append(face(family, bold_names, advance(condensed, name) / advance(local_bold, name),
                          condensed, 600))
        # Labels, the navigation, buttons and captions: Barlow Semi Condensed Medium.
        family = f"Barlow Semi Condensed Fallback {suffix}"
        stacks["label"].append(family)
        faces.append(face(family, regular_names, fit(semi, local_regular), semi, 500))
        # Reading text: Barlow Regular, and its SemiBold for <strong>.
        family = f"Barlow Fallback {suffix}"
        stacks["sans"].append(family)
        faces.append(face(family, regular_names, fit(regular, local_regular), regular, 400))
        faces.append(face(family, bold_names, fit(semibold, local_bold), semibold, 600))

    mono_families = []
    for family, names, local in [
        ("B612 Mono Fallback Menlo", ["Menlo Regular", "Menlo-Regular", "DejaVu Sans Mono", "DejaVuSansMono"],
         load(files["dejavu-sans-mono-ttf"])),
        ("B612 Mono Fallback Courier", ["Courier New", "CourierNewPSMT", "Liberation Mono", "LiberationMono",
                                        "Cousine Regular", "Cousine-Regular"], load(files["cousine-ttf"])),
    ]:
        mono_families.append(family)
        faces.append(face(family, names, advance(mono, "0") / advance(local, "0"), mono, 400))

    def stack(families: list[str], generic: str) -> str:
        return ", ".join(f"'{family}'" for family in families) + f", {generic}"

    header = f"""/*
  Written by scripts/fonts/build.sh: do not edit. Metric-matched fallback faces for the four web
  faces, one family per web face and local font, each with size-adjust fitted to the web face's
  widths, so text breaks in the same place before and after the web font arrives.

  - Arial: Arial (Apple, Windows), Liberation Sans and Arimo (Linux), which share its widths.
    Measured from Arimo. Roboto: Android. DejaVu Sans: Linux without Liberation.
  - Menlo and DejaVu Sans Mono share one width, and so do Courier New, Liberation Mono and Cousine.
  - Barlow, Barlow Semi Condensed and B612 Mono are fitted to English letter frequencies. Barlow
    Condensed is fitted to "{name}", from profile.json: the name is Home's largest text.
  - The stacks below are the one list of fallbacks: tokens.css puts the web faces in front.
*/

:root {{
  --font-display-fallbacks: {stack(stacks["display"], "sans-serif")};
  --font-label-fallbacks: {stack(stacks["label"], "sans-serif")};
  --font-sans-fallbacks: {stack(stacks["sans"], "sans-serif")};
  --font-mono-fallbacks: {stack(mono_families, "monospace")};
}}
"""
    return header + "\n" + "\n\n".join(faces) + "\n"


# Outputs: where each file goes (relative to apps/web), and how it is made. ---------------------


def outputs(files: dict[str, Path], name: str) -> list[tuple[str, object]]:
    def web(key: str):
        return lambda out: cut(load(files[key]), unicodes(LATIN), "woff2", out)

    def og(key: str):
        return lambda out: cut(load(files[key]), unicodes(LATIN), None, out)

    def license_copy(key: str, same: list[str]):
        # One copy serves every family that ships the same license text, byte for byte.
        def make(out: Path):
            text = files[key].read_bytes()
            for other in same:
                if files[other].read_bytes() != text:
                    sys.exit(f"cut.py: {other} differs from {key}; ship each license on its own")
            shutil.copyfile(files[key], out)

        return make

    return [
        *[(f"src/assets/fonts/{file}.woff2", web(key)) for key, file, _ in FACES],
        *[(f"src/og/fonts/{file}.ttf", og(key)) for key, file in OG_FACES],
        ("src/styles/font-fallbacks.css", lambda out: out.write_text(fallback_css(files, name), "utf-8")),
        ("public/fonts/OFL-Barlow.txt",
         license_copy("barlow-ofl", ["barlow-condensed-ofl", "barlow-semi-condensed-ofl"])),
        ("public/fonts/OFL-B612Mono.txt", license_copy("b612-mono-ofl", [])),
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
