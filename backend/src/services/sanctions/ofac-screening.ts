/**
 * Sanctions Screening against OFAC lists — Issue #923
 *
 * Screens customers, counterparties and transactions against a watchlist that
 * models the OFAC Specially Designated Nationals (SDN) and consolidated lists.
 * Matching is fuzzy by design: names are normalised, compared with token and
 * edit-distance similarity, then boosted by strong identifiers (date of birth,
 * national id, country) so that transliteration and ordering differences do not
 * hide a real hit.
 *
 * The service ships with illustrative sample entries. Bulk-load real list data
 * with `loadSanctionsEntries()` in a scheduled refresh job.
 */

import { randomUUID } from 'node:crypto';

export type SanctionsListName = 'OFAC_SDN' | 'OFAC_CONSOLIDATED' | 'EU' | 'UN' | 'UK_OFSI';
export type SanctionsEntityType = 'individual' | 'entity' | 'vessel' | 'aircraft';
export type SanctionsMatchStatus = 'clear' | 'potential_match' | 'match';

export interface SanctionsEntity {
  id: string;
  list: SanctionsListName;
  name: string;
  aliases?: string[];
  entityType: SanctionsEntityType;
  programs?: string[];
  countries?: string[];
  dateOfBirth?: string; // YYYY-MM-DD
  nationalIds?: string[];
  remarks?: string;
}

export interface SanctionsQuery {
  name: string;
  aliases?: string[];
  entityType?: SanctionsEntityType;
  countries?: string[];
  dateOfBirth?: string;
  nationalId?: string;
}

export interface SanctionsMatch {
  entity: SanctionsEntity;
  score: number;
  matchedName: string;
  reasons: string[];
}

export interface SanctionsScreeningResult {
  query: SanctionsQuery;
  status: SanctionsMatchStatus;
  matches: SanctionsMatch[];
  screenedAt: string;
  threshold: number;
  potentialThreshold: number;
  lists: SanctionsListName[];
  considered: number;
}

export interface ScreeningOptions {
  /** Minimum score for a definitive match. Default 0.85. */
  threshold?: number;
  /** Minimum score for a potential match. Default 0.65. */
  potentialThreshold?: number;
  /** Restrict screening to these lists. Defaults to every loaded list. */
  lists?: SanctionsListName[];
  /** Maximum number of matches to return (highest score first). Default 10. */
  maxResults?: number;
}

export interface SanctionsScreeningRecord {
  id: string;
  queryName: string;
  status: SanctionsMatchStatus;
  topScore: number;
  matchIds: string[];
  screenedAt: string;
}

export const DEFAULT_MATCH_THRESHOLD = 0.85;
export const DEFAULT_POTENTIAL_THRESHOLD = 0.65;
const MAX_HISTORY = 500;

// ─── Name normalisation ───────────────────────────────────────────────────────

const NOISE_TOKENS = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'lord',
  'ltd', 'limited', 'llc', 'llp', 'inc', 'incorporated', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'sa', 'ag', 'plc', 'bv', 'nv', 'pjsc', 'ojsc', 'jsc',
]);

/**
 * Normalise a name for comparison: strip diacritics/punctuation, collapse
 * whitespace, lowercase and drop corporate/honorific noise tokens.
 */
export function normalizeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !NOISE_TOKENS.has(token));
  return cleaned.join(' ').trim();
}

function tokenSet(normalizedName: string): Set<string> {
  return new Set(normalizedName.split(' ').filter(Boolean));
}

// ─── Similarity ───────────────────────────────────────────────────────────────

/** Iterative Levenshtein distance with O(min(m,n)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let previous = Array.from({ length: shorter.length + 1 }, (_, i) => i);

  for (let i = 1; i <= longer.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= shorter.length; j += 1) {
      const cost = longer[i - 1] === shorter[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }

  return previous[shorter.length];
}

/** Edit similarity in [0, 1]. */
export function editSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Token-set (order-insensitive) similarity in [0, 1]. */
export function tokenSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;
  const containment = Math.min(setA.size, setB.size) === 0
    ? 0
    : intersection / Math.min(setA.size, setB.size);
  return Math.max(jaccard, containment);
}

/** Combined name similarity used by the matcher. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  return Math.max(editSimilarity(na, nb), tokenSimilarity(na, nb));
}

// ─── Watchlist store ──────────────────────────────────────────────────────────

const watchlist = new Map<string, SanctionsEntity>();
const screeningHistory: SanctionsScreeningRecord[] = [];

/**
 * Illustrative sample entries used to make the screening engine usable out of
 * the box. These are fictional fixtures, not the actual OFAC list.
 */
