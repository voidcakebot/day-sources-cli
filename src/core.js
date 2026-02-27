const MONTH_NAMES = [
  'january','february','march','april','may','june','july','august','september','october','november','december'
];

export function parseArgs(argv) {
  const args = { date: new Date().toISOString().slice(0, 10), sources: ['1','3'], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--sources') args.sources = String(argv[++i]).split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--json') args.json = true;
  }
  return args;
}

function mdDate(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const monthName = MONTH_NAMES[d.getUTCMonth()];
  return { day: d.getUTCDate(), monthName, year: d.getUTCFullYear() };
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'day-sources-cli/0.1' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function extractLines(text, patterns) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const lc = line.toLowerCase();
    if (patterns.some(p => lc.includes(p))) out.push(line);
    if (out.length >= 8) break;
  }
  return out;
}

export async function source1UN(dateIso) {
  const { day, monthName } = mdDate(dateIso);
  const url = 'https://r.jina.ai/http://www.un.org/en/observances/list-days-weeks';
  const text = await fetchText(url);
  const patterns = [`${monthName} ${day}`, `${day} ${monthName}`, 'international day'];
  return {
    source: '1',
    title: 'UN International Days',
    url,
    findings: extractLines(text, patterns)
  };
}

export async function source3Institutions(dateIso) {
  const { day, monthName } = mdDate(dateIso);
  const urls = [
    'https://r.jina.ai/http://www.who.int/campaigns/world-health-days',
    'https://r.jina.ai/http://www.unesco.org/en/days',
    'https://r.jina.ai/http://european-union.europa.eu/priorities-and-actions/eu-solidarity-eu-citizens/eu-days_en'
  ];
  const findings = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      const lines = extractLines(text, [`${monthName} ${day}`, `${day} ${monthName}`, 'day', 'world']);
      findings.push(...lines.slice(0, 3));
    } catch (e) {
      findings.push(`Failed to fetch ${url}: ${e.message}`);
    }
  }
  return {
    source: '3',
    title: 'WHO/UNESCO/EU institution days',
    url: urls,
    findings: findings.slice(0, 10)
  };
}

export async function runLookup({ date, sources }) {
  const jobs = [];
  if (sources.includes('1')) jobs.push(source1UN(date));
  if (sources.includes('3')) jobs.push(source3Institutions(date));
  const results = await Promise.all(jobs);
  return { date, requestedSources: sources, results };
}

export function formatHuman(report) {
  const chunks = [`Date: ${report.date}`, `Sources: ${report.requestedSources.join(', ')}`, ''];
  for (const r of report.results) {
    chunks.push(`[${r.source}] ${r.title}`);
    chunks.push(`Ref: ${Array.isArray(r.url) ? r.url.join(', ') : r.url}`);
    if (!r.findings.length) chunks.push('  - No matches found');
    for (const f of r.findings) chunks.push(`  - ${f}`);
    chunks.push('');
  }
  return chunks.join('\n');
}
