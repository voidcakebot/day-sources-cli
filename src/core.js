const MONTH_NAMES = [
  'january','february','march','april','may','june','july','august','september','october','november','december'
];

const DE_STATES = ['BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'];

export function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    sources: ['1', '3'],
    json: false,
    country: 'DE',
    state: 'BY',
    germanyMode: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--sources') {
      const raw = String(argv[++i]);
      args.sources = raw === 'all' ? ['1','2','3','4','5','6'] : raw.split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--json') args.json = true;
    else if (a === '--country') args.country = String(argv[++i]).toUpperCase();
    else if (a === '--state') args.state = String(argv[++i]).toUpperCase();
    else if (a === '--germany-mode') args.germanyMode = true;
  }

  return args;
}

function mdDate(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return { day: d.getUTCDate(), monthName: MONTH_NAMES[d.getUTCMonth()], year: d.getUTCFullYear() };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'day-sources-cli/0.2' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function cleanup(line) {
  return line
    .replace(/^\*\s+/, '')
    .replace(/^[-#>\s]+/, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function curatedExtract(text, patterns, limit = 6, strictDate = false) {
  const lines = text
    .split('\n')
    .map(cleanup)
    .filter(Boolean)
    .filter(l => l.length > 10 && l.length < 220)
    .filter(l => !/(skip to|cookies|main content|menu|impressum|datenschutz|source:|url source:|http:|https:|^title:|^\*\s|\!\[image)/i.test(l))
    .filter(l => !/^\d{1,2}\s+[a-z]+\s+\d{4}$/i.test(l));

  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const lc = line.toLowerCase();
    const dateHit = patterns.some(p => lc.includes(p));
    if (strictDate && !dateHit) continue;
    const score = patterns.reduce((acc, p) => acc + (lc.includes(p) ? 3 : 0), 0) + ((/international|world|tag|day|namenstag|feiertag|observance/i.test(lc)) ? 1 : 0);
    if (score < (strictDate ? 3 : 2)) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push({ line, score });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.line);
}

function monthToNum(token) {
  const t = token.toLowerCase().slice(0, 3);
  const m = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  return m[t] || null;
}

function parseDateLine(line) {
  const l = cleanup(line);
  let m = l.match(/^(\d{1,2})\s+([A-Za-z]{3,9})$/);
  if (m) return { day: Number(m[1]), month: monthToNum(m[2]) };
  m = l.match(/^([A-Za-z]{3,9})\s+(\d{1,2})$/);
  if (m) return { day: Number(m[2]), month: monthToNum(m[1]) };
  return null;
}

function parseMarkdownDatedObservances(text, targetDay, targetMonth) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] || '';
    if (!raw.includes('](')) continue;
    const line = cleanup(raw);
    if (!/(International|World|Day|Observance|Tourism|Language|Justice)/i.test(line)) continue;

    const offsets = [1,2,3,4,-1,-2,-3,-4];
    const dated = offsets
      .map(off => ({ off, d: parseDateLine(lines[i + off] || '') }))
      .filter(x => x.d && x.d.month)
      .sort((a,b) => Math.abs(a.off) - Math.abs(b.off));
    const d = dated[0]?.d;
    if (!d || !d.month) continue;
    if (d.day === targetDay && d.month === targetMonth) {
      out.push(line.replace(/\s*\([^)]*\)\s*$/,'').trim());
    }
  }
  return [...new Set(out)].slice(0, 8);
}

async function source1UN(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const url = 'https://r.jina.ai/http://www.un.org/en/observances/list-days-weeks';
  const text = await fetchText(url);
  const parsed = parseMarkdownDatedObservances(text, day, month);
  return {
    source: '1',
    title: 'UN International Days',
    url,
    findings: parsed.length ? parsed : ['No UN observance found for this exact date in source list.']
  };
}

async function source2GermanyOfficial(dateIso, state) {
  const year = dateIso.slice(0, 4);
  const apiUrl = `https://feiertage-api.de/api/?jahr=${year}&nur_land=${state}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Holiday API failed: ${res.status}`);
  const data = await res.json();
  const hits = Object.entries(data)
    .filter(([, v]) => v?.datum === dateIso)
    .map(([k]) => `${k} (${state})`);

  return {
    source: '2',
    title: 'German official/public holiday data (state-specific)',
    url: [apiUrl, 'https://www.gesetze-im-internet.de/'],
    findings: hits.length ? hits : ['No public holiday on this date for selected state.']
  };
}

async function source3Institutions(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const urls = [
    'https://r.jina.ai/http://www.who.int/campaigns/world-health-days',
    'https://r.jina.ai/http://www.unesco.org/en/days',
    'https://r.jina.ai/http://european-union.europa.eu/priorities-and-actions/eu-solidarity-eu-citizens/eu-days_en'
  ];
  const findings = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      const exact = parseMarkdownDatedObservances(text, day, month);
      findings.push(...exact);
    } catch {
      // ignore single-source errors here, final fallback below
    }
  }
  return {
    source: '3',
    title: 'WHO/UNESCO/EU institution days',
    url: urls,
    findings: findings.length ? [...new Set(findings)].slice(0, 8) : ['No WHO/UNESCO/EU observance found for this exact date in current source pages.']
  };
}

