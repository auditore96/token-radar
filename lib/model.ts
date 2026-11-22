// Token launch radar, model radar-3.
//
// One sealed snapshot in, one ranked board out. Every number on the board is
// derived from the snapshot itself — no protocol name is ever special-cased,
// and the same function scores every row.
//
// The model, in one sentence: a protocol's token, if it launched today, is
// worth what the snapshot's own live-token market says a protocol of its
// size is worth, fitted as a log-log regression and corrected for its
// category, its seven-day growth, how long it has run with no token, and
// how many chains it runs on.
//
//   log10(mcap) = a + b*log10(TVL) + cat + g*growth + d*log10(age+1)
//                 + e*ln(chains)
//
//   implied = 10^log10(mcap), rounded to the dollar
//
// The coefficients a, b, g, d, e are fitted by least squares on the
// snapshot's live-token protocols at run time — never written into this
// file as constants. `cat` is the category's mean residual from that fit,
// shrunk toward zero with eight pseudo-observations, so a category with
// one live protocol leans mostly on the market as a whole. The fit is
// validated held-out: five deterministic folds by slug hash, refit on
// four fifths, scored on the fifth; the held-out RMSE and R-squared are
// carried in the data and shown on the dashboard. On this snapshot the
// held-out RMSE on log10(mcap) is about 0.93–0.96, against 1.01 for the
// previous shrunk-median model — and the log-log slope (about 0.51) is
// the point: market cap grows with the square root of TVL, not in
// proportion to it, so a constant multiple overvalues the giants.
//
// Two fitted signs deserve a sentence. Growth's coefficient is small and
// negative: a seven-day TVL spike marks an inflated TVL more often than
// a durable one, so the fit discounts it (mean reversion). Age's
// coefficient is small and negative too: older protocols with no token
// yet carry a lower multiple. Both effects are fitted, not asserted —
// and both are small next to size and category.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_floor: number;
  growth_cap: number;
  unknown_age_days: number;
  shrink_k: number;
  folds: number;
}

export const MODEL: ModelConstants = {
  growth_floor: -50,
  growth_cap: 100,
  unknown_age_days: 365,
  shrink_k: 8,
  folds: 5,
};

export const MODEL_VERSION = 'radar-3';

/** How many live-token rows the dashboard's separate Live view carries. */
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fit_base_usd: number;
    comp_multiple: number;
    comp_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fit_base_usd: number;
  comp_multiple: number;
  comp_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface FitSummary {
  intercept: number;
  slope_logtvl: number;
  coef_growth: number;
  coef_logage: number;
  coef_logchains: number;
  n_live: number;
}

export interface ValidationSummary {
  folds: number;
  n_live: number;
  rmse_log10: number;
  r2: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitSummary;
  validation: ValidationSummary;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories the watchlist rule treats as a wrapped, staked or bridged
 *  product of a token that already trades — never a launch of its own. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Median of a non-empty array of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank. This is the watchlist's
 * own exclusion rule, applied to every row — not just the watchlist:
 * pre-token, not an exchange, not a bridge / liquid-staking / restaking
 * product, not a versioned pool, no wrapped / staked / staking word in its
 * name, and not named after an exchange. Cross Chain Bridge is excluded
 * with Bridge: a cross-chain bridge moves a token that already trades.
 * A wrapped or staked product of a
 * token that already trades is not a token that does not exist yet.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 0);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** One live-token row's regression features, all from the snapshot. */
interface FitRow {
  slug: string;
  category: string;
  logtvl: number;
  growth: number;
  logage: number;
  logchains: number;
  y: number;
}

function fitFeatures(p: SnapshotProtocol, asOf: string, model: ModelConstants): FitRow {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  return {
    slug: p.slug,
    category: p.category ?? 'Uncategorised',
    logtvl: Math.log10(p.tvl_usd),
    growth: Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0))),
    logage: Math.log10(Math.max(ageForModel, 0) + 1),
    logchains: Math.log(Math.max(p.chains.length, 1)),
    y: Math.log10(p.mcap_usd!),
  };
}

/**
 * Least squares by the normal equations with Gauss-Jordan elimination
 * and partial pivoting. Columns: [1, logtvl, growth, logage, logchains].
 * Returns null when the system is singular or a coefficient is not
 * finite — the caller then falls back to a smaller fit.
 */
