# Public repository instructions

## Release boundary

`v1.0` is the immutable public production baseline. Preserve working behavior unless a requested change explicitly requires modifying it.

## Strict change isolation

- Modify only the named module, section, or defect.
- Do not perform opportunistic refactors, restyling, renaming, or adjacent fixes.
- Stop for explicit approval if a solution requires unrelated modules.

## Privacy gate

- This repository contains demonstration data only.
- Never copy the private candidate profile, contact data, employment evidence, Gmail content, application records, commute origin, databases, spreadsheets, documents, backups, logs, or credentials.
- Keep local profile, mailbox, state, generated packages, and source-health files ignored.
- Run `npm run audit:public` before every commit and again before every push.
- If the audit fails, do not commit or push until every finding is removed.

## Required completion workflow

1. Check the working tree and isolate the requested files.
2. Run focused tests and the full public audit.
3. Review the complete staged diff.
4. Commit with a focused message.
5. Push `main` and relevant release tags.
6. Verify local HEAD equals `origin/main` before reporting success.
