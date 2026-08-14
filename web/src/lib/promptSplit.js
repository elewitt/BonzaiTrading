// Splits a compound prompt ("Buy TSLA with all my cash, go 5x long BTC with
// all of my cash") into per-domain segments so each half can be resolved
// through its own existing single-domain parser, rather than the whole
// sentence being sent to just one of them.
//
// Classifies by trigger-word POSITION across the whole string, not by
// independently classifying fragments split on connectors first — fragment-
// first splitting breaks on elliptical continuations like "50% TSLA and 50%
// AAPL", where neither half contains a trade verb on its own and would
// classify as no domain at all. Scanning the whole string for every
// TRADE_RE/PERP_RE/BORROW_RE match and only cutting where a domain actually
// changes (with an explicit connector in the gap) means a same-domain
// multi-asset prompt like that one never gets split — it falls through as a
// single segment, identical to today's behavior.
const MAX_SEGMENTS = 4;

const CONNECTOR_RE = /(,\s*(?:and\s+|then\s+|also\s+)?|;\s*|\.\s+|\band\s+then\s+|\bthen\s+|\band\s+|\balso\s+)/i;
const LEADING_CONNECTOR_RE = /^[,;.\s]*\b(and\s+then|and|then|also)?\b[,\s]*/i;

function collectTriggers(text, { TRADE_RE, PERP_RE, BORROW_RE }) {
  const specs = [
    ["trade", TRADE_RE],
    ["perp", PERP_RE],
    ["borrow", BORROW_RE],
  ];
  const triggers = [];
  for (const [domain, re] of specs) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) {
      triggers.push({ i: m.index, e: m.index + m[0].length, d: domain });
    }
  }
  triggers.sort((a, b) => a.i - b.i);
  return triggers;
}

function mergeRuns(triggers) {
  const runs = [];
  for (const t of triggers) {
    const last = runs[runs.length - 1];
    if (last && last.d === t.d) last.e = Math.max(last.e, t.e);
    else runs.push({ d: t.d, s: t.i, e: t.e });
  }
  return runs;
}

function classify(text, { TRADE_RE, PERP_RE, BORROW_RE }) {
  if (TRADE_RE.test(text)) return "trade";
  if (PERP_RE.test(text)) return "perp";
  if (BORROW_RE.test(text)) return "borrow";
  return null;
}

/**
 * @returns {{domain: 'trade'|'perp'|'borrow'|null, text: string}[]}
 * Always returns at least one segment (the whole input) when nothing splits.
 */
export function splitIntoDomainSegments(text, regexes) {
  const triggers = collectTriggers(text, regexes);
  if (triggers.length === 0) return [{ domain: null, text }];

  const runs = mergeRuns(triggers);
  if (runs.length === 1) return [{ domain: runs[0].d, text }];

  const cuts = [];
  for (let i = 0; i < runs.length - 1; i++) {
    const gap = text.slice(runs[i].e, runs[i + 1].s);
    const m = gap.match(CONNECTOR_RE);
    if (m) cuts.push(runs[i].e + m.index);
  }
  // No clean connector at any domain-change boundary — a run-on sentence
  // with no punctuation/conjunction to safely cut on. Don't guess; leave it
  // as one segment so it falls through to today's (unchanged) behavior.
  if (cuts.length === 0) return [{ domain: runs[0].d, text }];

  const raw = [];
  let prev = 0;
  for (const c of cuts) {
    raw.push(text.slice(prev, c).trim());
    prev = c;
  }
  raw.push(text.slice(prev).trim());

  const segments = raw
    .map((seg, i) => (i === 0 ? seg : seg.replace(LEADING_CONNECTOR_RE, "").trim()))
    .filter(Boolean)
    .map((seg) => ({ domain: classify(seg, regexes), text: seg }));

  if (segments.length > MAX_SEGMENTS) return [{ domain: classify(text, regexes), text }];

  return segments;
}