export const SAMPLE_SANCTIONS_ENTRIES: SanctionsEntity[] = [
  {
    id: 'sdn-sample-0001',
    list: 'OFAC_SDN',
    name: 'Ivanov, Sergei Petrovich',
    aliases: ['Sergey Ivanov', 'S. P. Ivanov'],
    entityType: 'individual',
    programs: ['RUSSIA-EO14024'],
    countries: ['RU'],
    dateOfBirth: '1968-04-12',
    nationalIds: ['RU-680412-001'],
  },
  {
    id: 'sdn-sample-0002',
    list: 'OFAC_SDN',
    name: 'Petrov, Dmitry Alexandrovich',
    aliases: ['Dmitri Petrov'],
    entityType: 'individual',
    programs: ['RUSSIA-EO14024'],
    countries: ['RU'],
    dateOfBirth: '1974-11-03',
  },
  {
    id: 'sdn-sample-0003',
    list: 'OFAC_SDN',
    name: 'Acme Shipping Company Ltd',
    aliases: ['Acme Shipping Co'],
    entityType: 'entity',
    programs: ['IRAN-EO13902'],
    countries: ['IR'],
  },
  {
    id: 'sdn-sample-0004',
    list: 'OFAC_CONSOLIDATED',
    name: 'Global Trading and Logistics LLC',
    aliases: ['Global Trading LLC', 'GTL'],
    entityType: 'entity',
    programs: ['SYRIA-EO13894'],
    countries: ['SY'],
  },
  {
    id: 'sdn-sample-0005',
    list: 'OFAC_SDN',
    name: 'Sea Breeze',
    aliases: ['MV Sea Breeze', 'M/V Sea Breeze'],
    entityType: 'vessel',
    programs: ['NORTH-KOREA-EO13810'],
    countries: ['KP'],
  },
];

export function loadSanctionsEntries(entries: SanctionsEntity[], options: { replace?: boolean } = {}): number {
  if (options.replace) watchlist.clear();
  let loaded = 0;
  for (const entry of entries) {
    watchlist.set(entry.id, { ...entry });
    loaded += 1;
  }
  return loaded;
}

export function upsertSanctionsEntity(entry: Omit<SanctionsEntity, 'id'> & { id?: string }): SanctionsEntity {
  const stored: SanctionsEntity = { ...entry, id: entry.id ?? `sdn_${randomUUID()}` };
  watchlist.set(stored.id, stored);
  return stored;
}

export function removeSanctionsEntity(id: string): boolean {
  return watchlist.delete(id);
}

export function getSanctionsEntity(id: string): SanctionsEntity | null {
  return watchlist.get(id) ?? null;
}

