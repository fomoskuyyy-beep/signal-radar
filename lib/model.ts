// Signal Radar — model nilai tersirat (implied value) untuk protocol pre-token.
//
// Satu snapshot masuk, satu papan peringkat keluar. Papan selalu membawa SELURUH watchlist
// (40 slug) sebagai lantai, lalu menambahkan temuan awal: protocol pre-token lain di bawah
// lantai TVL snapshot, diurutkan dari TVL terbesar. Protocol yang tokennya sudah diperdagangkan
// TIDAK masuk papan; mereka tampil terpisah sebagai referensi pasar (live view), sehingga
// pembaca langsung bisa memisahkan "yang sudah coin" vs "yang akan coin".
//
// Implied value hanya mengikuti angka snapshot sendiri — tanpa nama protocol yang di-hardcode:
//
//   multiple     = median MCap/TVL protocol ber-token SEKATEGORI di snapshot ini sendiri
//                  (fallback: median grup kategori, lalu median global) — batas [0.03, 3.0]
//   base         = tvl_usd x multiple
//   growth       = clamp(change_7d, -60, 150) persen
//   growthMult   = 1 + (growth / 100) x 0.5
//   maturity     = 0.65 + min(age_days, 1095) / 1095 x 0.35   (usia tak diketahui: 365 hari)
//   implied      = max(1, round(base x growthMult x maturity))
//
// Semua fungsi deterministik: dua kali run pada snapshot yang sama menghasilkan byte yang sama.

/** Satu entri protocol di snapshot — sepuluh field yang dibawa input tersegel. */
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

/** Dokumen snapshot utuh. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Konstanta model — ditampilkan apa adanya di dashboard dan dihitung ulang dari snapshot. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  min_samples_exact: number;
  min_samples_group: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.03,
  multiple_cap: 3,
  min_samples_exact: 5,
  min_samples_group: 5,
};

export const MODEL_VERSION = 'signal-radar-1';

/** Berapa temuan awal di bawah lantai TVL yang papan bawa (watchlist selalu ikut semua). */
export const EARLY_ROWS = 400;

/** Berapa protocol ber-token yang ditampilkan sebagai referensi pasar. */
export const LIVE_ROWS = 50;

/** Satu langkah rencana farming: aksinya, biayanya, dan lamanya. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Satu baris board.json: papan peringkat. */
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
    category_multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Tampilan padat satu baris untuk data.js (rencana farming ikut, agar layar = kode). */
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
  watchlist_member: boolean;
  plan_group: string;
  implied_value_usd: number;
  category_multiple: number;
  multiple_source: string;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** Protocol ber-token: sudah diperdagangkan — nilai pasar miliknya sendiri, bukan model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Segala yang dibutuhkan dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiple_table: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Median MCap/TVL satu kategori, jumlah sampelnya, dan asalnya. */
export interface CategoryMultiple {
  category: string;
  samples: number;
  ratio: number;
  source: 'exact' | 'group' | 'global';
}

/** Alasan snapshot tak bisa dipetak. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Bilangan finit, jika tidak `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Jumlah hari utuh dari `from` ke `to`, minimal nol; null bila tanggalnya hilang/rusak. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median deterministik: array diurutkan salinan, nilai tengah (rata-rata bila genap). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Aturan versi DeFiLlama: nama berakhiran rilis adalah pool dari protocol lain. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Apakah satu entri protocol mencatat tidak ada token sama sekali. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Apakah protocol boleh diperingkat papan: pre-token, bukan bursa terpusat, bukan pool berversi. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if ((p.category ?? '').toUpperCase() === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/**
 * Grup kategori: peta kategori snapshot ke keluarganya, supaya kategori dengan sampel hidup
 * sedikit tetap mendapat median yang masuk akal. Kunci dipetakan dari string kategori —
 * tidak ada satu pun nama protocol yang dikhususkan.
 */
const GROUP_RULES: Array<{ group: string; words: Array<string> }> = [
  { group: 'lending', words: ['lend', 'cdp', 'collateral', 'borrow', 'savings'] },
  { group: 'dex', words: ['dex', 'swap', 'exchange'] },
  { group: 'derivatives', words: ['deriv', 'perpetual', 'basis', 'prediction', 'futures'] },
  { group: 'bridge', words: ['bridge'] },
  { group: 'staking', words: ['staking', 'restak'] },
  { group: 'yield', words: ['yield', 'vault', 'curat', 'allocat', 'index', 'capital'] },
  { group: 'rwa', words: ['rwa', 'credit', 'treasury'] },
  { group: 'stablecoin', words: ['stable'] },
  { group: 'insurance', words: ['insurance', 'risk'] },
  { group: 'payments', words: ['payment', 'transfer'] },
  { group: 'governance', words: ['governance', 'dao', 'incentive'] },
  { group: 'chain', words: ['chain', 'layer', 'network'] },
  { group: 'ce defi', words: ['cedefi', 'cex'] },
  { group: 'game', words: ['game', 'gaming'] },
  { group: 'social', words: ['social', 'meme', 'nft'] },
];

