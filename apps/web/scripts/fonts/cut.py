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
# Every face is cut to it. The design sets no arrow (docs/design/overhaul.md, "Type"), so none is
# added for "→" or "↗".
LATIN = (
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,"
    "U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
)

# The layout features kept: kerning, the fi and fl ligatures, composition and local forms, and both
# figure widths, since Archivo's figures are proportional and changing numbers set tabular-nums.
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


# The faces the site serves (docs/design/overhaul.md, "Type"; ADR 0027): one family, Archivo by
# Omnibus-Type, in three widths, each a static instance cut here from google/fonts' variable font,
# so no served face has an axis. (file name, family name the font records, PostScript name, axes,
# CSS weight.) B612 Mono is google/fonts' own static instance, cut as it comes.
ARCHIVO = [
    # The name, page titles and figures: the narrowest width at ExtraBold.
    ("archivo-condensed-extrabold", "Archivo ExtraCondensed ExtraBold",
     "Archivo-ExtraCondensedExtraBold", {"wdth": 62, "wght": 800}, 800),
    # Controls, buttons and the labels inside drawings, where room is short: Condensed SemiBold,
    # as narrow on the labs' own words as the face it replaced.
    ("archivo-condensed-semibold", "Archivo Condensed SemiBold", "Archivo-CondensedSemiBold",
     {"wdth": 75, "wght": 600}, 600),
    # Signage: the navigation, the wordmark, a block's name, dates: the widest width at Medium.
    ("archivo-expanded-medium", "Archivo Expanded Medium", "Archivo-ExpandedMedium",
     {"wdth": 125, "wght": 500}, 500),
    # Reading text, and its SemiBold for <strong>.
    ("archivo-regular", "Archivo", "Archivo-Regular", {"wdth": 100, "wght": 400}, 400),
    ("archivo-semibold", "Archivo SemiBold", "Archivo-SemiBold", {"wdth": 100, "wght": 600}, 600),
]
MONO = ("b612-mono-ttf", "b612-mono-regular", 400)

# The Open Graph card draws its title in the condensed face and its label in the expanded one
# (lib/og.ts). Satori reads TrueType, not WOFF2, so these two are cut again as .ttf.
OG_FACES = ["archivo-condensed-extrabold", "archivo-expanded-medium"]


def archivo(files: dict[str, Path], file: str) -> TTFont:
    """One of the four Archivo instances, named as itself: the instancer keeps the variable font's
    default names ("Archivo", "Regular"), so each static face would claim one family. Only the
    records the cut keeps (IDs 1 to 6) are written; IDs 0 and 5 stay the source's."""
    _, family, postscript, axes, _ = next(face for face in ARCHIVO if face[0] == file)
    font = instance(files["archivo-ttf"], axes)
    version = font["name"].getDebugName(5) or ""
    number = version.removeprefix("Version ").split(";")[0]
    for name_id, value in {
        1: family,
        2: "Regular",
        3: f"{number};OMNI;{postscript}",
        4: "Archivo Regular" if family == "Archivo" else family,
        6: postscript,
    }.items():
        font["name"].setName(value, name_id, 3, 1, 0x409)
        font["name"].removeNames(nameID=name_id, platformID=1)
    for name_id in (16, 17, 25):
        font["name"].removeNames(nameID=name_id)
    # A static face needs no style attributes table, and without it the cut keeps only IDs 0 to 6:
    # STAT would keep the axis and instance names it points at.
    if "STAT" in font:
        del font["STAT"]
    return font


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


