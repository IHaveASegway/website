# ADR 0033: The bakery leads Home, and the labs are its pieces

Status: Proposed · 2026-11-27 · Deciders: Joseph Peterson

## Context

[ADR 0031](0031-about-leads-with-what-joseph-builds.md) recorded where the labs were going: Joseph's words were that they would eventually unify "into something like the bakery software, which will tie all the labs together". That software exists. The bakery demo has been live on its own hostname, `bakery.ihaveasegway.com`, since 2026-11-06 ([ADR 0032](0032-workers-paid-for-the-bakery.md); its repository's README dates the launch). As of 2026-11-26 this site did not link it once: Home's statement still pointed at the labs, About and the Lab index still called the bakery "the end goal", and a visitor had no way to learn it was there.

On 2026-11-26 Joseph asked for the site to read better and for the bakery to be "integrated and marketable", and chose, of three options put to him, that the bakery leads Home, with the labs reframed as the pieces it is built from. He also chose that his own sentences in the bio are edited and kept, not rewritten.

Two constraints shaped what was built:

- **The top bar holds three items at 320 px.** Lab, Writing and About, the wordmark's tile and the three tools fill the row a phone gives it (`e2e/top-bar.spec.ts`), and every item is a section of this site. A fourth item does not fit without a new design for the bar.
- **The bio is the one owner of Joseph's words** ([ADR 0023](0023-home-as-a-story-and-rail-drop-downs.md), ADR 0031): Home and `/about/` lay out `src/content/about.md` and write almost nothing of their own.

## Decision

1. **The bio gains a section, "A bakery you can order from"**, between the biggest thing and the labs: what a visitor can do there, and how it is built, each sentence restating the bakery's own README. Its first words say the bakery is made up, as the site's language requires.
2. **Home leads with it.** The statement's second sentence, Home's own, becomes "Start with the made-up bakery." in place of "Here are a few things you can break.", and the bakery's section stands first under the opening, with its name linked and one button, "Open the bakery". The labs follow it.
3. **The labs are said to be its pieces.** The paragraph under the bio's list of labs says most of them simulate one problem the bakery has to solve, and that the end goal of tying them together was the bakery's software. The Lab index's lead says the same.
4. **"The last thing I built" becomes "This site"**, since the bakery is the later build. Home shows that section's first paragraph over the record line, and `/about/` shows all of it: until now Home repeated the whole section.
5. **No fourth item in the top bar.** The bakery is reached from Home's first section and from `/about/`. `BAKERY_URL` in `lib/site.ts` is the one place its address is written.
6. **The bio's opening keeps its sentences**, with its long second sentence split in two.

## Alternatives considered

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| **A section in the bio that Home leads with (chosen)** | Usability: the first thing under the opening is a system a visitor can use. Maintainability: one owner for the words, as before | A phone visitor scrolls one section further to reach the labs | Chosen |
| A fourth item in the top bar | Findability from every page | Usability: the bar's row does not hold it at 320 px, and it would be the bar's only link off the site | Rejected until the bar is redesigned |
| A `/bakery/` page on this site | A page of this site's own to share, with its own link preview | A second copy of what the bakery's first page already says, to keep in step by hand | Not built; revisit below |
| A card in Selected work only | The least change | It stays below the labs, which the bakery is meant to lead | Rejected by Joseph's choice |

## Consequences

Good:

- A visitor's first screen names the bakery, and the next thing down opens it.
- About, Home and the Lab index stop describing a finished system as a goal.
- Home is shorter: it no longer repeats the whole of the section on this site.

Bad:

- This site now depends on a second system's uptime for its lead. If the bakery is down, Home's first button leads to an error. The bakery's status page and its breaker are its own ([ADR 0032](0032-workers-paid-for-the-bakery.md)).
- The bakery's section is new copy about Joseph's work, drafted by an agent from the bakery's README. It needs his read before this record is accepted.
- The bakery's repository is not linked: a link to a repository waits on the readiness checklist ([content.md](../content.md#repo-readiness-checklist)).

## Door

Two-way. The section is one block of the bio and one block of each page; removing them and restoring the statement returns Home to ADR 0031.

## Revisit if

- The top bar is redesigned: then the bakery may take a place in it.
- The bakery's readiness check passes: then its card joins Selected work, with its repository.
- A link to the bakery from a shared post matters more than it does today: then build `/bakery/`.
