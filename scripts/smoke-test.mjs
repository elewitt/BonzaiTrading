#!/usr/bin/env node
// Prod frontend/backend agreement check — self-updating by design: it
// derives the set of API paths to test directly from what web/src's
// source actually calls today, rather than from a hand-maintained list
// (a maintained list would just go stale the same way the code itself
// did — see the /api/kamino/deposit-fee incident).
//
// Runs on a schedule (see .github/workflows/prod-smoke-test.yml), not just
// on push — the backend and frontend are two independently deployable
// services (Vercel + Railway), and drift between them isn't always caused
// by a git push. A Railway env var change (no code, no push) is exactly
// the kind of drift a push-triggered check would miss entirely.
//
// Scans SOURCE (web/src), not the built/minified bundle — an earlier
// version scanned the live bundle directly and got swamped with false
// positives from vendor SDKs (Privy's own /api/v1/* auth endpoints,
// bundled into the same JS file but called against a different base
// URL entirely). web/src contains only this app's own code, so every
// literal "/api/..." string found here is a real call this app makes
// against its own backend.
//
// Read-only by design: every route here is hit with an empty/no-op body
// and no auth token, so authenticated routes short-circuit at requireAuth
// (401) before any real logic runs — nothing here can place a trade,
// move funds, or mutate state.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const WEB_SRC = join(REPO_ROOT, "web", "src");
const BACKEND_URL = "https://longview-server-production.up.railway.app";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

// A full "/api/..." path, where each segment is either a literal path
// component, a `${...}` template interpolation, or a ":param"-style
// placeholder (used in a few doc comments that describe a route's shape
// Express-style, e.g. "/api/admin/customer/:query/trading-history") — not
// just the static prefix up to the first interpolation. Matters for
// routes like `/api/strategies/${id}/pause`, where the dynamic id is
// followed by more static path: stopping at the first "$" (an earlier
// version of this regex did) would extract only "/api/strategies/", which
// tests a path Express has no route for at all (the real route needs the
// "/pause" suffix too) — a false "BROKEN" on a route that works fine.
const API_PATH_RE = /\/api\/(?:[A-Za-z0-9_-]+|:[A-Za-z0-9_]+|\$\{[^}]*\})(?:\/(?:[A-Za-z0-9_-]+|:[A-Za-z0-9_]+|\$\{[^}]*\}))*/g;

function extractApiPaths() {
  const paths = new Set();
  for (const file of walk(WEB_SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(API_PATH_RE)) {
      if (m[0].length > 5) paths.add(m[0]); // drop bare "/api/" noise
    }
  }
  return [...paths].sort();
}

// Every `${...}` interpolation or ":param" placeholder (an id, address,
// etc.) becomes a synthetic value so Express matches the underlying
// parameterized route and runs real handler logic, rather than 404ing
// purely because a template literal's raw source text (or a comment's
// route-shape notation) isn't itself a real path.
function toTestablePath(path) {
  return path.replace(/\$\{[^}]*\}|:[A-Za-z0-9_]+/g, "smoketest123");
}

// Method isn't tracked by the extraction above (get()/post()/adminFetch
// all just take a path string), so try both — a route only counts as
// missing if NEITHER method matches. A 404 on the wrong method for an
// otherwise-real route is a false positive we want to avoid.
async function checkPath(rawPath) {
  const testPath = toTestablePath(rawPath);
  const url = `${BACKEND_URL}${testPath}`;
  const results = await Promise.all(
    ["GET", "POST"].map((method) =>
      fetch(url, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined })
        .then((r) => r.status)
        .catch(() => -1)
    )
  );
  const broken = results.every((status) => status === 404);
  return { rawPath, testPath, results, broken };
}

async function main() {
  console.log(`Scanning ${WEB_SRC} for /api/* paths ...`);
  const paths = extractApiPaths();
  console.log(`Found ${paths.length} distinct /api/* paths in source.\n`);

  const checked = await Promise.all(paths.map(checkPath));
  const broken = checked.filter((c) => c.broken);

  for (const c of checked) {
    const tag = c.broken ? "BROKEN" : "ok    ";
    console.log(`[${tag}] ${c.rawPath}  (GET=${c.results[0]} POST=${c.results[1]})`);
  }

  console.log(`\n${checked.length - broken.length}/${checked.length} paths OK.`);

  if (broken.length > 0) {
    console.error(`\n${broken.length} path(s) referenced in web/src return 404 on both GET and POST against the live backend:`);
    for (const c of broken) console.error(`  - ${c.rawPath}`);
    console.error(`\nBackend checked: ${BACKEND_URL}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Smoke test failed to run:", e);
  process.exit(1);
});
