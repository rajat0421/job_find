// config.service.js centralizes every admin-tunable Config-backed setting
// used by the email pipeline (score threshold, posting-freshness limits) so
// none of it is scattered as a literal across controllers/services. This file
// is the one place that tests the fallback/validation behavior directly,
// rather than re-testing it indirectly through every caller.

jest.mock('../../models/Config', () => ({ findOne: jest.fn() }));

const Config = require('../../models/Config');
const {
  getConfigValue, getEmailThreshold, getEmailFreshnessConfig,
  DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS, ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS,
} = require('../config.service');

const buildFindOne = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

beforeEach(() => jest.clearAllMocks());

describe('getConfigValue', () => {
  test('returns the stored value when present', async () => {
    Config.findOne.mockReturnValue(buildFindOne({ key: 'x', value: '42' }));
    await expect(getConfigValue('x', 'fallback')).resolves.toBe('42');
  });

  test('falls back when no document exists', async () => {
    Config.findOne.mockReturnValue(buildFindOne(null));
    await expect(getConfigValue('x', 'fallback')).resolves.toBe('fallback');
  });

  test('falls back when the stored value is an empty string', async () => {
    Config.findOne.mockReturnValue(buildFindOne({ key: 'x', value: '' }));
    await expect(getConfigValue('x', 'fallback')).resolves.toBe('fallback');
  });

  test('falls back (never throws) if the DB read itself fails', async () => {
    Config.findOne.mockImplementation(() => { throw new Error('connection lost'); });
    await expect(getConfigValue('x', 'fallback')).resolves.toBe('fallback');
  });
});

describe('getEmailThreshold', () => {
  test('defaults to 50 when unset', async () => {
    Config.findOne.mockReturnValue(buildFindOne(null));
    await expect(getEmailThreshold()).resolves.toBe(50);
  });

  test('uses a valid configured value', async () => {
    Config.findOne.mockReturnValue(buildFindOne({ value: '75' }));
    await expect(getEmailThreshold()).resolves.toBe(75);
  });

  test.each(['0', '-5', '101', 'not-a-number'])('rejects an out-of-range or non-numeric value (%s) and falls back to 50', async (bad) => {
    Config.findOne.mockReturnValue(buildFindOne({ value: bad }));
    await expect(getEmailThreshold()).resolves.toBe(50);
  });
});

describe('getEmailFreshnessConfig', () => {
  test('defaults to 30 days general / 14 days Adzuna when unset', async () => {
    Config.findOne.mockReturnValue(buildFindOne(null));

    const freshness = await getEmailFreshnessConfig();

    expect(freshness).toEqual({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 });
    expect(DEFAULT_EMAIL_FRESHNESS_MAX_AGE_DAYS).toBe(30);
    expect(ADZUNA_EMAIL_FRESHNESS_MAX_AGE_DAYS).toBe(14);
  });

  test('uses valid admin-configured overrides for both limits independently', async () => {
    Config.findOne.mockImplementation(({ key }) => buildFindOne(
      key === 'emailFreshnessMaxAgeDays' ? { value: '45' } : { value: '7' }
    ));

    const freshness = await getEmailFreshnessConfig();

    expect(freshness).toEqual({ defaultMaxAgeDays: 45, adzunaMaxAgeDays: 7 });
  });

  test.each(['0', '-10', 'not-a-number'])('an invalid general limit (%s) falls back to the 30-day default without affecting the Adzuna limit', async (bad) => {
    Config.findOne.mockImplementation(({ key }) => buildFindOne(
      key === 'emailFreshnessMaxAgeDays' ? { value: bad } : { value: '7' }
    ));

    const freshness = await getEmailFreshnessConfig();

    expect(freshness).toEqual({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 7 });
  });

  test('an invalid Adzuna limit falls back to the 14-day default without affecting the general limit', async () => {
    Config.findOne.mockImplementation(({ key }) => buildFindOne(
      key === 'emailFreshnessMaxAgeDays' ? { value: '45' } : { value: '-3' }
    ));

    const freshness = await getEmailFreshnessConfig();

    expect(freshness).toEqual({ defaultMaxAgeDays: 45, adzunaMaxAgeDays: 14 });
  });
});
