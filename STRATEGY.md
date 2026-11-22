# Strategy — Token Radar, model radar-2

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

## The model (radar-2)
Implied value = TVL × category multiple × growth factor × maturity
factor × chain factor.

- Category multiple: for each category, the median mcap/TVL of its
  live-token protocols in this snapshot, winsorised to 0.005–2.0, shrunk
  toward the global median (0.169) with 8 pseudo-observations, capped
  0.02–0.60. Computed from the snapshot at run time; no multiple is
  written into the code as a constant, and no protocol name is
  special-cased. Categories with one live comparable lean mostly on the
  market; categories with fifteen lean on their own comparables.
- Growth: seven-day TVL change clamped to −50%…+100%, weight 0.35.
  A +4,448% week (present in the snapshot) cannot set a rank on its own.
- Maturity: 0.70 + 0.30 × min(age, 1095)/1095. Unknown listing date
  counts as 365 days. Older with no token = more proven, modestly.
- Chain: 1 + 0.03 per extra chain, up to three.
- Ties are broken by one dollar in rank order, so the board is a
  strict ranking.

Why this beats a flat multiple: a flat 0.25× TVL says a DEX token and a
lending token are worth the same per TVL dollar. The snapshot's own
live tokens say they are not — Dexs price near 0.34–0.65× TVL, Lending
near 0.13–0.41×, RWA near 0.28× — and the board prices each protocol
against its own category's market, with the shrinkage keeping thin
categories honest.

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
