## What and why

<!-- One paragraph: the need, what changed, and the roadmap item or ADR it serves. -->

## Content firewall: what regex cannot see

CI scans the text. These need a person ([security.md](https://github.com/IHaveASegway/website/blob/main/docs/security.md#what-regex-cannot-see)).
Anything sensitive goes in the private record, never in this pull request: its text goes public
with the repository.

- [ ] No employer, private venture, product, internal system, colleague, internal metric, city or
      region appears in any changed file, file name, commit message, branch name or this
      description, paraphrased or not.
- [ ] Read with the rest of the site, nothing here narrows to an employer (the mosaic rule in
      [content.md](https://github.com/IHaveASegway/website/blob/main/docs/content.md#firewall-classes-for-copy)). Every ASK item is cleared in
      the private record.
- [ ] Images and screenshots show owned work only, cropped to the content, with no work tool, no
      browser chrome and no colo.
- [ ] Every image and PDF is free of EXIF, XMP and IPTC metadata (the pre-commit hook and verify
      check it too).
- [ ] No PDF was added, or each one's text and metadata was read.
- [ ] No archive, Office document or other packed file (zip, docx, xlsx, gz) was added. No rule
      can read inside one, so the firewall refuses it: commit what it holds instead.
- [ ] No new name outside the repository (the workers.dev subdomain, a Worker or account name, an
      Email Routing destination), or it names nothing private.
- [ ] Re-read the title and description after any edit: CI scans an edited title or description
      again (pr-text.yml), but on a public repository the edit is public before the scan runs.
- [ ] Any new link to a repository or profile passed the
      [readiness checklist](https://github.com/IHaveASegway/website/blob/main/docs/content.md#repo-readiness-checklist) first.
- [ ] Copy passes the banned-words list in [content.md](https://github.com/IHaveASegway/website/blob/main/docs/content.md#voice), and changed
      copy was read again on a later day than it was written.

## Accessibility: what axe cannot see

- [ ] Keyboard only: every control is reachable in order, its focus is visible, and nothing traps
      focus. A VoiceOver pass (macOS) reads each changed page and control sensibly, with reduced
      motion on, in light and in dark.