async function source4NameDays(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const monthNamesEn = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthSlug = monthNamesEn[d.getUTCMonth()];
  const day = d.getUTCDate();
  const url = `https://www.namedaycalendar.com/germany/${monthSlug}/${day}`;
  const html = await fetchText(url);
  const names = [...html.matchAll(/<div class="name">\s*([^<]+)\s*<\/div>/gi)]
    .map(m => m[1].trim())
    .filter(Boolean);

  return {
    source: '4',
    title: 'German name days',
    url,
    findings: names.length ? [`Name days: ${names.join(', ')}`] : ['No German name-day names found on source page.']
  };
}

async function source5Aggregator(dateIso) {
  const { day, monthName, year } = mdDate(dateIso);
  const url = `https://www.timeanddate.com/holidays/germany/?year=${year}`;
  const text = await fetchText(url);
  const findings = curatedExtract(text, [`${monthName} ${day}`, `${day} ${monthName}`], 6, true);
  return {
    source: '5',
    title: 'Aggregator (timeanddate)',
    url,
    findings: findings.length ? findings : ['No exact aggregator date match found.']
  };
}

async function source6Curiosity(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const monthNamesDe = ['januar','februar','maerz','april','mai','juni','juli','august','september','oktober','november','dezember'];
  const monthSlug = monthNamesDe[d.getUTCMonth()];
  const day = d.getUTCDate();
  const url = `https://r.jina.ai/http://www.kuriose-feiertage.de/kalender/${monthSlug}/${day}/`;
  const text = await fetchText(url);
  const findings = curatedExtract(text, [`${day}. februar`, `am ${day}. februar`], 6, true)
    .filter(x => !/404|seite nicht gefunden|image/i.test(x))
    .filter(x => !/^\d{1,2}\.\s*[A-Za-zäöüÄÖÜ]+:?$/i.test(x));
  return {
    source: '6',
    title: 'Curiosity days (non-authoritative)',
    url,
    findings: findings.length ? findings : ['No curiosity-day entry extracted for this date.']
  };
}

export async function runLookup({ date, sources, state = 'BY', germanyMode = false }) {
  const normalizedState = DE_STATES.includes(state) ? state : 'BY';
  const safe = async (id, title, fn) => {
    try {
      return await fn();
    } catch (e) {
      return { source: id, title, url: '', findings: [`Source error: ${e.message}`] };
    }
  };

  const tasks = [];

  if (sources.includes('1')) tasks.push(safe('1', 'UN International Days', () => source1UN(date)));
  if (sources.includes('2')) tasks.push(safe('2', 'German official/public holiday data (state-specific)', () => source2GermanyOfficial(date, normalizedState)));
  if (sources.includes('3')) tasks.push(safe('3', 'WHO/UNESCO/EU institution days', () => source3Institutions(date)));
  if (sources.includes('4')) tasks.push(safe('4', 'German name days', () => source4NameDays(date)));
  if (sources.includes('5')) tasks.push(safe('5', 'Aggregator (timeanddate)', () => source5Aggregator(date)));
  if (sources.includes('6')) tasks.push(safe('6', 'Curiosity days (non-authoritative)', () => source6Curiosity(date)));

  const results = await Promise.all(tasks);

  let germany = null;
  if (germanyMode) {
    const byId = new Map(results.map(r => [r.source, r]));
    const holidays = byId.get('2') || await safe('2', 'German official/public holiday data (state-specific)', () => source2GermanyOfficial(date, normalizedState));
    const names = byId.get('4') || await safe('4', 'German name days', () => source4NameDays(date));
    germany = {
      state: normalizedState,
      publicHolidays: holidays.findings,
      nameDays: names.findings,
    };
  }

  return { date, requestedSources: sources, state: normalizedState, germanyMode, germany, results };
}

export function formatHuman(report) {
  const chunks = [
    `Date: ${report.date}`,
    `Sources: ${report.requestedSources.join(', ')}`,
    `State: ${report.state}`,
    ''
  ];

  if (report.germanyMode && report.germany) {
    chunks.push('Germany mode');
    for (const h of report.germany.publicHolidays) chunks.push(`  - Holiday: ${h}`);
    for (const n of report.germany.nameDays) chunks.push(`  - Nameday: ${n}`);
    chunks.push('');
  }

  for (const r of report.results) {
    chunks.push(`[${r.source}] ${r.title}`);
    chunks.push(`Ref: ${Array.isArray(r.url) ? r.url.join(', ') : r.url}`);
    if (!r.findings.length) chunks.push('  - No curated matches');
    for (const f of r.findings) chunks.push(`  - ${f}`);
    chunks.push('');
  }
  return chunks.join('\n');
}
