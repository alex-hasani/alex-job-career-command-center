# Public mirror guardrails

The only Git repositories for this project are:

- Private operational repository: `E:\Projects\Job Search\dynamic-job-dashboard`
- Sanitized public mirror: `E:\Projects\Job Search\Public\alex-job-career-command-center`

Never initialize Git in the parent Job Search directory.

## Private workflow

Commit validated intentional changes only to the private repository. Keep all runtime state, OAuth material, generated documents, applications, personal information, databases, backups and logs private.

## Public mirror workflow

The public mirror is code-and-documentation only. Rebuild or update it from a reviewed safe allowlist: application source, tests using example data, public assets, package manifests, and documentation. Do not copy application state, resumes, profiles, job records, mailbox-derived sources, OAuth or client-secret material, credentials, tokens, keys, databases, spreadsheets, generated packages, backups or logs.

`gmail-discovered-sources.json` must remain an empty array in the public mirror. Public Git history must also be scanned: removing a file in a later commit does not remove sensitive data from earlier commits.

## Enforced release gate

After cloning the public repository, run:

```powershell
npm run install:public-guard
```

This installs local `pre-commit` and `pre-push` hooks that run `npm run audit:public`. The audit must pass before every public commit and push. Review the staged diff, run focused tests, and confirm `HEAD` equals `origin/main` after pushing.
