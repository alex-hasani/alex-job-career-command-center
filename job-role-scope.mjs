const normal = value => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

const excludedCommercialRole = /\b(?:sales|salesforce|vertrieb|vertriebs|verkauf|verkaufs|account executive|account manager|key account|business development|customer success|kundenberater|finanzberater|accountant|accounting|accounts payable|accounts receivable|bookkeep|finance|financial controller|financial analyst|payroll|buchhalt|finanzbuchhalt|lohnbuchhalt|bilanzbuchhalt|kreditor|debitor|steuerfach|steuerberater|controller|controlling)\b/i;
const technicalRole = /\b(?:it|ict|information technology|system(?:s)? administrat|system engineer|systemarchitekt|infrastructure|infrastruktur|server administrat|windows server|linux|unix|cloud|azure|microsoft 365|m365|active directory|entra|intune|network|netzwerk|devops|site reliability|sre|platform engineer|platform administrat|cyber.?security|it.?security|information security|security engineer|datacenter|data center|rechenzentrum|virtuali[sz]|vmware|endpoint|modern workplace|application administrat|anwendungsadministrat|technical support|technischer support|it support|service desk|help ?desk|l2 support|l3 support|it consultant|it berater|technical consultant|software (?:developer|engineer)|softwareentwick|developer|database administrat|datenbankadministrat|data engineer|automation engineer|it service engineer|fachinformatiker)\b/i;

export function isTechnicalRole(job = {}) {
  const title = normal(job.title || job.position || job.name);
  if (!title || excludedCommercialRole.test(title)) return false;
  return technicalRole.test(title);
}
