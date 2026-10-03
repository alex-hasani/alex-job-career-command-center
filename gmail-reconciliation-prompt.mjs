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
    `Reconcile Gmail lifecycle mail for ${primaryAccount}, including forwarded or attached mail from ${forwardedAccount}.`,
    startRule,
    `Use one logical metadata-only search with focused lifecycle terms and after: set to one calendar day before the start; exclude spam, trash and promotions. Fetch 100 per page, follow at most 5 pages, deduplicate IDs, and open no bodies while paging.`,
    `From metadata discard recorded outbound mail, alerts, newsletters, login/security mail, delivery failures, out-of-office replies and unrelated mail. Batch-read plausible candidates once, maximum 20, including needed forwarded or attached content.`,
    `Record only explicit confirmations, interviews, rejections, offers, withdrawals, cancellations or closures. Deduplicate by message ID, original timestamp and status; preserve timestamps; append only new evidence; run one incremental SQLite/Career Command Center reconciliation and one Excel sync.`,
    `For read messages, compare useful domains with active registries; browse only unknown beneficial domains and add only verified reachable canonical non-ATS sources. Ignore tracking, login, unsubscribe, delivery, shared ATS, duplicates and unavailable domains.`,
    `Sort newer mail oldest first. Above 20 candidates, process the oldest complete slice and advance via CHECKPOINT_AT only through the newest fully reviewed timestamp; leave later mail for the next run. Otherwise advance to run time. Never send email or apply. Return compact changes only.`
  ].join(' ');
}

export function gmailReconciliationCheckpoint(metadata) {
  return checkpointValue(metadata) || null;
}
