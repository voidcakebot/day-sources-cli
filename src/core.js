import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MONTH_NAMES = [
  'january','february','march','april','may','june','july','august','september','october','november','december'
];

const DE_STATES = ['BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH'];
const ALL_SOURCE_KEYS = [
  'un',
  'de_holidays',
  'who_days',
  'unesco_days',
  'eu_days',
  'de_namedays',
  'timeanddate',
  'curiosity_days'
];

export function parseArgs(argv) {
  const args = {
    date: new Date().toISOString().slice(0, 10),
    sources: ['un', 'who_days', 'unesco_days', 'eu_days'],
    json: false,
    country: 'DE',
    state: 'BY',
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') args.date = argv[++i];
    else if (a === '--sources') {
      const raw = String(argv[++i]);
      args.sources = raw === 'all' ? [...ALL_SOURCE_KEYS] : raw.split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--json') args.json = true;
    else if (a === '--country') args.country = String(argv[++i]).toUpperCase();
    else if (a === '--state') args.state = String(argv[++i]).toUpperCase();
  }

  return args;
}

function mdDate(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return { day: d.getUTCDate(), monthName: MONTH_NAMES[d.getUTCMonth()], year: d.getUTCFullYear() };
}

const CACHE_DIR = process.env.DAY_SOURCES_CACHE_DIR || path.join(process.cwd(), '.cache', (process.env.NODE_ENV || 'dev'), 'http');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cachePathFor(url) {
  const key = createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, `${key}.json`);
}

function isValidCachedText(url, text) {
  if (!text) return false;
  if (url.startsWith('https://r.jina.ai/http://')) {
    if (/<!doctype html|<html/i.test(text)) return false;
    if (text.length < 200) return false;
  }
  return true;
}

async function readCache(url, maxAgeMs) {
  try {
    const p = cachePathFor(url);
    const raw = await readFile(p, 'utf8');
    const item = JSON.parse(raw);
    if (!item?.text || !item?.savedAt) return null;
    if (Date.now() - item.savedAt > maxAgeMs) return null;
    if (!isValidCachedText(url, item.text)) return null;
    return item.text;
  } catch {
    return null;
  }
}

async function readStaleCache(url) {
  try {
    const p = cachePathFor(url);
    const raw = await readFile(p, 'utf8');
    const item = JSON.parse(raw);
    if (!isValidCachedText(url, item?.text)) return null;
    return item?.text || null;
  } catch {
    return null;
  }
}

async function writeCache(url, text) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const p = cachePathFor(url);
    await writeFile(p, JSON.stringify({ savedAt: Date.now(), text }), 'utf8');
  } catch {
    // ignore cache write errors
  }
}

async function fetchOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': 'day-sources-cli/0.3' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const attempts = options.attempts ?? 4;
  const cacheTtlMs = options.cacheTtlMs ?? 1000 * 60 * 60 * 6;

  // fresh cache first
  const fresh = await readCache(url, cacheTtlMs);
  if (fresh) return fresh;

  const candidates = [url];

  let lastError = null;

  for (const candidate of candidates) {
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetchOnce(candidate, timeoutMs);
        if (res.ok) {
          const text = await res.text();
          await writeCache(url, text);
          return text;
        }

        // Retry for limits/server-side instability
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`${res.status} ${res.statusText}`);
          const backoff = 600 * Math.pow(2, i) + Math.floor(Math.random() * 200);
          await sleep(backoff);
          continue;
        }

        throw new Error(`${res.status} ${res.statusText}`);
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) {
          const backoff = 600 * Math.pow(2, i) + Math.floor(Math.random() * 200);
          await sleep(backoff);
        }
      }
    }
  }

  // stale cache as final fallback when upstream is rate-limited/down
  const stale = await readStaleCache(url);
  if (stale) return stale;

  throw lastError || new Error('fetch failed');
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
    source: 'un',
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
    source: 'de_holidays',
    title: 'German official/public holiday data (state-specific)',
    url: [apiUrl, 'https://www.gesetze-im-internet.de/'],
    findings: hits.length ? hits : ['No public holiday on this date for selected state.']
  };
}

async function sourceWhoDays(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const url = 'https://r.jina.ai/https://www.who.int/campaigns';
  const text = await fetchText(url);
  const findings = parseMarkdownDatedObservances(text, day, month);
  return {
    source: 'who_days',
    title: 'WHO institution days',
    url,
    findings: findings.length ? findings : ['No WHO observance found for this exact date in current source page.']
  };
}

async function sourceUnescoDays(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const url = 'https://r.jina.ai/https://www.unesco.org/en/days';
  const text = await fetchText(url);
  const findings = parseMarkdownDatedObservances(text, day, month);
  return {
    source: 'unesco_days',
    title: 'UNESCO institution days',
    url,
    findings: findings.length ? findings : ['No UNESCO observance found for this exact date in current source page.']
  };
}

