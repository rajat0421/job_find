// Locks in the existing email schedule so the fetch/match cron split (or any
// future change) can't silently alter cadence for hourly Premium users,
// 5-hour users, or daily users. If any of these break, user-facing email
// delivery timing has changed and needs explicit approval before merging.

jest.mock('node-cron', () => ({ schedule: jest.fn() }));
jest.mock('../../models/User', () => ({}));
jest.mock('../../models/UserJob', () => ({}));
jest.mock('../../models/EmailLog', () => ({}));
jest.mock('../../models/Config', () => ({}));
jest.mock('../../services/email.service', () => ({ sendJobDigestEmail: jest.fn(), sendAdminDigestCopy: jest.fn(), isSafeHttpUrl: jest.requireActual('../../services/email.service').isSafeHttpUrl }));
jest.mock('../../services/config.service', () => ({ getEmailThreshold: jest.fn(), getEmailFreshnessConfig: jest.fn().mockResolvedValue({ defaultMaxAgeDays: 30, adzunaMaxAgeDays: 14 }) }));

const cron = require('node-cron');
const { startDailyEmailCron, isDue } = require('../dailyEmail.job');

describe('email cron registration', () => {
  test('still runs at :20, Asia/Kolkata — unchanged from before the cron split', () => {
    startDailyEmailCron();
    expect(cron.schedule).toHaveBeenCalledWith(
      '20 * * * *',
      expect.any(Function),
      { timezone: 'Asia/Kolkata' }
    );
  });
});

// Fixed instant: 2026-01-01T04:30:00Z == IST 2026-01-01 10:00 (UTC+5:30)
const FIXED_NOW = '2026-01-01T04:30:00.000Z';
const minutesAgo = (mins) => new Date(new Date(FIXED_NOW).getTime() - mins * 60 * 1000);

describe('isDue — hourly Premium users (emailIntervalHours = 1)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date(FIXED_NOW));
  });
  afterEach(() => jest.useRealTimers());

  test('never emailed before → due', () => {
    expect(isDue({ emailIntervalHours: 1, lastEmailedAt: null })).toBe(true);
  });

  test('emailed 50 min ago (< 55 min grace-adjusted threshold) → not due yet', () => {
    expect(isDue({ emailIntervalHours: 1, lastEmailedAt: minutesAgo(50) })).toBe(false);
  });

  test('emailed exactly 55 min ago (grace boundary) → due', () => {
    expect(isDue({ emailIntervalHours: 1, lastEmailedAt: minutesAgo(55) })).toBe(true);
  });

  test('emailed 61 min ago → due', () => {
    expect(isDue({ emailIntervalHours: 1, lastEmailedAt: minutesAgo(61) })).toBe(true);
  });
});

describe('isDue — 5-hour plan users (emailIntervalHours = 5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date(FIXED_NOW));
  });
  afterEach(() => jest.useRealTimers());

  test('emailed 294 min ago (< 295 min grace-adjusted threshold) → not due yet', () => {
    expect(isDue({ emailIntervalHours: 5, lastEmailedAt: minutesAgo(294) })).toBe(false);
  });

  test('emailed 295 min ago (grace boundary) → due', () => {
    expect(isDue({ emailIntervalHours: 5, lastEmailedAt: minutesAgo(295) })).toBe(true);
  });
});

describe('isDue — daily users (emailIntervalHours = 24, emailSendHourIST)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date(FIXED_NOW)); // IST hour is 10 at this instant
  });
  afterEach(() => jest.useRealTimers());

  test('current IST hour does not match emailSendHourIST → not due, regardless of lastEmailedAt', () => {
    expect(isDue({ emailIntervalHours: 24, emailSendHourIST: 11, lastEmailedAt: null })).toBe(false);
  });

  test('hour matches, never emailed → due', () => {
    expect(isDue({ emailIntervalHours: 24, emailSendHourIST: 10, lastEmailedAt: null })).toBe(true);
  });

  test('hour matches, already emailed earlier the same IST calendar day → not due', () => {
    // IST 2026-01-01 06:30 — same IST calendar day as FIXED_NOW (2026-01-01)
    const sameDay = new Date('2026-01-01T01:00:00.000Z');
    expect(isDue({ emailIntervalHours: 24, emailSendHourIST: 10, lastEmailedAt: sameDay })).toBe(false);
  });

  test('hour matches, last emailed on a previous IST calendar day → due', () => {
    // IST 2025-12-31 10:00 — previous IST calendar day
    const previousDay = new Date('2025-12-31T04:30:00.000Z');
    expect(isDue({ emailIntervalHours: 24, emailSendHourIST: 10, lastEmailedAt: previousDay })).toBe(true);
  });
});
