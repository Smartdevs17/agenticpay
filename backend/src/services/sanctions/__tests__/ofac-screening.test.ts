import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_THRESHOLD,
  SAMPLE_SANCTIONS_ENTRIES,
  clearScreeningHistory,
  editSimilarity,
  getScreeningHistory,
  getSanctionsEntity,
  getSanctionsListSize,
  levenshtein,
  listSanctionsEntities,
  loadSanctionsEntries,
  nameSimilarity,
  normalizeName,
  removeSanctionsEntity,
  screenEntity,
  screenTransaction,
  tokenSimilarity,
  upsertSanctionsEntity,
} from '../ofac-screening.js';

beforeEach(() => {
  loadSanctionsEntries(SAMPLE_SANCTIONS_ENTRIES, { replace: true });
  clearScreeningHistory();
});

describe('sanctions name normalisation and similarity (#923)', () => {
  it('strips diacritics, punctuation and noise tokens', () => {
    expect(normalizeName('Ivanov, Sergei  Petrovich')).toBe('ivanov sergei petrovich');
    expect(normalizeName('Acme Shipping Company Ltd.')).toBe('acme shipping');
    expect(normalizeName('José  Öztürk')).toBe('jose ozturk');
  });

  it('computes Levenshtein distance and edit similarity', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(editSimilarity('ivanov', 'ivanov')).toBe(1);
    expect(editSimilarity('ivanov', 'ivanof')).toBeCloseTo(5 / 6, 5);
  });

  it('matches reordered tokens via token-set similarity', () => {
    expect(tokenSimilarity('sergei ivanov', 'ivanov sergei petrovich')).toBe(1);
    expect(nameSimilarity('Sergei Ivanov', 'Ivanov, Sergei Petrovich')).toBe(1);
  });
});

describe('sanctions screening decisions (#923)', () => {
  it('returns an exact match for a listed name', () => {
    const result = screenEntity({ name: 'Ivanov, Sergei Petrovich' });
    expect(result.status).toBe('match');
    expect(result.matches[0].entity.id).toBe('sdn-sample-0001');
    expect(result.matches[0].reasons).toContain('exact_name_match');
  });

  it('matches on a reordered alias', () => {
    const result = screenEntity({ name: 'Sergey Ivanov' });
    expect(result.status).toBe('match');
    expect(result.matches[0].entity.id).toBe('sdn-sample-0001');
  });

  it('treats a matching national id as decisive even when the name differs', () => {
    const result = screenEntity({ name: 'Completely Unrelated', nationalId: 'RU-680412-001' });
    expect(result.status).toBe('match');
    expect(result.matches[0].score).toBe(1);
    expect(result.matches[0].reasons).toContain('national_id_match');
  });

  it('skips the entity-type penalty when the type is omitted', () => {
    const typed = screenEntity({ name: 'Acme Shipping Company Ltd', entityType: 'vessel' });
    const untyped = screenEntity({ name: 'Acme Shipping Company Ltd' });
    expect(typed.matches[0].score).toBeLessThan(untyped.matches[0].score);
    expect(typed.matches[0].reasons).toContain('entity_type_mismatch');
  });

  it('returns clear for unrelated names', () => {
    const result = screenEntity({ name: 'Alice Wonderland' });
    expect(result.status).toBe('clear');
    expect(result.matches).toHaveLength(0);
  });

  it('honours a custom potential threshold and list filter', () => {
    const partial = screenEntity({ name: 'Ivanov Sergei Xyz' });
    expect(partial.status).toBe('potential_match');

    const strict = screenEntity({ name: 'Ivanov Sergei Xyz' }, { potentialThreshold: 0.9 });
    expect(strict.status).toBe('clear');

    const limited = screenEntity({ name: 'Ivanov, Sergei Petrovich' }, { lists: ['EU'] });
    expect(limited.status).toBe('clear');
    expect(limited.considered).toBe(0);
  });

  it('caps the number of returned matches', () => {
    const result = screenEntity({ name: 'Sea Breeze' }, { maxResults: 1 });
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });

  it('reports the default thresholds', () => {
    const result = screenEntity({ name: 'Nobody Here' });
    expect(result.threshold).toBe(DEFAULT_MATCH_THRESHOLD);
    expect(result.potentialThreshold).toBeLessThan(result.threshold);
  });
});

describe('sanctions transaction screening (#923)', () => {
  it('escalates when the payee matches', () => {
    const result = screenTransaction({
      transactionId: 'tx_1',
      payer: { name: 'Alice Wonderland' },
      payee: { name: 'Ivanov, Sergei Petrovich' },
    });
    expect(result.status).toBe('match');
    expect(result.payee?.status).toBe('match');
    expect(result.payer?.status).toBe('clear');
  });

  it('stays clear when both parties are clean', () => {
    const result = screenTransaction({
      payer: { name: 'Alice Wonderland' },
      payee: { name: 'Bob Builder' },
    });
    expect(result.status).toBe('clear');
  });
});

describe('sanctions watchlist management (#923)', () => {
  it('adds, reads and removes entries', () => {
    const sizeBefore = getSanctionsListSize();
    const added = upsertSanctionsEntity({
      id: 'custom-1',
      list: 'EU',
      name: 'Test Entity',
      entityType: 'entity',
    });
    expect(added.id).toBe('custom-1');
    expect(getSanctionsListSize()).toBe(sizeBefore + 1);
    expect(getSanctionsEntity('custom-1')?.name).toBe('Test Entity');

    expect(removeSanctionsEntity('custom-1')).toBe(true);
    expect(removeSanctionsEntity('custom-1')).toBe(false);
    expect(getSanctionsEntity('custom-1')).toBeNull();
  });

  it('filters entries by list, type and country', () => {
    expect(listSanctionsEntities({ list: 'OFAC_CONSOLIDATED' }).every((e) => e.list === 'OFAC_CONSOLIDATED')).toBe(true);
    expect(listSanctionsEntities({ entityType: 'vessel' })).toHaveLength(1);
    expect(listSanctionsEntities({ country: 'ru' }).length).toBeGreaterThan(0);
  });

  it('replaces the whole watchlist on demand', () => {
    const loaded = loadSanctionsEntries(
      [{ id: 'only', list: 'UN', name: 'Solo Entity', entityType: 'entity' }],
      { replace: true },
    );
    expect(loaded).toBe(1);
    expect(getSanctionsListSize()).toBe(1);
  });
});

describe('sanctions screening history (#923)', () => {
  it('records each screening and supports filters', () => {
    screenEntity({ name: 'Ivanov, Sergei Petrovich' });
    screenEntity({ name: 'Alice Wonderland' });

    const all = getScreeningHistory();
    expect(all).toHaveLength(2);
    expect(getScreeningHistory({ status: 'match' })).toHaveLength(1);
    expect(getScreeningHistory({ status: 'clear' })).toHaveLength(1);
    expect(getScreeningHistory({ since: new Date(Date.now() + 60_000).toISOString() })).toHaveLength(0);
  });
});