async function sourceEuDays(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const url = 'https://r.jina.ai/https://european-union.europa.eu/principles-countries-history/europe-day_en';
  const text = await fetchText(url);
  const findings = parseMarkdownDatedObservances(text, day, month);
  return {
    source: 'eu_days',
    title: 'EU institution days',
    url,
    findings: findings.length ? findings : ['No EU observance found for this exact date in current source page.']
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
    source: 'de_namedays',
    title: 'German name days',
    url,
    findings: names.length ? [`Name days: ${names.join(', ')}`] : ['No German name-day names found on source page.']
  };
}

async function source5Aggregator(dateIso) {
  const { day, monthName, year } = mdDate(dateIso);
  const url = `https://www.timeanddate.com/holidays/germany/?year=${year}`;
  const text = await fetchText(url);

  const raw = curatedExtract(text, [`${monthName} ${day}`, `${day} ${monthName}`], 12, true);
  const findings = raw
    .filter(x => !/<a\s|href=|class=|aria-label=/i.test(x))
    .filter(x => !/what\&rsquo\;s up in the day and night sky|moon guide|sky guide|lunar eclipse|artemis|daylight saving time|united states|new poll/i.test(x))
    .filter(x => /holiday|day|tag|feiertag|observance/i.test(x))
    .slice(0, 6);

  return {
    source: 'timeanddate',
    title: 'Aggregator (timeanddate)',
    url,
    findings: findings.length ? findings : ['No exact aggregator date match found.']
  };
}

async function source6Curiosity(dateIso) {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const monthNamesDeSlug = ['januar','februar','maerz','april','mai','juni','juli','august','september','oktober','november','dezember'];
  const monthNamesDeTitle = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const monthSlug = monthNamesDeSlug[d.getUTCMonth()];
  const monthTitle = monthNamesDeTitle[d.getUTCMonth()];
  const day = d.getUTCDate();
  const url = `https://r.jina.ai/http://www.kuriose-feiertage.de/kalender/${monthSlug}/${day}/`;
  const text = await fetchText(url);

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const dayHeader = new RegExp(`^${day}\\.\\s+${monthTitle}:$`, 'i');
  const start = lines.findIndex(l => dayHeader.test(l));

  const findings = [];
  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\d{1,2}\.\s+[A-Za-zÄÖÜäöüß]+:$/.test(line)) break;
      const m = line.match(/^\*\s+\[(.+?)\]\(.+\)$/);
      if (m?.[1]) {
        const item = cleanup(m[1]);
        if (!/impressum|datenschutz|home|menü/i.test(item)) findings.push(item);
      }
      if (findings.length >= 8) break;
    }
  }

  return {
    source: 'curiosity_days',
    title: 'Curiosity days (non-authoritative)',
    url,
    findings: findings.length ? findings : ['No curiosity-day entry extracted for this date.']
  };
}

export async function runLookup({ date, sources, state = 'BY' }) {
  const normalizedState = DE_STATES.includes(state) ? state : 'BY';
  const safe = async (id, title, fn) => {
    try {
      return await fn();
    } catch (e) {
      return { source: id, title, url: '', findings: [`Source error: ${e.message}`] };
    }
  };

  const tasks = [];

  if (sources.includes('un')) tasks.push(safe('un', 'UN International Days', () => source1UN(date)));
  if (sources.includes('de_holidays')) tasks.push(safe('de_holidays', 'German official/public holiday data (state-specific)', () => source2GermanyOfficial(date, normalizedState)));
  if (sources.includes('who_days')) tasks.push(safe('who_days', 'WHO institution days', () => sourceWhoDays(date)));
  if (sources.includes('unesco_days')) tasks.push(safe('unesco_days', 'UNESCO institution days', () => sourceUnescoDays(date)));
  if (sources.includes('eu_days')) tasks.push(safe('eu_days', 'EU institution days', () => sourceEuDays(date)));
  if (sources.includes('de_namedays')) tasks.push(safe('de_namedays', 'German name days', () => source4NameDays(date)));
  if (sources.includes('timeanddate')) tasks.push(safe('timeanddate', 'Aggregator (timeanddate)', () => source5Aggregator(date)));
  if (sources.includes('curiosity_days')) tasks.push(safe('curiosity_days', 'Curiosity days (non-authoritative)', () => source6Curiosity(date)));

  const results = await Promise.all(tasks);

  return { date, requestedSources: sources, state: normalizedState, results };
}

export function formatHuman(report) {
  const chunks = [
    `Date: ${report.date}`,
    `Sources: ${report.requestedSources.join(', ')}`,
    `State: ${report.state}`,
    ''
  ];

  for (const r of report.results) {
    chunks.push(`[${r.source}] ${r.title}`);
    chunks.push(`Ref: ${Array.isArray(r.url) ? r.url.join(', ') : r.url}`);
    if (!r.findings.length) chunks.push('  - No curated matches');
    for (const f of r.findings) chunks.push(`  - ${f}`);
    chunks.push('');
  }
  return chunks.join('\n');
}