/** Nama grup sebuah kategori (huruf kecil), default 'other'. */
export function planGroup(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  for (const rule of GROUP_RULES) {
    for (const word of rule.words) {
      if (c.includes(word)) return rule.group;
    }
  }
  return 'other';
}

/**
 * Tabel median MCap/TVL dari snapshot itu sendiri: per kategori persis (bila sampelnya cukup),
 * lalu per grup, lalu global. Tabel ini yang dashboard tampilkan — pembaca melihat dari mana
 * angka multiple datang, bukan daftar nama yang dikarang.
 */
export function buildMultipleTable(snapshot: Snapshot): { exact: Map<string, number>; group: Map<string, number>; global: number; table: CategoryMultiple[] } {
  const exactRatios = new Map<string, number[]>();
  const groupRatios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === null) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category.toLowerCase();
    const bucket = exactRatios.get(key);
    if (bucket === undefined) exactRatios.set(key, [ratio]);
    else bucket.push(ratio);
    const g = planGroup(p.category);
    const gb = groupRatios.get(g);
    if (gb === undefined) groupRatios.set(g, [ratio]);
    else gb.push(ratio);
  }
  const globalRatio = median(all);
  const exact = new Map<string, number>();
  const group = new Map<string, number>();
  for (const [key, ratios] of exactRatios) {
    if (ratios.length >= MODEL.min_samples_exact) {
      exact.set(key, clamp(median(ratios), MODEL.multiple_floor, MODEL.multiple_cap));
    }
  }
  for (const [key, ratios] of groupRatios) {
    if (ratios.length >= MODEL.min_samples_group) {
      group.set(key, clamp(median(ratios), MODEL.multiple_floor, MODEL.multiple_cap));
    }
  }
  const clampedGlobal = clamp(globalRatio, MODEL.multiple_floor, MODEL.multiple_cap);

  // Tabel yang tampil di dashboard: kategori yang dipakai papan, urut alfabet, deterministik.
  const usedCategories = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (p.category === null || !isRankable(p)) continue;
    usedCategories.set(p.category.toLowerCase(), (usedCategories.get(p.category.toLowerCase()) ?? 0) + 1);
  }
  const table: CategoryMultiple[] = [];
  for (const [key] of [...usedCategories].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const g = planGroup(key);
    const fromExact = exact.get(key);
    const fromGroup = group.get(g);
    if (fromExact !== undefined) {
      const samples = exactRatios.get(key)!.length;
      table.push({ category: key, samples, ratio: fromExact, source: 'exact' });
    } else if (fromGroup !== undefined) {
      const samples = groupRatios.get(g)!.length;
      table.push({ category: key, samples, ratio: fromGroup, source: 'group' });
    } else {
      table.push({ category: key, samples: 0, ratio: clampedGlobal, source: 'global' });
    }
  }
  return { exact, group, global: clampedGlobal, table };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Multiple kategori untuk satu protocol, beserta asal angkanya (untuk panel model). */
export function categoryMultiple(
  p: SnapshotProtocol,
  tables: { exact: Map<string, number>; group: Map<string, number>; global: number },
): { ratio: number; source: string } {
  const key = (p.category ?? '').toLowerCase();
  const fromExact = tables.exact.get(key);
  if (fromExact !== undefined) return { ratio: fromExact, source: `median of this snapshot's ${tables.exact.get(key) !== undefined ? 'live ' : ''}${key} category` };
  const g = planGroup(p.category);
  const fromGroup = tables.group.get(g);
  if (fromGroup !== undefined) return { ratio: fromGroup, source: `median of this snapshot's live '${g}' category group` };
  return { ratio: tables.global, source: 'median of every live protocol in this snapshot' };
}

export interface Scored {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  age: number | null;
  ratio: number;
  ratioSource: string;
}

/** Tiga pengali dan nilai tersirat satu protocol di bawah `model`. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants, tables: { exact: Map<string, number>; group: Map<string, number>; global: number }): Scored {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const { ratio, source } = categoryMultiple(p, tables);
  const base = p.tvl_usd * ratio;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age, ratio, ratioSource: source };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Chain utama protocol, atau frasa netral. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Modal awal satu posisi farming, dari TVL protocol sendiri. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Lamanya hold kualifikasi, dari usia protocol: muda = jendela poin lebih panjang. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Kelompok rencana farming: 'other' memakai rencana umum berbasis TVL. */
