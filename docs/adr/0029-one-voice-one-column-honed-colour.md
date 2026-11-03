# ADR 0029: One voice, a reading column, and an electric palette

Status: Proposed · 2026-11-02

## Context

Joseph is about to share an essay on LinkedIn, and traffic from recruiters and tech leads will land on the whole site. A review on 2026-11-02 walked every page as both readers and compared the words with his own. It found:

- **The words were a dialect.** "The systems work flows through" and "the lines where agents write the code" stopped a recruiter on the first screen. "Lamps", "tank" and "siding" were left over from a retired identity. "Line" meant four things.
- **The person was missing.** First-person words ran at 39 per 1,000 in his messages and 3.3 in the essay. Sentence length was the same in both.
- **The essay's analogy was an agent's.** He rejected it, and then rejected a rewrite that made human computers the main point as overdone. The idea that's his: one day we'll look back at a lot of today's work and say it was kind of a shitty job, and we're glad we don't have to do it now.
- **Type spoke in several voices.** His name was Expanded on Home and ExtraCondensed on About. ADR 0027's "one family" gave four widths, and buttons were captions in boxes.
- **The reading page was unresolved.** The text sat on the left with 418 px of nothing before a Contents rail, and the page ended with no way to reach him.
- **The colour wasn't electric.** Cobalt `#2349d7` sat 0.025 in OKLab from Tailwind's blue-700, about one noticeable step, and at night the accent sat 4 degrees of hue from the page. He asked for simpler, more techno, more futuristic, "a bit more electric", and turned down apricot when it was offered.
- **About read wrong.** 52% of it repeated Home and the indexes, a timeline starting 25 Oct made a career look a week old, and its two columns were one reference's signature, which [feedback on the clone](0028-home-is-his-own.md) rules out.

## Decision

