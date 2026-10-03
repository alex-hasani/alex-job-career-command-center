# User space

The account page is the first landing page at `/` and remains directly available at `/user-space`. After sign-in, **Open career dashboard** loads the existing app at `/dashboard`. Signed-out requests to `/dashboard` and `/index.html` return to the account landing page. The shared application database and Gmail workflow remain unchanged. Browser-helper command streams and application profiles are isolated per exported user helper.

## Security boundary

- Account records are stored in the separate runtime database `../State/user-space.sqlite`.
- Passwords are never stored or logged. Each password is independently salted and hashed with memory-hard scrypt parameters before its verifier is written to SQLite.
- Login sessions use 256-bit opaque random tokens. Only SHA-256 hashes of those tokens are stored in SQLite.
- Session cookies are `HttpOnly` and `SameSite=Strict`; HTTPS requests also receive the `Secure` attribute and the `__Host-` cookie prefix.
- Mutating requests require both a same-origin request and the session's CSRF token.
- Registration and login are throttled per client address.
- Credentials, SQLite files, uploaded resumes, and generated drafts remain outside Git.
- Personal helper exports contain a random helper token, never the account password. Only its SHA-256 hash is stored in SQLite.

## Global administration

The existing Alex account is migrated once to the protected `global_admin` role. Its immutable user ID—not a reusable username rule—is stored as the protected administrator identity. New registrations always receive the ordinary `user` role. Alex can list accounts, view access/session/document counts, enable or disable users, promote or demote other administrators, and revoke a user's active sessions. The protected Alex account cannot be disabled or demoted through the application.

The administrator rollout revokes all existing login sessions once. Dashboard tabs verify their session every 15 seconds and account pages every 5 seconds; unauthenticated pages return to `/`. The one-time service-worker update also navigates controlled open app windows to the login landing page.

## Personal Chrome helper

Each account can save its own form-filling profile and export an unpacked Chrome-helper ZIP after uploading a PDF resume. Every export receives a distinct manifest signing key, public identifier, token, and command channel, so helpers belonging to different users can coexist in one Chrome profile without sharing form data or files. A newly exported helper does not invalidate earlier exports.

Extract each ZIP to a separate permanent folder and load that folder through `chrome://extensions` with Developer mode and **Load unpacked**. The popup shows the bound profile name. The helper uses only that account's saved profile and latest PDF resume, respects login and CAPTCHA boundaries, and stops before final submission.

## Resume boundary

Each account receives an opaque UUID and an isolated folder under `../State/user-space-files/<user-id>/`. Uploads accept text-based PDF or TXT files up to 8 MB. The backend hashes uploads and does not store a second copy of an identical source resume for the same user.

The refinement engine normalizes the uploaded source text and, when a job description is supplied, prioritizes exact evidence already present in that source. Missing job-description terms are listed as review-only gaps. They are not added to the draft. Every stored draft points back to its source document and records whether it is an ATS base or job-focused result.

This release deliberately does not send uploaded resumes to an external AI provider. It establishes the secure, evidence-constrained data boundary first. A future model-backed rewriting stage can be added behind that boundary only with explicit data-processing authorization and must retain the same source-only audit guarantees.

PDF text extraction uses the separately declared, security-audited PDF.js dependency rather than an unspecified system copy.

## Runtime overrides for isolated testing

- `USER_SPACE_DB_PATH`
- `USER_SPACE_STORAGE_ROOT`

These optional environment variables permit end-to-end tests against disposable state without touching live accounts.
