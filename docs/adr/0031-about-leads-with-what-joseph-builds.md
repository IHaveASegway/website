# ADR 0031: About leads with what Joseph builds, the labs say where they're going, and a post can leave

Status: Accepted · 2026-11-03 · Deciders: Joseph Peterson

## Context

Reading a draft of About on 2026-11-03, Joseph set three things the site had got wrong or left unsaid.

**What the page is about.** The bio opened on "I build the backend systems other software runs on", a list of system kinds, and ended on wanting to be a software architect. Joseph's words were: "I love building products consumers can use", "I really love solving problems at the core of it", and of the architect line, cut it for now, since it's apparent that's on their roadmap. Recruiters and tech leads stay the readers, anyone offering freelance work joins them, and all of them should reach out on LinkedIn.

**What the labs are for.** The site named how many labs there were, on Home, and called them practice. Joseph's words: there'll be more, and they'll eventually unify "into something like the bakery software, which will tie all the labs together". That is the end goal: to explain parts of the software it takes to run a business at scale, safely and with good performance.

**A published post.** A teardown of an old project had been live since 2026-10-25, and the skills list cited it. Joseph chose to make that repository private and remove every reference to it: "Just delete the writings on it as well." ADR 0005 says a URL once published is a promise, and said nothing about a post that leaves.

## Decision

**About leads with what Joseph builds.** The head is the name, the role and where. Then the opening, whose first sentence, "I take an idea and build the entire system", is also Home's statement; how they got here; the biggest thing they've built, in round words; the labs and the open source as rows, each a link; the last thing built, with what it costs and what it can't show; what came from them; the tools, on one small line; and the close, with LinkedIn to press. Every word is `src/content/about.md`. Home reads the rows, the biggest thing and the last thing built from it, and stops linking kinds of system. The architect goal stays Joseph's goal, and leaves the page.

**LinkedIn is how people reach Joseph.** No page asks a reader to email. The email buttons and the copy controls come out; the address stays as plain text in the footer and on paper.

**On paper it stays one sheet of US Letter**: the opening as the summary, the biggest thing, Background, the tools, then "I didn't type this site's code" over Selected work, so nobody reads built as typed. The skills' names come off: they'd print the labs' tools as Joseph's, with no note saying who typed them.

**No page counts the labs, and /lab/ states their end goal**: to tie them together into the made-up bakery's working software. A test reads every built file for a number beside "labs".

**A published post can leave.** The file goes. Its URL and its link card answer with a 301 to its section's index, or to the post that replaces it, with no chain, and its line stays in the ledger, which stays append-only. Everything a reader could reach goes with it, and a test reads the build for its words. See ADR 0005's postscript of today.

**stillhere is linked as it stands.** Its check and the GitHub profile's are recorded at the commit they read, because Joseph accepted the commit identities outside the allowed list and the scan's hits as they are. Its card leads with its limits and its published failed metric.

## Alternatives

| Option | Gains | Costs | Verdict |
|---|---|---|---|
| Keep the teardown, with its details softened | An essay about a real mistake stays; Writing keeps two posts | It points readers at a repository Joseph has decided to make private, and a softened post still names what it was about | No: Joseph's call, and the redirect keeps the URL's promise |
| Publish the exact work numbers on About | Exact figures read as stronger proof, and recruiters remember them | Exact figures narrow toward one company, and the firewall exists to stop that. They can't link to public evidence, which every other number on the site does | No: round words only, in `about.md`, in no test, doc or commit |
| Link stillhere only after a history rewrite | A history with only allowed identities, and no scan hits to weigh | Every later commit SHA changes, which breaks the tags and links that point at them, and the site's card waits on it. A rewrite isn't a recall: clones keep the old history | No: Joseph accepted the state of the repository. It stays the way back, if a reason appears |
| Keep the bio's old opening and add the new sections under it | The system kinds stay on the first screen for a tech lead scanning for them | It keeps saying what Joseph told us it isn't: an opening about kinds of system, for someone who builds whole products | No |
| Keep the architect line, as one sentence before the close | A hiring manager sees the direction | The founder and CTO readers took it as someone heading away from building | No, for now: one line brings it back |

## Consequences

- The site's positioning changes (`docs/product.md`), and the readers it names gain anyone offering freelance work.
- `profile.json`'s `skills` have no reader on the page. They're kept, with their evidence kept true, and Joseph can delete them or give them a use.
- With the teardown gone, the site holds no page with code, so the checks of inline code read the writing fixture, or code they add to the essay.
- About's order, led by the Cache Lab, is Home's too; `/lab/` and the command menu keep their own, easiest first.
- A reader who kept a link to the teardown lands on `/writing/`, which no longer mentions it. Search engines drop the page in time, and archives keep what they kept: a 301 can't recall a copy.

## Door

Two-way for the words, the layout and the lead. One-way in the small for what was published: the teardown was public for nine days, and stillhere's link sends readers to everything its history holds, so taking it down later doesn't take back what they read. A published URL stays a promise whichever way this goes.

## Revisit if

- A recruiter or a tech lead shown About for a minute can't say what Joseph does, or reads the labs as Joseph's day job.
- Readers ask for the exact numbers, and Joseph's firewall review finds a way to back them with something public.
- The bakery's software ships, and the labs' end goal stops being a goal: then `/lab/` says what it became.
- A later reader of stillhere's history raises an identity or a scan hit: then a history rewrite is back on the table.

## Further reading

- Tim Berners-Lee, [Cool URIs don't change](https://www.w3.org/Provider/Style/URI) (1998), on why a URL outlives its page.
- Steve Krug, *Don't Make Me Think*, 3rd ed., ch. 7, on what a home page has to say first.