**Language.** The site uses one plain vocabulary, listed in [content.md](../content.md#the-sites-language). `test/language.test.ts` fails on a retired phrase, on every built page and in every content file. This is a ubiquitous language (Evans, *Domain-Driven Design*, chapter 2) held by a fitness function (*Building Evolutionary Architectures*).

**The essays.** "The road closed" leaves the site, and its URL gets a 301 and stays in the ledger (ADR 0005). Its replacement is "You will be missed", in its own pull request after Joseph's read. The teardown is cut to about 450 words. Length comes back only once tone and stories are right.

**Type.** Width says who is speaking:

| Token | Face | Sets |
|---|---|---|
| `--font-display` | Archivo Expanded SemiBold | the name, every title and heading |
| `--font-wide` | Archivo Expanded Medium | navigation, buttons, labels, dates |
| `--font-sans` | Archivo Regular | short interface prose |
| `--font-reading` | Reading Serif, an instance of Source Serif 4 | long reads |
| `--font-label` | Archivo Condensed SemiBold | a lab's instruments and key hints |
| `--font-mono` | JetBrains Mono (B612 Mono until the postscript below) | code |

ExtraCondensed is gone. The served serif goes by its own name because the upstream's name table reserves "Source" under the OFL, and an instanced subset is a modified version. The attribution and license ship with it.

**Reading.** A long read is one centered column, 36.75rem, for its title, lead, register, body and close. It ends with who wrote it and how to reach him. The Contents rail is gone: no post is long enough to need it.

**Layout.** About is one centered column and keeps only what is its own on screen. The nav bar and footer sit on the page. Buttons are 48 px in the signage face, outside a lab's instruments.

**Colour.** Arc: black and white and one electric accent. By day a clean white page, near-black ink and electric blue `#0743f9`; by night a near-black page, white ink and arc blue `#1adbf9`. Links are ink with an accent underline. Everything in the chrome takes the one accent, Home's rows included, and a lab's own colour stays in that lab's picture. A glow token lights what is live or can be pressed, and a faint grid sits behind Home's opening.

## Options

| Option | Trades | Verdict |
|---|---|---|
| **Palette: Arc, electric blue and arc blue** | Reads as electricity, and holds in both themes. Blue is close to where the site has been, so the near-black ground has to do the work | Chosen: Joseph picked it from renders on 2026-11-02 |
| Palette: Volt, an electric lime | The boldest night. By day lime fails on white, so the accent has to darken to a plain green, and near-black with acid green is a common look | Runner-up |
| Palette: Plasma, an electric violet | Distinct, and it holds by day. Violet leans toward the look of AI products | Rejected unless he prefers it |
| Palette: petrol and apricot; redline; calmer cobalt | Rendered first, and none is electric | Rejected: he asked to ditch apricot |
| **A text serif for long reads** | 18.7 KB on long reads. For voice: no claim that it reads faster (Wallace et al., ACM TOCHI 2022: no font is best for everyone) | Chosen |
| Keep Archivo with wider word spacing | 0 KB. An essay still reads like interface text | Fallback, one token away |
| **A small test for the language** | A few lines in the suite we have | Chosen |
| Vale, a prose linter | The ready-made tool, with styles and CI output, and one more binary in CI | Later, if the list grows |

## Consequences

- Every page declares the reading and label faces, so every page shares one `style-src`. A page whose policy differs gets a `_headers` rule, and a draft's path would show there. Each is fetched only where something draws it, and `test/support/measure.ts` counts the reading face only where a page preloads it.
- The label face is preloaded only on a lab's pages. A first screen elsewhere no longer needs it.
- Fixed by this release: ten sentences a review had found untrue, and the "two-way doors" example Joseph rejected.

Debt taken on knowingly:

- Lab write-ups keep the interface face. Home's statement and About's opening could take the serif as well, once the fold is re-measured.
- A lab's controls keep the label face. A later pass could bring them closer to the chrome's buttons.
- `docs/design-system.md` still describes earlier faces, and this record overrides it where they differ.
- `main` still has no required checks. "A failure turns the pull request red" is true, and it does not yet block a merge.

## Door

Two-way for colour, tokens and copy: one file each, and a revert restores them. The essay's new URL is a one-way door once it has been shared, so the slug should be settled before anyone posts it.

## Revisit if

- Joseph's first read on a phone is "what we started with": ship Volt, which is a two-line change of tokens.
- Fewer than 3 of 5 readers in the 7-second test ([product.md](../product.md)) can say what kind of engineer he is.
- A recruiter or tech lead says the disclosure that agents wrote the code counts against him.

## Postscript, 2026-11-02: the link cards

A QA pass before the traffic found Home's and the Lab index's link previews still topped with the board's five coloured lines, which ADR 0027 took off the pages and which this record's colour rule rules out for Home. A card is the first thing a stranger sees of a link, so it now looks like what it opens. Home's is the name in two lines beside the cluster, in black and white and the one accent; the Lab index's carries the five glyphs its page lists, each in its own lab's colour, as the page has them. Every card stands on the field behind every page (ADR 0030), so none is a black sheet. A lab's own card keeps its line and its colour, and the Route Lab's map leaves its water clear, so the field runs through it and the map has no edge. `test/og.test.ts` counts the pixels on Home's card away from the accent, and the door stays two-way: a card is redrawn at the next build, and a preview cache lets go of the old one in days.

## Postscript, 2026-11-02: the code face

B612 Mono's parentheses look square and its period leaves a gap, so a method call read as a different and wrong Python expression, and that isn't a matter of taste. Code is now set in JetBrains Mono's Regular, cut through `scripts/fonts/cut.py` and `fonts.lock.json` as the reading face was: 8,436 B against 12,084 B, fetched only on a page with code, so no budget moves. Source Code Pro drew as well and looked lighter beside the serif. It also reserves "Source", so it would have needed a name of its own, and JetBrains Mono reserves nothing. Its ligatures stay out: code shows the characters it was written in. The door is two-way, one lock entry and one token. Rendered side by side on 2026-11-02 in Chromium and WebKit.

## Further reading

- Eric Evans, *Domain-Driven Design*, chapter 2, "Communication and the Use of Language".
- Neal Ford, Rebecca Parsons and Patrick Kua, *Building Evolutionary Architectures*, on fitness functions.
- Paul A. David, "The Dynamo and the Computer", *American Economic Review*, 1990.
