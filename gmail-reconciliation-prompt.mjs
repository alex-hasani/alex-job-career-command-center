function checkpointValue(metadata) {
  if (!metadata?.value) return '';
  try {
    const parsed = JSON.parse(metadata.value);
    return typeof parsed?.at === 'string' ? parsed.at : '';
  } catch {
    return '';
  }
}

export function buildGmailReconciliationPrompt({
  days = 7,
  primaryAccount,
  forwardedAccount,
  checkpointMetadata = null
}) {
  const checkpointAt = checkpointValue(checkpointMetadata);
  const startRule = checkpointAt
    ? `Use checkpoint ${checkpointAt}; consider only messages strictly newer than it.`
    : `No checkpoint exists; use the last ${days} days.`;

  return [
    `Run the token-efficient Gmail lifecycle reconciliation for ${primaryAccount}, including forwarded or attached messages from ${forwardedAccount}.`,
    startRule,
    `Make exactly one metadata-only Gmail search using focused application lifecycle terms, after: with the calendar date one day before the start, excluding spam, trash and promotions; limit 100 and do not paginate. If capped, stop without advancing the checkpoint.`,
    `Discard outbound applications already recorded, alerts, newsletters, security/login mail, delivery failures, out-of-office replies and unrelated mail from metadata. Batch-read exact content once for only new plausible lifecycle candidates, maximum 20; include required forwarded or attached content.`,
    `Record only explicit confirmations, interview events, rejections, offers, withdrawals, cancellations or closures. Deduplicate by Gmail message ID plus original timestamp plus status, preserve that timestamp, append only new evidence, then run one incremental SQLite/Career Command Center reconciliation and one Excel sync.`,
    `For every batch-read message, inspect useful job-board, recruiter and employer-career domains. Compare against all active registries first; browse only unknown beneficial domains, verify the official reachable jobs URL, and add only canonical non-ATS sources to the local discovered-source file. Ignore tracking, login, unsubscribe, delivery, shared ATS, duplicates and unavailable domains.`,
    `If nothing changed, only record the reviewed count and checkpoint. Never send email or apply. Return compact counts and confirmed changes only.`
  ].join(' ');
}

export function gmailReconciliationCheckpoint(metadata) {
  return checkpointValue(metadata) || null;
}