export function listSanctionsEntities(filter?: {
  list?: SanctionsListName;
  entityType?: SanctionsEntityType;
  country?: string;
}): SanctionsEntity[] {
  let list = Array.from(watchlist.values());
  if (filter?.list) list = list.filter((e) => e.list === filter.list);
  if (filter?.entityType) list = list.filter((e) => e.entityType === filter.entityType);
  if (filter?.country) {
    const country = filter.country.toUpperCase();
    list = list.filter((e) => (e.countries ?? []).map((c) => c.toUpperCase()).includes(country));
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

export function getSanctionsListSize(): number {
  return watchlist.size;
}

// ─── Screening ────────────────────────────────────────────────────────────────

function scoreEntity(query: SanctionsQuery, entity: SanctionsEntity): SanctionsMatch | null {
  const reasons: string[] = [];
  const candidateNames = [entity.name, ...(entity.aliases ?? [])];

  let bestName = entity.name;
  let bestNameScore = 0;
  for (const candidate of candidateNames) {
    const score = nameSimilarity(query.name, candidate);
    if (score > bestNameScore) {
      bestNameScore = score;
      bestName = candidate;
    }
  }

  // Also consider any query aliases against the entity names.
  for (const alias of query.aliases ?? []) {
    for (const candidate of candidateNames) {
      const score = nameSimilarity(alias, candidate);
      if (score > bestNameScore) {
        bestNameScore = score;
        bestName = candidate;
        reasons.push(`alias_match:${alias}`);
      }
    }
  }

  if (bestNameScore === 0 && !(query.nationalId && entity.nationalIds?.includes(query.nationalId))) {
    return null;
  }

  let score = bestNameScore;
  if (bestNameScore >= 0.999) reasons.push('exact_name_match');
  else if (bestNameScore >= DEFAULT_POTENTIAL_THRESHOLD) reasons.push('fuzzy_name_match');

  // Strong identifier: national id exact match is decisive.
  if (query.nationalId && entity.nationalIds?.includes(query.nationalId)) {
    score = 1;
    reasons.push('national_id_match');
  }

  // Date of birth corroboration.
  if (query.dateOfBirth && entity.dateOfBirth) {
    if (query.dateOfBirth === entity.dateOfBirth) {
      score = Math.min(1, score + 0.1);
      reasons.push('dob_match');
    } else {
      score = Math.max(0, score - 0.05);
      reasons.push('dob_mismatch');
    }
  }

  // Country corroboration.
  if (query.countries && query.countries.length > 0 && entity.countries) {
    const queryCountries = query.countries.map((c) => c.toUpperCase());
    const entityCountries = entity.countries.map((c) => c.toUpperCase());
    if (queryCountries.some((c) => entityCountries.includes(c))) {
      score = Math.min(1, score + 0.05);
      reasons.push('country_match');
    }
  }

  // Entity-type mismatch slightly weakens the signal.
  if (query.entityType && entity.entityType !== query.entityType) {
    score = Math.max(0, score - 0.1);
    reasons.push('entity_type_mismatch');
  }

  return {
    entity,
    score: Number(score.toFixed(4)),
    matchedName: bestName,
    reasons,
  };
}

export function screenEntity(
  query: SanctionsQuery,
  options: ScreeningOptions = {},
): SanctionsScreeningResult {
  const threshold = options.threshold ?? DEFAULT_MATCH_THRESHOLD;
  const potentialThreshold = options.potentialThreshold ?? DEFAULT_POTENTIAL_THRESHOLD;
  const maxResults = options.maxResults ?? 10;

  let candidates = Array.from(watchlist.values());
  if (options.lists && options.lists.length > 0) {
    candidates = candidates.filter((entity) => options.lists?.includes(entity.list));
  }

  const matches = candidates
    .map((entity) => scoreEntity(query, entity))
    .filter((match): match is SanctionsMatch => match !== null && match.score >= potentialThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  let status: SanctionsMatchStatus = 'clear';
  if (matches.some((match) => match.score >= threshold)) status = 'match';
  else if (matches.length > 0) status = 'potential_match';

  const result: SanctionsScreeningResult = {
    query,
    status,
    matches,
    screenedAt: new Date().toISOString(),
    threshold,
    potentialThreshold,
    lists: options.lists ?? Array.from(new Set(candidates.map((c) => c.list))),
    considered: candidates.length,
  };

  recordScreening(result);
  return result;
}

export interface TransactionScreeningInput {
  transactionId?: string;
  payer?: SanctionsQuery;
  payee?: SanctionsQuery;
}

export interface TransactionScreeningResult {
  transactionId?: string;
  status: SanctionsMatchStatus;
  payer?: SanctionsScreeningResult;
  payee?: SanctionsScreeningResult;
  screenedAt: string;
}

export function screenTransaction(
  input: TransactionScreeningInput,
  options?: ScreeningOptions,
): TransactionScreeningResult {
  const payer = input.payer ? screenEntity(input.payer, options) : undefined;
  const payee = input.payee ? screenEntity(input.payee, options) : undefined;

  const statuses = [payer?.status, payee?.status];
  let status: SanctionsMatchStatus = 'clear';
  if (statuses.includes('match')) status = 'match';
  else if (statuses.includes('potential_match')) status = 'potential_match';

  return {
    transactionId: input.transactionId,
    status,
    payer,
    payee,
    screenedAt: new Date().toISOString(),
  };
}

// ─── Screening history ────────────────────────────────────────────────────────

function recordScreening(result: SanctionsScreeningResult): void {
  screeningHistory.push({
    id: `screen_${randomUUID()}`,
    queryName: result.query.name,
    status: result.status,
    topScore: result.matches[0]?.score ?? 0,
    matchIds: result.matches.map((m) => m.entity.id),
    screenedAt: result.screenedAt,
  });
  if (screeningHistory.length > MAX_HISTORY) screeningHistory.shift();
}

export function getScreeningHistory(filter?: {
  status?: SanctionsMatchStatus;
  since?: string;
}): SanctionsScreeningRecord[] {
  let list = [...screeningHistory];
  if (filter?.status) list = list.filter((record) => record.status === filter.status);
  if (filter?.since) {
    const sinceMs = Date.parse(filter.since);
    if (!Number.isNaN(sinceMs)) {
      list = list.filter((record) => Date.parse(record.screenedAt) >= sinceMs);
    }
  }
  return list.sort((a, b) => Date.parse(b.screenedAt) - Date.parse(a.screenedAt));
}

export function clearScreeningHistory(): void {
  screeningHistory.length = 0;
}

/** Seed the watchlist with the bundled sample entries (idempotent). */
export function seedSampleWatchlist(): number {
  return loadSanctionsEntries(SAMPLE_SANCTIONS_ENTRIES);
}

// Seed at module load so the API is usable without an explicit bootstrap step.
seedSampleWatchlist();
