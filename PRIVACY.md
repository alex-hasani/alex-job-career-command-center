# Privacy policy for the public source mirror

This repository is a sanitized portfolio mirror. Its sample candidate and career history are fictional. It must not be used as storage for real job-search or personal data.

## Never commit

- Names, personal email addresses, telephone numbers, home addresses, private profile URLs, identity or immigration details
- Real employers, dates, achievements, metrics, education, language levels, or references from a private candidate profile
- Job applications, recruiter conversations, interview or rejection outcomes, mailbox evidence, or message timestamps
- SQLite or other databases, spreadsheets, generated CVs and letters, posting snapshots, backups, logs, or source-health evidence
- API keys, tokens, cookies, OAuth material, certificates, private keys, or filled local configuration

## Release rule

Every public mirror is blocked unless `npm run audit:public` passes on both the working tree and available Git history. A passing automated scan is necessary but not sufficient: the staged diff must also receive human-readable review before push.

If sensitive data is ever committed, treat it as exposed: revoke credentials where applicable, remove the repository from public access, and rewrite public history before republishing.
