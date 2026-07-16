export const RESTRICTED_COUNTRIES = new Set(["US", "CU", "IR", "SY", "KP", "RU"]);
export const RESTRICTED_REGIONS = new Set(["CA-ON"]);

export function evaluateGate(signal, opts = {}) {
  const done = (allowed, reason) => {
    const d = { allowed, reason, evaluatedAt: Date.now(), signal };
    opts.audit?.(d);
    return d;
  };

  if (opts.killSwitch) return done(false, "kill_switch");

  const country = signal.kycCountry ?? signal.ipCountry;
  if (!country) return done(false, "no_signal");
  if (RESTRICTED_COUNTRIES.has(country)) return done(false, "restricted_country");

  const regionKey = signal.ipRegion ? `${country}-${signal.ipRegion}` : null;
  if (regionKey && RESTRICTED_REGIONS.has(regionKey)) return done(false, "restricted_region");

  if ((opts.blockOnVpnSignal ?? true) && signal.vpnOrProxySuspected) {
    return done(false, "vpn_suspected");
  }

  return done(true, "allowed");
}

/** Fetch country code from the IP geo service. Returns null on network failure. */
export async function fetchIpCountry() {
  try {
    const res = await fetch("https://api.country.is/");
    if (!res.ok) return null;
    const { country } = await res.json();
    return country ?? null;
  } catch {
    return null;
  }
}
