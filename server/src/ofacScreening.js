/* ————— OFAC sanctions screening — admin-facing, background-refreshed —————
 * Source of truth: the U.S. Commerce Dept's Consolidated Screening List
 * (CSL) public bulk download — the same dataset moov-io/watchman (an
 * established open-source sanctions-screening service) uses. Confirmed
 * live and keyless at https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json
 * (real request made while building this: 200 OK, ~26k entries, updated
 * hourly upstream). Chosen over api.trade.gov's live search endpoint or
 * scraping sanctionssearch.ofac.treas.gov directly: no API key to
 * provision, no dependency on a third-party site's fuzzy-match quality
 * (implemented and controlled here instead), and no fragile scraping of
 * an ASP.NET form that can silently break on any Treasury site change.
 *
 * The CSL bundles ELEVEN lists from Commerce/State/Treasury — only the
 * Treasury-administered ones are actually "OFAC" (the rest are Commerce's
 * BIS export-control lists and State's ITAR/nonproliferation lists, a
 * different compliance regime), so this filters down to Treasury sources
 * only before matching.
 */
const CSL_URL = "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.json";
const REFRESH_MS = 12 * 60 * 60 * 1000; // upstream updates hourly; this is a compliance lookup tool, not a live feed
const MATCH_THRESHOLD = 0.85;
const MAX_MATCHES = 25;

function isOfacSource(source) {
  return typeof source === "string" && source.includes("Treasury Department");
}

let cache = { entries: [], dataUpdatedAt: null, sourcesUsed: [], loadedAt: null, error: null };

async function refresh() {
  try {
    const r = await fetch(CSL_URL);
    if (!r.ok) throw new Error(`CSL download failed: HTTP ${r.status}`);
    const data = await r.json();
    const entries = (data.results || [])
      .filter((e) => isOfacSource(e.source))
      .map((e) => ({
        name: e.name,
        altNames: e.alt_names || [],
        type: e.type || null,
        programs: e.programs || [],
        remarks: e.remarks || null,
        source: e.source,
        sourceInformationUrl: e.source_information_url || null,
        id: e.id ?? e.entity_number ?? null,
      }));
    const treasurySources = (data.sources_used || []).filter((s) => isOfacSource(s.source));
    const newestUpdate = treasurySources.reduce((max, s) => {
      const t = s.source_last_updated ? new Date(s.source_last_updated).getTime() : 0;
      return Math.max(max, t);
    }, 0);
    cache = {
      entries,
      dataUpdatedAt: newestUpdate ? new Date(newestUpdate).toISOString() : null,
      sourcesUsed: treasurySources.map((s) => s.source),
      loadedAt: new Date().toISOString(),
      error: null,
    };
    console.log(`[ofac] loaded ${entries.length} Treasury/OFAC-list entries`);
  } catch (e) {
    cache = { ...cache, error: e.message };
    console.error("[ofac] refresh failed:", e.message);
  }
}

void refresh();
setInterval(refresh, REFRESH_MS);

/* ————— Fuzzy name matching (Jaro-Winkler) ————— *
 * Standard algorithm for name-screening (same family of technique real
 * sanctions-screening tools use) — implemented directly rather than adding
 * a dependency for one small, well-defined function. Also tries a
 * token-sorted comparison alongside the direct one, since real names
 * commonly appear in different orders ("LAST, FIRST" vs "FIRST LAST")
 * which a plain Jaro-Winkler comparison penalizes heavily. */
function jaro(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true; s2Matches[j] = true; matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / len1 + matches / len2 + (matches - t) / matches) / 3;
}

function jaroWinkler(s1, s2) {
  const score = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return score + prefix * 0.1 * (1 - score);
}

function normalizeName(s) {
  return (s || "")
    .toUpperCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSort(s) {
  return s.split(" ").filter(Boolean).sort().join(" ");
}

function nameScore(a, b) {
  return Math.max(jaroWinkler(a, b), jaroWinkler(tokenSort(a), tokenSort(b)));
}

/** Screen a name against the cached OFAC/Treasury subset of the CSL. */
export function searchOfac(name) {
  const q = normalizeName(name);
  if (!q) return [];
  const scored = [];
  for (const entry of cache.entries) {
    let best = 0, bestName = entry.name;
    for (const candidate of [entry.name, ...entry.altNames]) {
      const score = nameScore(q, normalizeName(candidate));
      if (score > best) { best = score; bestName = candidate; }
    }
    if (best >= MATCH_THRESHOLD) {
      scored.push({ ...entry, score: best, matchedName: bestName !== entry.name ? bestName : null });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_MATCHES);
}

export function getOfacListStatus() {
  return {
    loadedAt: cache.loadedAt,
    dataUpdatedAt: cache.dataUpdatedAt,
    sourcesUsed: cache.sourcesUsed,
    entryCount: cache.entries.length,
    error: cache.error,
  };
}
