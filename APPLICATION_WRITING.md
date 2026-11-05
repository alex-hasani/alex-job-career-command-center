# Codex application writing and independent review

New IT and Teaching application packages use the signed-in Codex CLI on the dashboard host. The host must be awake, online and signed in to Codex. This is **not offline inference**: the CLI uses its configured OpenAI service/account and usage limits. No separate API key is stored by this integration.

The writer receives the exact advertisement, that track's career evidence and draft documents. It fully tailors the documents in a direct, practical, specific professional voice, without inventing facts or excessive employer praise. This style brief reflects the user's approved communication preferences; it does not ingest or expose chat transcripts.

A fresh independent Codex session reviews the entire package. It checks voice, facts, relevance and position identity, not an AI-detector score or proof of human authorship. A rejected draft gets at most one repair and another independent review. Only a passing package can create final files. Manual edits and restores are reviewed without silently rewriting them. An unavailable CLI, malformed output, rejected review or changed protected CV detail blocks release. Existing files are preserved; older packages must be regenerated before download/application under this policy.

Review records bind approval to the exact document text and job identity. They are private package metadata, never inserted into the CV or letter. IT and Teaching continue using their separate evidence, archives and databases. No applications are sent by this process.

Codex runs with a read-only sandbox in a fresh temporary directory, without loading user configuration. Shell, browser, computer, connected-app and multi-agent tools are disabled. Prompts go through stdin rather than command arguments; temporary input/output files are removed afterward. Neither prompts nor CLI diagnostics are logged by the integration. Codex service-side processing still follows the account's data policies.

On Windows, the executable is discovered under the installed Codex app or on PATH. An administrator can set `ALEX_JOB_CODEX_BINARY` to an absolute executable path if the service account cannot discover it. Never put credentials in this variable. Default timeout is four minutes per writer/reviewer invocation; normal generation takes at least two invocations. No silent template fallback is used.

Validation: `node --test application-writing-review.test.mjs application-package.test.mjs teaching-application-service.test.mjs`. Unit tests inject a fictional reviewer; a real CLI connection must also be tested separately before deployment is claimed.

## Entry-point coverage

For the protected account, dashboard preparation/regeneration, ready-to-send preparation, Fast Apply, IT Chrome helper retries, Teaching Chrome helper retries and Teaching website application all consume the same reviewed packages. Personalized IT helpers must not substitute the original uploaded resume for the tailored package. Portal notes come from the reviewed package's remarks in the selected language, not a second template. Account form facts remain profile values; unknown site-specific questions are not invented.

The protected account's Profile-page ATS/base and job-focused drafts also use the shared writer/reviewer, grounded only in that account's uploaded resume and saved profile. Without an advertisement they remain general base drafts and do not invent a vacancy. Other accounts never receive the protected account's canonical career evidence. No extension reinstall is necessary for these server-side rules. Validate routing with `node --test tailoring-paths.test.mjs`.

Explicit, dated candidate corrections may be stored privately in `Config/candidate-facts.json` outside the source repository. The writer and reviewer receive them as current user-confirmed facts, taking precedence only over the specific older wording they correct. Supported course-completion corrections remove stale in-progress qualifiers without inferring a certificate or a higher language level. Original masters and historical application files are not rewritten. Regenerate older packages under the current review policy.