type PlanBuilder = (p: SnapshotProtocol, age: number | null) => FarmStep[];

const SAFETY_STEP = (p: SnapshotProtocol): FarmStep => ({
  text: `Set up a fresh wallet that only holds this farm's funds; keep its seed offline and send nothing to addresses ${p.name} does not publish.`,
  cost: 'under $2 of gas to fund it',
  time: '5 minutes to set up',
});

const LOG_STEP = (p: SnapshotProtocol, capital: number): FarmStep => ({
  text: `Log every position for ${p.name}: wallet, dates, deposits and withdrawals, so the farm can be repeated or unwound without guessing.`,
  cost: 'free, about a page per week',
  time: '5 minutes a week',
});

/**
 * Rencana farming per grup kategori: enam langkah, masing-masing aksi dengan biaya dan durasi.
 * Semua angka diturunkan dari record protocol (kategori, chain, TVL, usia) — tidak ada slogan,
 * tidak ada nama protocol yang dikhususkan.
 */
export const PLAN_BUILDERS: Record<string, PlanBuilder> = {
  lending: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Bridge or deposit $${c} of USDC to ${chain} and approve only ${p.name}'s official market contract from its own app.`, cost: `$${c} plus about $4 of gas`, time: '15 minutes' },
      { text: `Supply the full $${c} as collateral on ${p.name}, then borrow no more than 40% of it to keep the position through a 20% price move.`, cost: 'the $4 collateral stays locked, borrow fee ~2% APR', time: '10 minutes to open' },
      { text: `Repay and re-borrow a small amount once a week so the position keeps touching new blocks and its activity window keeps widening.`, cost: 'about $3 of gas per week', time: '10 minutes a week' },
      { text: `Keep the borrow healthy: check the health factor after any collateral move and top up rather than get liquidated for a $10 saving.`, cost: 'a top-up of $25 when needed', time: '2 minutes a check, twice a week' },
      { text: `Hold the position at least ${hold} days; withdrawals inside a shorter window often miss the rewards snapshot that pays points.`, cost: `the $${c} stays in market for ${hold} days`, time: `${hold} days` },
      { text: `Before withdrawing, open ${p.name}'s own rewards page from its published link and claim only there; then unwind and write the log.`, cost: 'claim is free, gas ~$3 to withdraw', time: '15 minutes to unwind' },
    ];
  },
  dex: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Fund a fresh wallet with $${c} split as half stablecoin and half the pair's other asset, plus a gas cushion, then open ${p.name} on ${chain}.`, cost: `$${c} plus about $5 of gas`, time: '15 minutes' },
      { text: `Add liquidity to ${p.name}'s deepest pool for that pair in the price range the pool's own chart shows, not a single-price full-range deposit.`, cost: `swap half the $${c} into the pair asset, ~$6 of swap fees`, time: '15 minutes to place' },
      { text: `Rebalance the range when price leaves it, and compound the fees once a week by re-depositing what the position earned.`, cost: 'about $4 of gas per re-range', time: '15 minutes a week' },
      { text: `Track impermanent loss against holding: if the position trails a plain hold by more than the fees earned after two weeks, narrow the range or exit.`, cost: 'nothing to check', time: '10 minutes a week' },
      { text: `Leave the position open at least ${hold} days so fee epochs and points programs cover more than one settlement.`, cost: `the $${c} stays in the pool for ${hold} days`, time: `${hold} days` },
      { text: `Withdraw from ${p.name}'s own interface, keep the receipt transaction id in the farm log, and note what the fees actually paid.`, cost: 'gas ~$4 to withdraw', time: '15 minutes to unwind' },
    ];
  },
  derivatives: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Deposit $${c} of USDC as margin on ${p.name} on ${chain}; leave most of it idle as margin instead of over-leveraging.`, cost: `$${c} plus about $4 of funding gas`, time: '15 minutes' },
      { text: `Open one small position below 2x leverage in the direction you would hold anyway, sized so a 30% adverse move does not liquidate it.`, cost: 'taker fee about 0.05% of notional per fill', time: '10 minutes to place' },
      { text: `Check funding and position health daily; close or hedge if funding runs against you for three days straight.`, cost: 'funding ~0.01% per 8h either way', time: '5 minutes a day' },
      { text: `Make one qualifying interaction a week (a deposit, a trade or a claim) so weekly activity counts in more than one epoch.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Hold the account funded at least ${hold} days; ${p.name} style point programs usually snapshot balances before a claim window opens.`, cost: `the $${c} stays as margin for ${hold} days`, time: `${hold} days` },
      { text: `Close the position from ${p.name}'s own app, withdraw the margin, and record entry, exit and fees in the farm log.`, cost: 'close fee ~0.05%, withdrawal gas ~$4', time: '15 minutes to unwind' },
    ];
  },
  bridge: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Prepare $${c} on the source chain plus gas on both sides, and open ${p.name} only from the link its own domain publishes.`, cost: `$${c} plus ~$6 of gas across both chains`, time: '15 minutes' },
      { text: `Bridge the $${c} to ${chain} through ${p.name} and keep the transaction hash; then use the bridged funds inside its app at least once.`, cost: 'bridge fee typically 0.05-0.15% of amount', time: '15 minutes plus finality wait' },
      { text: `Repeat one qualifying transfer or usage a week so the protocol books you as recurring traffic, not a one-off.`, cost: '~$3 of gas a week', time: '10 minutes a week' },
      { text: `Hold a position or balance on ${chain} for at least ${hold} days; bridge programs usually score wallets that stay, not wallets that pass through.`, cost: `the $${c} stays bridged for ${hold} days`, time: `${hold} days` },
      { text: `Watch ${p.name}'s published status page before any large move; never bridge through an intermediary link from a post or DM.`, cost: 'free to check', time: '3 minutes before each transfer' },
      { text: `Bridge back through ${p.name}'s own interface, confirm finality on both chains, and log the round trip's real cost and duration.`, cost: 'return fee ~0.1% plus gas', time: '20 minutes plus finality' },
    ];
  },
  staking: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Acquire the chain's staking asset worth $${c} on ${chain} and keep a gas cushion separate from the stake.`, cost: `$${c} plus ~$5 of swap and gas`, time: '15 minutes' },
      { text: `Stake through ${p.name}'s own interface, confirming the validator set or pool page it shows; never stake to an address from a search ad.`, cost: 'staking fee usually 5-10% of rewards', time: '10 minutes to stake' },
      { text: `Keep the receipt token unswapped and untouched; one transfer of it can break the points or eligibility trail the protocol records.`, cost: 'nothing while held', time: 'ongoing' },
      { text: `Check rewards weekly and restake or compound once, so the position shows continuous activity across epochs.`, cost: '~$3 of gas per compound', time: '10 minutes a week' },
      { text: `Leave the stake for at least ${hold} days; unbonding queues and epoch snapshots reward patience, not quick in-and-out wallets.`, cost: `the $${c} stays staked for ${hold} days`, time: `${hold} days` },
      { text: `Unstake from ${p.name}'s app, wait out the queue, and record the reward total against the plain-hold baseline in the farm log.`, cost: 'unstake gas ~$4', time: '10 minutes plus unbonding wait' },
    ];
  },
  yield: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Deposit $${c} into ${p.name}'s published vault on ${chain} after reading its strategy note and the assets it actually holds.`, cost: `$${c} plus ~$4 of deposit gas`, time: '20 minutes to read and deposit' },
      { text: `Keep the vault shares; do not route them through a third-party farm unless ${p.name} itself documents that route.`, cost: 'nothing while held', time: 'ongoing' },
      { text: `Review the vault's reported APY and TVL weekly; a drop of a third in either is the signal to look at the strategy, not to panic.`, cost: 'free to check', time: '10 minutes a week' },
      { text: `Claim or compound whatever the vault distributes once a week so rewards never sit unclaimed through a snapshot.`, cost: '~$3 of gas per claim', time: '10 minutes a week' },
      { text: `Keep the deposit open at least ${hold} days; yield programs measure wallets that stayed through multiple reporting periods.`, cost: `the $${c} stays in the vault for ${hold} days`, time: `${hold} days` },
      { text: `Exit through ${p.name}'s own withdraw function, measure real APY after fees against the advertised figure, and log it.`, cost: 'withdraw gas ~$4, exit fee if the vault states one', time: '15 minutes to unwind' },
    ];
  },
  rwa: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Complete ${p.name}'s own onboarding for its yield asset — identity checks some RWA venues require — then fund $${c} on ${chain}.`, cost: `$${c} plus ~$4 of gas; onboarding is free`, time: '30 minutes including checks' },
      { text: `Mint or buy the protocol's yield-bearing asset from its official app and confirm the backing figure it publishes matches the amount received.`, cost: 'mint spread usually under 0.5%', time: '15 minutes' },
      { text: `Hold the asset through two distribution cycles so at least one payout lands on-chain in your wallet.`, cost: 'distribution gas ~$2 each', time: '2 cycles' },
      { text: `Reinvest one distribution to prove the loop works end to end before trusting it with more.`, cost: '~$3 of gas to reinvest', time: '10 minutes' },
      { text: `Keep the position at least ${hold} days; RWA yields settle monthly, and a shorter window shows nothing.`, cost: `the $${c} stays invested for ${hold} days`, time: `${hold} days` },
      { text: `Redeem through ${p.name}'s own page, record the payout versus the schedule it publishes, and close the log entry.`, cost: 'redemption fee if published, gas ~$4', time: '15 minutes plus settlement wait' },
    ];
  },
  default: (p, age) => {
    const chain = chainOf(p);
    const c = capitalFor(p);
    const hold = holdDaysFor(age);
    return [
      { text: `Fund a fresh wallet with $${c} of USDC plus a gas cushion, and reach ${p.name} on ${chain} only from its own domain.`, cost: `$${c} plus about $4 of gas`, time: '15 minutes' },
      { text: `Make one real deposit or first position inside ${p.name} — the smallest its UI accepts — and confirm the transaction before adding more.`, cost: `$${c} at stake, ~$3 of gas`, time: '15 minutes' },
      { text: `Repeat one qualifying action each week (deposit, swap, vote or claim) so the wallet appears in more than one activity window.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Hold the position at least ${hold} days; eligibility snapshots reward wallets that stay through them.`, cost: `the $${c} stays in the protocol for ${hold} days`, time: `${hold} days` },
      { text: `Check ${p.name}'s own points or rewards page weekly and claim only from the link it publishes — no DMs, no airdrop sites.`, cost: 'free to check, never pay to claim', time: '5 minutes a week' },
      { text: `Withdraw from the protocol's own interface at the end and write down deposits, withdrawals and rewards in the farm log.`, cost: 'gas ~$4 to withdraw', time: '15 minutes to unwind' },
    ];
  },
};

