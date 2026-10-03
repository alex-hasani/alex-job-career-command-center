# User space

The account page is the first landing page at `/` and remains directly available at `/user-space`. After sign-in, **Open career dashboard** loads the existing app at `/dashboard`. Signed-out requests to `/dashboard` and `/index.html` return to the account landing page. The application database, browser helper, Gmail workflow, and application procedures remain unchanged and are not made multi-tenant by this release.

## Security boundary

- Account records are stored in the separate runtime database `../State/user-space.sqlite`.
- Passwords are never stored or logged. Each password is independently salted and hashed with memory-hard scrypt parameters before its verifier is written to SQLite.
- Login sessions use 256-bit opaque random tokens. Only SHA-256 hashes of those tokens are stored in SQLite.
- Session cookies are `HttpOnly` and `SameSite=Strict`; HTTPS requests also receive the `Secure` attribute and the `__Host-` cookie prefix.
- Mutating requests require both a same-origin request and the session's CSRF token.
- Registration and login are throttled per client address.
- Credentials, SQLite files, uploaded resumes, and generated drafts remain outside Git.

## Resume boundary

Each account receives an opaque UUID and an isolated folder under `../State/user-space-files/<user-id>/`. Uploads accept text-based PDF or TXT files up to 8 MB. The backend hashes uploads and does not store a second copy of an identical source resume for the same user.

The refinement engine normalizes the uploaded source text and, when a job description is supplied, prioritizes exact evidence already present in that source. Missing job-description terms are listed as review-only gaps. They are not added to the draft. Every stored draft points back to its source document and records whether it is an ATS base or job-focused result.

This release deliberately does not send uploaded resumes to an external AI provider. It establishes the secure, evidence-constrained data boundary first. A future model-backed rewriting stage can be added behind that boundary only with explicit data-processing authorization and must retain the same source-only audit guarantees.

PDF text extraction uses the separately declared, security-audited PDF.js dependency rather than an unspecified system copy.

## Runtime overrides for isolated testing

- `USER_SPACE_DB_PATH`
- `USER_SPACE_STORAGE_ROOT`

These optional environment variables permit end-to-end tests against disposable state without touching live accounts.