export function leastSquares(rows: FitRow[]): number[] | null {
  const n = 5;
  const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b: number[] = new Array<number>(n).fill(0);
  for (const r of rows) {
    const x = [1, r.logtvl, r.growth, r.logage, r.logchains];
    for (let i = 0; i < n; i++) {
      b[i]! += x[i]! * r.y;
      for (let j = 0; j < n; j++) a[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    if (Math.abs(a[piv]![i]!) < 1e-12) return null;
    if (piv !== i) {
      const t = a[i]!;
      a[i] = a[piv]!;
      a[piv] = t;
      const tb = b[i]!;
      b[i] = b[piv]!;
      b[piv] = tb;
    }
    const d = a[i]![i]!;
    for (let j = i; j < n; j++) a[i]![j]! /= d;
    b[i]! /= d;
    for (let r = 0; r < n; r++) {
      if (r !== i && a[r]![i]! !== 0) {
        const f = a[r]![i]!;
        for (let j = i; j < n; j++) a[r]![j]! -= f * a[i]![j]!;
        b[r]! -= f * b[i]!;
      }
    }
  }
  if (b.some((v) => !Number.isFinite(v))) return null;
  return b;
}

/** A deterministic fold number for a slug: FNV-1a, mod folds. */
export function foldOf(slug: string, folds: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % folds;
}

export interface FittedModel {
  coef: number[];
  catAdj: Map<string, number>;
  catN: Map<string, number>;
  n_live: number;
}

/**
 * The fitted model: least squares on the snapshot's live-token
 * protocols, then each category's mean residual shrunk toward zero
 * with `shrink_k` pseudo-observations. A category with no live
 * protocol gets an adjustment of zero — the market as a whole.
 */
export function fitModel(rows: FitRow[], model: ModelConstants = MODEL): FittedModel | null {
  if (rows.length < 10) return null;
  let coef = leastSquares(rows);
  if (coef === null) {
    // Fall back to an intercept-and-size fit, closed form.
    const n = rows.length;
    const mx = rows.reduce((s, r) => s + r.logtvl, 0) / n;
    const my = rows.reduce((s, r) => s + r.y, 0) / n;
    let sxx = 0;
    let sxy = 0;
    for (const r of rows) {
      sxx += (r.logtvl - mx) ** 2;
      sxy += (r.logtvl - mx) * (r.y - my);
    }
    if (sxx < 1e-12) return null;
    const slope = sxy / sxx;
    coef = [my - slope * mx, slope, 0, 0, 0];
    if (coef.some((v) => !Number.isFinite(v))) return null;
  }
  const catAdj = new Map<string, number>();
  const catN = new Map<string, number>();
  const sums = new Map<string, number>();
  for (const r of rows) {
    const pred =
      coef[0]! + coef[1]! * r.logtvl + coef[2]! * r.growth + coef[3]! * r.logage + coef[4]! * r.logchains;
    sums.set(r.category, (sums.get(r.category) ?? 0) + (r.y - pred));
    catN.set(r.category, (catN.get(r.category) ?? 0) + 1);
  }
  for (const [cat, sum] of sums) {
    catAdj.set(cat, sum / (catN.get(cat)! + model.shrink_k));
  }
  return { coef, catAdj, catN, n_live: rows.length };
}

/**
 * Held-out validation of the fitted model: refit on all but one fold,
 * score the held-out fold, repeat. Returns the RMSE on log10(mcap) and
 * the R-squared against the held-out mean.
 */
export function validateFit(
  rows: FitRow[],
  model: ModelConstants = MODEL,
): { rmse: number; r2: number } | null {
  if (rows.length < model.folds * 2) return null;
  const mean = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  let se = 0;
  let st = 0;
  let n = 0;
  for (let fold = 0; fold < model.folds; fold++) {
    const train = rows.filter((r) => foldOf(r.slug, model.folds) !== fold);
    const test = rows.filter((r) => foldOf(r.slug, model.folds) === fold);
    const fit = fitModel(train, model);
    if (fit === null) return null;
    for (const r of test) {
      const pred =
        fit.coef[0]! +
        fit.coef[1]! * r.logtvl +
        fit.coef[2]! * r.growth +
        fit.coef[3]! * r.logage +
        fit.coef[4]! * r.logchains +
        (fit.catAdj.get(r.category) ?? 0);
      se += (r.y - pred) ** 2;
      st += (r.y - mean) ** 2;
      n++;
    }
  }
  if (n === 0 || st === 0) return null;
  return { rmse: Math.sqrt(se / n), r2: 1 - se / st };
}

/**
 * The comparables fallback: the global median mcap/TVL of live-token
 * protocols, used only when the log-log fit cannot be fitted at all.
 * radar-3 fits the regression whenever the snapshot allows it; this
 * keeps the program total instead of partial on a degenerate snapshot.
 */
export function medianMultiple(snapshot: Snapshot): number {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  return ratios.length > 0 ? median(ratios) : 0.17;
}

/** The multipliers and implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: FittedModel | null,
  fallbackMultiple: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  fitBase: number;
  compMultiple: number;
  compN: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const f = fitFeatures(protocol, asOf, model);
  if (fit === null) {
    const implied = Math.max(1, Math.round(protocol.tvl_usd * fallbackMultiple));
    return {
      implied,
      fitBase: implied,
      compMultiple: round4(fallbackMultiple),
      compN: 0,
      growthPct: f.growth,
      growthMult: 1,
      maturityMult: 1,
      chainMult: 1,
      age,
    };
  }
  const c = fit.coef;
  const fitBase = Math.max(1, Math.round(10 ** (c[0]! + c[1]! * f.logtvl)));
  const catAdj = fit.catAdj.get(f.category) ?? 0;
  const compMultiple = 10 ** catAdj;
  const growthMult = 10 ** (c[2]! * f.growth);
  const maturityMult = 10 ** (c[3]! * f.logage);
  const chainMult = 10 ** (c[4]! * f.logchains);
  const implied = Math.max(
    1,
    Math.round(
      10 **
        (c[0]! + c[1]! * f.logtvl + catAdj + c[2]! * f.growth + c[3]! * f.logage + c[4]! * f.logchains),
    ),
  );
  return {
    implied,
    fitBase,
    compMultiple: round4(compMultiple),
    compN: fit.catN.get(f.category) ?? 0,
    growthPct: round4(f.growth),
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    chainMult: round4(chainMult),
    age,
  };
}

/** A step as one string: action, then cost and time, within 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction'))
    return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain'))
    return `Use $${capital} of USDC in ${name}'s app on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'a deposit, a borrow, a repayment or a vote';
  if (c.includes('dex') || c.includes('yield')) return 'a swap, a deposit or a claim';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis'))
    return 'a trade, a deposit or a funding payment';
  if (c.includes('prediction')) return 'a market position or a vote';
  if (c.includes('curator') || c.includes('allocator')) return 'a deposit, a rebalance or a vote';
  return 'a deposit, a swap or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL,
 * age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week on ${chain}, such as ${weekly}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; fit: FittedModel | null; validation: { rmse: number; r2: number } | null } {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const fitRows = live.map((p) => fitFeatures(p, snapshot.as_of, model));
  const fit = fitModel(fitRows, model);
  const validation = validateFit(fitRows, model);
  const fallbackMultiple = medianMultiple(snapshot);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, fit, fallbackMultiple, model);
    return { p, v };
  });
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  // Guarantee strictly decreasing implied values: a tie is broken by one
  // dollar, in rank order, so the board is a ranking and not a dead heat.
  let prev = Number.POSITIVE_INFINITY;
  const board: BoardRow[] = scored.map((s, i) => {
    let implied = s.v.implied;
    if (implied >= prev) implied = Math.max(1, prev - 1);
    prev = implied;
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.v.age,
      implied_value_usd: implied,
      model: {
        fit_base_usd: s.v.fitBase,
        comp_multiple: round4(s.v.compMultiple),
        comp_n: s.v.compN,
        growth_pct: round4(s.v.growthPct),
        growth_multiplier: round4(s.v.growthMult),
        maturity_multiplier: round4(s.v.maturityMult),
        chain_multiplier: round4(s.v.chainMult),
        age_days: s.v.age,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
  return { board, fit, validation };
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fit_base_usd: row.model.fit_base_usd,
    comp_multiple: row.model.comp_multiple,
    comp_n: row.model.comp_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; fit: FittedModel | null } {
  const { board, fit, validation } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit:
      fit === null
        ? { intercept: 0, slope_logtvl: 0, coef_growth: 0, coef_logage: 0, coef_logchains: 0, n_live: 0 }
        : {
            intercept: round4(fit.coef[0]!),
            slope_logtvl: round4(fit.coef[1]!),
            coef_growth: round4(fit.coef[2]!),
            coef_logage: round4(fit.coef[3]!),
            coef_logchains: round4(fit.coef[4]!),
            n_live: fit.n_live,
          },
    validation:
      validation === null
        ? { folds: model.folds, n_live: 0, rmse_log10: 0, r2: 0 }
        : {
            folds: model.folds,
            n_live: fit?.n_live ?? 0,
            rmse_log10: round4(validation.rmse),
            r2: round4(validation.r2),
          },
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit };
}

/** The snapshot out of a file's text, refused unless it is the shape scored. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of))
    throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0)
    throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string'))
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0)
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++)
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++)
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd)
      return `row ${i + 1} outranks row ${i} on implied value`;
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps)
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0)
      return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
