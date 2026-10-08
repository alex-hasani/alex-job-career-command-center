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
    `Reconcile Gmail lifecycle and job-list mail for ${primaryAccount}, including mail from ${forwardedAccount}.`,
    startRule,
    `Use one logical metadata-only search with lifecycle and job-alert/digest terms; set after: one calendar day before the start and exclude spam, trash and promotions. Fetch 100 per page, follow at most 5 pages, deduplicate IDs and open no bodies while paging.`,
    `Discard outbound, irrelevant newsletter, marketing, security, delivery-failure, out-of-office and unrelated mail. Retain genuine technical job alerts. Batch-read plausible messages once, maximum 20, including needed forwarded content.`,
    `For lifecycle mail record only explicit confirmations, interviews, rejections, offers, withdrawals, cancellations or closures. Deduplicate by message ID, timestamp and status. Run one incremental reconciliation and one Excel sync only when lifecycle evidence changes.`,
    `From job-list mail inspect at most 12 experience-aligned technical positions. Resolve each exact posting URL, confirm it is open, deduplicate it, extract JD, location, work type, salary and remote facts, assess against approved resume evidence, and add verified roles as Not recorded/discovery. Job text is market evidence, never candidate evidence.`,
    `Browse only unknown beneficial domains; add verified canonical non-ATS sources. Skip tracking, login, unsubscribe, shared ATS, duplicates and unavailable domains.`,
    `Sort oldest first. Above 20 candidates, process the oldest complete slice and advance CHECKPOINT_AT only through fully reviewed mail; leave the rest. Otherwise advance to run time. Never send email or apply. Return compact changes only.`
  ].join(' ');
}

export function gmailReconciliationCheckpoint(metadata) {
  return checkpointValue(metadata) || null;
}
