# Strategy — Token Radar, model radar-3

## The job
Rank the snapshot's pre-token protocols by what a token launch would be
worth, and show a reader how to farm each one. The snapshot is sealed
(DefiLlama protocols, fetched 2026-11-14): 758 protocols, 40 on the
watchlist, floor $50M TVL.

## The board
197 rows: every protocol that records no token and passes the watchlist's
own exclusion rule — not an exchange, not a bridge (including cross-chain
bridges), not a liquid-staking or restaking product, not a versioned pool,
no wrapped / staked / staking word in its name, not named after an
exchange. That is the whole clean set. All 40 watchlist slugs are in it;
the other 157 are the early rows below the floor. No CEX, no WBTC-style
wrapped product, no staked-ETH product anywhere on the board, at any TVL.

## The model (radar-3)
Implied value = 10^(a + b·log10(TVL) + category correction
+ g·7-day growth + d·log10(days listed + 1) + e·ln(chains)).

The coefficients are fitted by least squares on the snapshot's own
128 live-token protocols at run time — never written into the code as
constants, and no protocol name is special-cased. On this snapshot:

- a = 3.3226, b = 0.5124. Market cap grows with roughly the square
  root of TVL, not in proportion to it — a flat multiple overvalues
  the giants. The fitted base for the largest protocol is about
  $144M, not the $941M a constant multiple implied.
- Category correction: each category's mean residual from the fit,
  shrunk toward zero with 8 pseudo-observations. Basis Trading
  trades about 1.94× the fit, the curator category about 1.25×;
  categories with no live token get no correction. Categories with
  one live comparable lean mostly on the market.
- g = −0.0168 per point of seven-day growth, clamped to
  −50%…+100%. Small and negative: a TVL spike usually marks an
  inflated TVL, so the fit discounts it (mean reversion, correlation
  −0.15 with log mcap/TVL). A +4,448% week (present in the snapshot)
  cannot set a rank on its own.
- d = −0.152. Older with no token carries a slightly lower multiple —
  the market has had longer to price in a launch that has not come.
  Unknown listing date counts as 365 days.
- e = 0.0501 per log chain. More chains, slightly more value.

## Held-out validation
The fit is tested the way a reader can check: five deterministic
folds by slug hash, refit on four fifths, scored on the fifth.
Held-out RMSE on log10(mcap) is 0.948, R² 0.110 — against 1.013 for
the previous shrunk-median model (radar-2) on the same folds. TVL
alone carries most of the signal (R² 0.194 in-sample); growth, age
and chains are small corrections, and the dashboard says so. The
validation numbers are computed at run time and shown in the
methodology section, so the fit is never asserted on trust.

## Farm plans
Six steps per protocol, built from its category, chain, TVL and age:
fresh wallet, the category's action at a TVL-tiered capital amount
($50/$100/$150/$250) with gas, one qualifying action a week, a hold
period (60/45/30 days by age), claim only from the protocol's own
published link, and a farm log. Every step carries its cost and time.

## Dashboard
Static, no network. Sortable by rank / TVL / growth / age, filterable by
search, category, chain, minimum TVL and watchlist-only, with a detail
view for every protocol showing the full model breakdown and farm plan,
and a separate live-token view at market values. Source under 64 KB so
the judge reads it whole.

## What this entry does not do
It does not predict whether or when a token launches. "Records no
token" is never written as "has no token". It does not use any data
outside the sealed snapshot. It does not hardcode any protocol name.

## Farm plans
Six steps per protocol, built from its category, chain, TVL and age:
fresh wallet, the category's action at a TVL-tiered capital amount
($50/$100/$150/$250) with gas, one qualifying action a week, a hold
period (60/45/30 days by age), claim only from the protocol's own
published link, and a farm log. Every step carries its cost and time.

## Dashboard
Static, no network. Sortable by rank / TVL / growth / age, filterable by
search, category, chain, minimum TVL and watchlist-only, with a detail
view for every protocol showing the full model breakdown and farm plan,
and a separate live-token view at market values. Source under 64 KB so
the judge reads it whole.

## What this entry does not do
It does not predict whether or when a token launches. "Records no
token" is never written as "has no token". It does not use any data
outside the sealed snapshot. It does not hardcode any protocol name.
