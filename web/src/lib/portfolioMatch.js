// Deterministic, client-side matching from free-text prompt to one of
// Bonzai's own named Portfolio Builder catalog entries (curated theme
// baskets + Legendary Investor portfolios) — lets "Build me the
// Situational Awareness portfolio" typed into the dashboard's prompt bar
// resolve straight to that portfolio's real, registry-validated
// allocations instead of being sent to api.parse()'s free-text Claude
// composer, which has no knowledge of Bonzai's own catalog and would
// otherwise reconstruct (or hallucinate) its own idea of what that
// portfolio contains from training data rather than the real sourced one.
//
// Pure regex/substring matching, not a Claude call — this is meant to run
// in the same synchronous pass as App.jsx's other prompt-classification
// regexes (TRADE_RE/PERP_RE/BORROW_RE), so it adds no network round-trip
// to prompts that don't reference a named portfolio.

const FILLER_RE = /\b(build|buy|get|make|create|assemble|compose|construct|invest(?:\s+in)?|give\s+me|show\s+me|i\s+want|the|a|an|me|my|please|portfolio|basket)\b/gi;

function normalize(s) {
  return (s || "")
    .toLowerCase()
    // Strip a possessive 's as a unit ("Ackman's" -> "ackman"), not just
    // the apostrophe alone — leaving a stray trailing "s" ("ackmans")
    // broke matching "Bill Ackman's Pershing Square portfolio" against the
    // combined "bill ackman pershing square" key, since the leftover "s"
    // meant it was no longer an exact substring. Confirmed as a real bug:
    // "Bill Ackman" alone and "Pershing Square" alone both matched fine,
    // but the natural combined phrasing with a possessive didn't.
    .replace(/['’]s\b/gi, "")
    .replace(/['’]/g, "")
    .replace(FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Candidate "keys" a user might plausibly type to reference an entry — a
// theme basket only has its own name; an investor portfolio might be
// referenced by the investor's name, the fund's name, or both together.
// ("Situational Awareness" is the FUND, not the person's name, so the
// fund alone has to be a standalone key, not just appended to investor.)
function keysFor(entry, kind) {
  if (kind === "basket") return [entry.name];
  return [entry.investor, entry.fund, `${entry.investor} ${entry.fund}`].filter(Boolean);
}

/**
 * @param {string} text - raw prompt text
 * @param {{baskets: object[], investorPortfolios: object[]}} catalog - from api.portfolios()
 * @returns {{allocations: object[], summary: string} | null}
 */
export function matchNamedPortfolio(text, catalog) {
  if (!catalog) return null;
  const q = normalize(text);
  if (q.length < 3) return null;

  const candidates = [
    ...(catalog.baskets || []).map((entry) => ({ entry, kind: "basket" })),
    ...(catalog.investorPortfolios || []).map((entry) => ({ entry, kind: "investor" })),
  ];

  let best = null; // { entry, kind, score }
  for (const { entry, kind } of candidates) {
    for (const key of keysFor(entry, kind)) {
      const nk = normalize(key);
      if (nk.length < 3) continue;
      let leftover = null;
      if (q === nk) leftover = "";
      else if (q.includes(nk)) leftover = q.replace(nk, "").trim();
      else if (nk.includes(q) && q.length >= 4) leftover = "";
      if (leftover === null) continue;
      // Only accept a CLEAN match — meaningful leftover text means this is
      // probably a compound prompt ("the Magnificent Seven and go 5x long
      // BTC") that should keep falling through to the existing
      // multi-domain routing instead of silently swallowing the rest.
      if (leftover.length > 2) continue;
      const score = nk.length;
      if (!best || score > best.score) best = { entry, kind, score };
    }
  }
  if (!best) return null;

  const { entry, kind } = best;
  const summary = kind === "basket" ? entry.tagline : `${entry.investor} — ${entry.tagline}`;
  return { allocations: entry.allocations, summary };
}
