function slug(value = '') {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fillTemplate(template, term, location) {
  const values = {
    keywords: encodeURIComponent(term),
    keywordSlug: slug(term),
    location: encodeURIComponent(location),
    locationSlug: slug(location)
  };
  return String(template || '').replace(/\{(keywords|keywordSlug|location|locationSlug)\}/g, (_, key) => values[key]);
}

export function buildSourceSearchUrls(site = {}, terms = [], location = 'Germany') {
  const templates = Array.isArray(site.searchUrlTemplates)
    ? site.searchUrlTemplates.filter(Boolean)
    : site.searchUrlTemplate ? [site.searchUrlTemplate] : [];
  if (!templates.length) return [];
  const limit = Math.max(1, Math.min(5, Number(site.searchLaneLimit) || 1));
  const selected = [...new Set(terms.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit);
  return [...new Set(templates.flatMap(template => selected.map(term => fillTemplate(template, term, location || 'Germany'))).filter(url => /^https?:\/\//i.test(url)))];
}
