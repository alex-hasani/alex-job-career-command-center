const normal = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const cityAliases = {
  'frankfurt am main':['frankfurt am main','frankfurt'],
  munich:['munich','munchen'],
  cologne:['cologne','koln'],
  dusseldorf:['dusseldorf'],
  nuremberg:['nuremberg','nurnberg'],
  hannover:['hannover','hanover'],
  shanghai:['shanghai','上海'],
  beijing:['beijing','北京'],
  guangzhou:['guangzhou','广州'],
  shenzhen:['shenzhen','深圳'],
  hangzhou:['hangzhou','杭州'],
  chengdu:['chengdu','成都'],
  nanjing:['nanjing','南京'],
  suzhou:['suzhou','苏州'],
  wuhan:['wuhan','武汉'],
  "xi'an":["xi'an",'xian','西安'],
  chongqing:['chongqing','重庆'],
  tianjin:['tianjin','天津'],
  qingdao:['qingdao','青岛'],
  xiamen:['xiamen','厦门'],
  ningbo:['ningbo','宁波']
};

const chinaMajorCities = ['shanghai','beijing','guangzhou','shenzhen','hangzhou','chengdu','nanjing','suzhou','wuhan',"xi'an",'chongqing','tianjin','qingdao','xiamen','ningbo'].flatMap(city => cityAliases[city] || [city]);

function queryTokens(group) {
  const raw = group.match(/"[^"]+"|\bNOT\b|\bAND\b|[^\s]+/gi) || [];
  const tokens = [];
  let negate = false;
  for (const item of raw) {
    const value = item.replace(/^\(|\)$/g, '').replace(/^"|"$/g, '').trim();
    if (!value || /^and$/i.test(value)) continue;
    if (/^not$/i.test(value)) { negate = true; continue; }
    tokens.push({ value:normal(value), negate });
    negate = false;
  }
  return tokens;
}

export function matchesBooleanText(job, query) {
  if (!String(query || '').trim()) return true;
  const haystack = normal([job.title, job.company, job.description, job.jdSnapshot, ...(job.evidence || []), ...(job.resumeStrengths || [])].join(' '));
  const groups = String(query).split(/\s+OR\s+/i).map(queryTokens).filter(group => group.length);
  return groups.some(group => group.every(token => token.negate ? !haystack.includes(token.value) : haystack.includes(token.value)));
}

export function matchesLocation(job, selectedLocation, cityOptions = [], includeRemoteAnywhere = false) {
  const selected = normal(selectedLocation);
  if (!selected) return true;
  const jobLocation = normal(job.location);
  // Municipalities that fall within, or touch, the 50 km straight-line search
  // radius used by the live providers around central Stuttgart.
  const stuttgartArea = [
    'backnang','bad friedrichshall','bietigheim-bissingen','boblingen','ditzingen',
    'esslingen','fellbach','filderstadt','goppingen','heilbronn','herrenberg',
    'kirchheim unter teck','kornwestheim','leinfelden-echterdingen','leonberg',
    'ludwigsburg','marbach am neckar','metzingen','neckarsulm','nurtingen',
    'ostfildern','pforzheim','remseck am neckar','reutlingen','schorndorf',
    'sindelfingen','stuttgart','tubingen','vaihingen an der enz','waiblingen',
    'weinstadt','winnenden'
  ];
  const shanghaiOnly = selected === 'shanghai only';
  const chinaSelection = selected === 'china major cities' || selected === 'shanghai + hybrid' || shanghaiOnly || chinaMajorCities.includes(selected);
  const selectedScope = selected === 'stuttgart area'
    ? stuttgartArea
    : selected === 'china major cities'
      ? chinaMajorCities
      : selected === 'shanghai + hybrid' || shanghaiOnly
        ? cityAliases.shanghai
        : (cityAliases[selected] || [selected]);
  const directMatch = selectedScope.some(place => jobLocation.includes(place));
  if (shanghaiOnly) return directMatch && !job.remote;
  if (directMatch) return true;

  // A location-independent remote job can match a city search. A role tied to
  // another named city cannot match merely because its work model is hybrid.
  const remoteRegion = chinaSelection
    ? /(^|\b)(remote|anywhere|worldwide|china|apac|asia)(\b|$)/i
    : /(^|\b)(remote|anywhere|worldwide|germany|deutschland|europe|eu|emea)(\b|$)/i;
  const incompatibleRegion = chinaSelection
    ? /\b(germany|deutschland|europe|eu|emea)\b/i.test(jobLocation) && !/\b(anywhere|worldwide|china|apac|asia)\b/i.test(jobLocation)
    : /\b(china|apac|asia)\b/i.test(jobLocation) && !/\b(anywhere|worldwide|germany|deutschland|europe|eu|emea)\b/i.test(jobLocation);
  if (incompatibleRegion) return false;
  if (!includeRemoteAnywhere || !job.remote || !remoteRegion.test(jobLocation)) return false;
  const knownCities = [...new Set(cityOptions.flatMap(value => {
    const city = normal(Array.isArray(value) ? value[0] : value);
    if (!city || city === 'stuttgart area' || city === 'china major cities' || city === 'shanghai + hybrid' || city === 'shanghai only') return [];
    return cityAliases[city] || [city];
  }))];
  return !knownCities.some(city => !selectedScope.includes(city) && jobLocation.includes(city));
}

export function matchesLanguage(job, selectedLanguage) {
  if (!selectedLanguage) return true;
  const actual = normal(job.rawLanguage);
  const selected = normal(selectedLanguage);
  return selected === 'english accepted' ? actual.includes('english') : actual === selected;
}

export function matchesWorkType(job, selectedWorkType) {
  if (!selectedWorkType) return true;
  const actual = normal([job.workType, job.employment].filter(Boolean).join(' '));
  const selected = normal(selectedWorkType);
  if (selected === 'full-time') return /full[ -]?time|vollzeit|permanent/.test(actual);
  if (selected === 'part-time') return /part[ -]?time|teilzeit/.test(actual);
  if (selected === 'contract') return /contract|freelance|fixed[ -]?term|befristet/.test(actual);
  return actual === selected;
}

export function matchesSource(job, selectedSource) {
  if (!selectedSource) return true;
  const selected = normal(selectedSource);
  return [job.source, job.provider, ...(job.sources || [])].some(value => normal(value) === selected);
}

export function matchesExperience(job, selectedExperience) {
  return !selectedExperience || normal(job.experience) === normal(selectedExperience);
}
