# Alex Job Career Command Center

A privacy-safe public v1.0 of a local-first job-search application. It combines live vacancy discovery, evidence-based job evaluation, application tracking, and bilingual ATS-friendly document generation in one responsive dashboard.

This repository is designed for technical review. All candidate details, employers, dates, metrics, mailbox evidence, applications, and commute origins are fictional or generic. The operational repository and runtime data remain private.

## What it demonstrates

- Parallel search across structured APIs, employer career pages, job boards, recruiters, and regional sources
- Canonical URL and company/title/location deduplication
- Job freshness, hard-blocker, requirement/evidence, interview-fit, opportunity-quality, and application-priority analysis
- Responsive list and board views with instant local filtering
- SQLite as the source of truth, with serialized spreadsheet mirroring and dated backups
- Application lifecycle history with preserved event timestamps
- German and English CV and cover-letter generation from one evidence map
- Versioned application packages, editable previews, DOCX/PDF exports, and restoration of earlier versions
- Strict separation of verified experience, transferable evidence, learning, gaps, and blockers
- Local-only default binding and ignored runtime/private data

## Architecture

```text
Live sources and saved career state
              |
              v
       search + normalization
              |
              v
 SQLite job/application database ----> responsive dashboard
              |
              +----> spreadsheet mirror and dated backups
              |
              +----> evidence-gated CV and cover-letter packages
```

The browser performs instant filters against SQLite-backed results already loaded from the local server. A live refresh contacts sources, records diagnostics, deduplicates results, rechecks availability, saves SQLite first, and queues the spreadsheet mirror.

## Run locally

Requirements:

- Node.js 22.5 or newer for `node:sqlite`
- Microsoft Edge or Google Chrome for text-based PDF export

Install the public dependencies and start the app:

```powershell
npm install
npm start
```

Open `http://localhost:8787`. The server binds to `127.0.0.1` unless `HOST` is explicitly set. Runtime state is created under `runtime/`, which is ignored by Git. To store runtime files elsewhere, set `ALEX_JOB_DATA_DIR` to an absolute local directory.

Spreadsheet import/export uses `@oai/artifact-tool` when running inside its supported workspace runtime. The dashboard, SQLite workflow, search, scoring, and document engine remain inspectable independently.

## Validate

```powershell
npm test
npm run audit:public
```

The public audit rejects secrets, non-example email addresses, likely phone numbers, private keys, runtime databases, generated documents, mailbox evidence, private state directories, and private Git history indicators.

## Privacy model

- `canonical-resume-profile.mjs` contains a clearly fictional profile.
- `gmail-discovered-sources.json` is intentionally empty.
- Email reconciliation accepts only a local ignored evidence file at runtime.
- SQLite, spreadsheets, generated packages, backups, logs, source health, and local configuration are ignored.
- This repository has fresh history; private commits and the private v1.0 tag were not copied.
- Every future mirror must pass the public audit before it can be pushed.

See [PRIVACY.md](PRIVACY.md), [SECURITY.md](SECURITY.md), and [PRODUCTION_BASELINE.md](PRODUCTION_BASELINE.md).

## Scope and safety

The application prepares and tracks application work. It does not submit applications or send email. Generated documents require human review before use. Salary estimates, employer risk, and market signals must remain labelled by evidence type and should not be presented as confirmed facts without a source.

## License

Copyright 2026 Alex Hasani. All rights reserved. The source is public for portfolio review; no reuse licence is granted at this time.