/** Satu langkah sebagai satu string: aksi, lalu biaya dan durasi — selalu 20..600 karakter. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check ${step.cost} against the protocol's own page.`;
  return s;
}

/** Rencana lengkap satu protocol: grup menentukan langkah-langkahnya, angka datang dari record. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const group = planGroup(p.category);
  const builder = PLAN_BUILDERS[group] ?? PLAN_BUILDERS.default!;
  return [SAFETY_STEP(p), ...builder(p, age), LOG_STEP(p, capitalFor(p))];
}

/** Baris baris papan: watchlist selalu penuh, lalu temuan awal paling besar TVL-nya. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; tables: ReturnType<typeof buildMultipleTable> } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const tables = buildMultipleTable(snapshot);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model, tables) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((entry, i) => ({
    rank: i + 1,
    slug: entry.p.slug,
    name: entry.p.name,
    category: entry.p.category,
    chains: entry.p.chains,
    tvl_usd: entry.p.tvl_usd,
    change_7d: entry.p.change_7d,
    mcap_usd: entry.p.mcap_usd,
    listed_at: entry.p.listed_at,
    gecko_id: entry.p.gecko_id,
    symbol: entry.p.symbol,
    token_status: 'pre-token',
    age_days: entry.s.age,
    implied_value_usd: entry.s.implied,
    model: {
      category_multiple: round4(entry.s.ratio),
      multiple_source: entry.s.ratioSource,
      growth_pct: entry.s.growthPct,
      growth_multiplier: round4(entry.s.growthMult),
      maturity_multiplier: round4(entry.s.maturityMult),
      age_days: entry.s.age,
    },
    farm_steps: farmSteps(entry.p, entry.s.age).map(stepText),
  }));
  return { board, tables };
}

/** Referensi pasar: protocol ber-token terbesar, terpisah dari papan peringkat. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** Bentuk padat satu baris untuk data.js — rencana farming ikut agar layar sama dengan kode. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
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
    watchlist_member: watchlist.has(row.slug),
    plan_group: planGroup(row.category),
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    multiple_source: row.model.multiple_source,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Segala yang dashboard render, dari snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, tables } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const earlySize = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    multiple_table: tables.table,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** Snapshot dari teks file, ditolak kecuali bentuknya yang dipetakan model. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
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

/** Kenapa sebuah papan ditolak gerbang, atau null: cakupan, urutan, nilai, langkah farming. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows: the gate wants at least 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows: the gate allows at most 4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const outside = board.length - snapshot.watchlist.filter((s) => slugs.has(s)).length;
  if (outside < 60) return `the board carries ${outside} protocols beyond the watchlist: the gate wants at least 60`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** data.js padat: seluruh dataset dashboard sebagai satu skrip, tanpa fetch tanpa jaringan. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