def percent(value: float, places: int = 4) -> str:
    text = f"{value * 100:.{places}f}"
    # Trailing zeros go only after a decimal point: "112.50" is "112.5", and "110" stays "110".
    return (text.rstrip("0").rstrip(".") if "." in text else text) + "%"


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
            # The vertical overrides to a whole percent: 0.5% of a line is under a tenth of a pixel
            # at reading sizes, and a long run of digits here read as an identifier to the content
            # firewall (2026-10-31).
            f"  ascent-override: {percent(hhea.ascent / em / adjust, 0)};",
            f"  descent-override: {percent(-hhea.descent / em / adjust, 0)};",
            f"  line-gap-override: {percent(hhea.lineGap / em / adjust, 0)};",
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
    condensed = archivo(files, "archivo-condensed-extrabold")
    expanded = archivo(files, "archivo-expanded-medium")
    label = archivo(files, "archivo-condensed-semibold")
    regular = archivo(files, "archivo-regular")
    semibold = archivo(files, "archivo-semibold")
    mono = load(files["b612-mono-ttf"])
    locals_ = locals_for(files)

    def fit(web: TTFont, local: TTFont) -> float:
        return average(web) / average(local)

    stacks: dict[str, list[str]] = {"display": [], "wide": [], "label": [], "sans": []}
    faces = []
    for suffix, regular_names, bold_names, local_regular, local_bold in locals_:
        # The name and the titles: Archivo ExtraCondensed ExtraBold, against the bold local face,
        # fitted to the name's own widths, set in capitals as Home sets it.
        family = f"Archivo Display Fallback {suffix}"
        stacks["display"].append(family)
        faces.append(face(family, bold_names,
                          advance(condensed, name.upper()) / advance(local_bold, name.upper()),
                          condensed, 800))
        # Signage, the navigation, block names and dates: Archivo Expanded Medium.
        family = f"Archivo Wide Fallback {suffix}"
        stacks["wide"].append(family)
        faces.append(face(family, regular_names, fit(expanded, local_regular), expanded, 500))
        # Controls, buttons and the labels inside drawings: Archivo Condensed SemiBold.
        family = f"Archivo Label Fallback {suffix}"
        stacks["label"].append(family)
        faces.append(face(family, bold_names, fit(label, local_bold), label, 600))
        # Reading text: Archivo Regular, and its SemiBold for <strong>.
        family = f"Archivo Fallback {suffix}"
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
  Written by scripts/fonts/build.sh: do not edit. Metric-matched fallback faces for the six web
  faces, one family per web face and local font, each with size-adjust fitted to the web face's
  widths, so text breaks in the same place before and after the web font arrives.

  - Arial: Arial (Apple, Windows), Liberation Sans and Arimo (Linux), which share its widths.
    Measured from Arimo. Roboto: Android. DejaVu Sans: Linux without Liberation.
  - Menlo and DejaVu Sans Mono share one width, and so do Courier New, Liberation Mono and Cousine.
  - Archivo's wide, label and reading faces and B612 Mono are fitted to English letter
    frequencies. Archivo ExtraCondensed is fitted to "{name}", from profile.json, in capitals: the
    name is Home's largest text.
  - The stacks below are the one list of fallbacks: tokens.css puts the web faces in front.
*/

:root {{
  --font-display-fallbacks: {stack(stacks["display"], "sans-serif")};
  --font-wide-fallbacks: {stack(stacks["wide"], "sans-serif")};
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

    def license_copy(key: str, same: list[str]):
        # One copy serves every family that ships the same license text, byte for byte.
        def make(out: Path):
            text = files[key].read_bytes()
            for other in same:
                if files[other].read_bytes() != text:
                    sys.exit(f"cut.py: {other} differs from {key}; ship each license on its own")
            shutil.copyfile(files[key], out)

        return make

    def archivo_web(file: str):
        return lambda out: cut(archivo(files, file), unicodes(LATIN), "woff2", out)

    def archivo_og(file: str):
        return lambda out: cut(archivo(files, file), unicodes(LATIN), None, out)

    key, mono_file, _ = MONO
    return [
        *[(f"src/assets/fonts/{file}.woff2", archivo_web(file)) for file, *_ in ARCHIVO],
        (f"src/assets/fonts/{mono_file}.woff2", web(key)),
        *[(f"src/og/fonts/{file}.ttf", archivo_og(file)) for file in OG_FACES],
        ("src/styles/font-fallbacks.css", lambda out: out.write_text(fallback_css(files, name), "utf-8")),
        ("public/fonts/OFL-Archivo.txt", license_copy("archivo-ofl", [])),
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
