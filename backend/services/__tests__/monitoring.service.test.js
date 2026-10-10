// Guards Improvement 6: production observability. monitoring.service.js is
// pure read-side aggregation, so these tests mock every model/dependency it
// reads from and assert on the shape/classification logic itself — the
// underlying FetchRun/MatchRun/EmailLog/Job data is already covered by their
// own pipelines' tests.

jest.mock('../../models/FetchRun', () => ({ find: jest.fn() }));
jest.mock('../../models/MatchRun', () => ({ findOne: jest.fn() }));
jest.mock('../../models/EmailLog', () => ({ aggregate: jest.fn(), findOne: jest.fn() }));
jest.mock('../../models/Job', () => ({ countDocuments: jest.fn() }));
jest.mock('../jobMatcher.service', () => ({
  getPendingMatchBacklog: jest.fn(),
  getMatcherVersionBacklog: jest.fn(),
}));

const FetchRun = require('../../models/FetchRun');
const MatchRun = require('../../models/MatchRun');
const EmailLog = require('../../models/EmailLog');
const Job = require('../../models/Job');
const { getPendingMatchBacklog, getMatcherVersionBacklog } = require('../jobMatcher.service');
const {
  getFetchHealth, getMatchHealth, getEmailHealth, getJobFreshnessHealth, getOperationalOverview, THRESHOLDS,
} = require('../monitoring.service');

// A chainable, thenable fake query — supports .sort().limit().select().lean()
// in any order/combination, resolving to `result` when awaited, matching how
// monitoring.service.js actually calls these models.
const buildQuery = (result) => {
  const q = {};
  q.sort = jest.fn(() => q);
  q.limit = jest.fn(() => q);
  q.select = jest.fn(() => q);
  q.lean = jest.fn(() => q);
  q.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return q;
};

beforeEach(() => {
  jest.clearAllMocks();
  getPendingMatchBacklog.mockResolvedValue({ count: 0, oldestPendingAgeMs: null });
  getMatcherVersionBacklog.mockResolvedValue(0);
});

describe('getFetchHealth', () => {
  test('reports unknown (not falsely healthy) when no fetch runs exist yet', async () => {
    FetchRun.find.mockReturnValue(buildQuery([]));
    const health = await getFetchHealth();
    expect(health.status).toBe('unknown');
  });

  test('status is read directly from the latest run outcome, never inferred from totalAdded', async () => {
    const zeroAddedButHealthy = { _id: 'r1', createdAt: new Date(), outcome: 'success', totalFetched: 100, totalAdded: 0, durationMs: 1000, sources: [{ name: 'Adzuna', outcome: 'success' }] };
    FetchRun.find.mockReturnValue(buildQuery([zeroAddedButHealthy]));

    const health = await getFetchHealth();

    expect(health.status).toBe('success'); // zero new jobs is NOT the same as a failed run
    expect(health.totalAdded).toBe(0);
  });

  test('a run marked failed is reported failed even if some jobs happened to be fetched earlier', async () => {
    const failedRun = { _id: 'r1', createdAt: new Date(), outcome: 'failed', totalFetched: 0, totalAdded: 0, durationMs: 500, sources: [{ name: 'Adzuna', outcome: 'failed' }] };
    FetchRun.find.mockReturnValue(buildQuery([failedRun]));

    const health = await getFetchHealth();

    expect(health.status).toBe('failed');
  });

  // Improvement 9 audit finding: nothing previously compared "how long ago
  // was the last run" against the hourly cadence — a dead scheduler would
  // show its last real outcome forever with no warning.
  describe('staleness (audit fix)', () => {
    test('a recent successful run is not flagged stale', async () => {
      const recent = { _id: 'r1', createdAt: new Date(), outcome: 'success', totalFetched: 5, totalAdded: 1, durationMs: 100, sources: [] };
      FetchRun.find.mockReturnValue(buildQuery([recent]));

      const health = await getFetchHealth();

      expect(health.stale).toBe(false);
      expect(health.warnings.some((w) => w.code === 'fetch_stale')).toBe(false);
    });

    test('a run from well beyond the hourly cadence is flagged stale even though its own outcome was "success"', async () => {
      const longAgo = { _id: 'r1', createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), outcome: 'success', totalFetched: 5, totalAdded: 1, durationMs: 100, sources: [] };
      FetchRun.find.mockReturnValue(buildQuery([longAgo]));

      const health = await getFetchHealth();

      expect(health.status).toBe('success'); // the stored outcome itself is untouched/not overwritten
      expect(health.stale).toBe(true);
      expect(health.warnings.some((w) => w.code === 'fetch_stale')).toBe(true);
    });
  });

  test('consecutive provider failures are counted as a streak from the most recent run backwards', async () => {
    const runs = [
      { createdAt: new Date(3), outcome: 'partial', sources: [{ name: 'Lever', outcome: 'failed' }] },
      { createdAt: new Date(2), outcome: 'partial', sources: [{ name: 'Lever', outcome: 'failed' }] },
      { createdAt: new Date(1), outcome: 'success', sources: [{ name: 'Lever', outcome: 'success' }] },
    ];
    FetchRun.find.mockReturnValue(buildQuery(runs));

    const health = await getFetchHealth();

    const lever = health.providers.find((p) => p.name === 'Lever');
    expect(lever.consecutiveFailures).toBe(2);
    expect(lever.lastSuccessAt).toEqual(new Date(1));
    expect(health.warnings.some((w) => w.code === 'fetch_provider_failing')).toBe(true);
  });

  test('a provider failing fewer than the configured streak threshold is not flagged', async () => {
    const runs = [
      { createdAt: new Date(2), outcome: 'partial', sources: [{ name: 'Adzuna', outcome: 'failed' }] },
      { createdAt: new Date(1), outcome: 'success', sources: [{ name: 'Adzuna', outcome: 'success' }] },
    ];
    FetchRun.find.mockReturnValue(buildQuery(runs));

    const health = await getFetchHealth();

    expect(THRESHOLDS.FETCH_CONSECUTIVE_FAILURES).toBeGreaterThan(1);
    expect(health.warnings.some((w) => w.code === 'fetch_provider_failing')).toBe(false);
  });

  test('a board failing repeatedly is surfaced via FetchRun.sources[].failures — no new schema queried', async () => {
    const runs = [
      { createdAt: new Date(3), sources: [{ name: 'Greenhouse', outcome: 'partial', failures: [{ name: 'AcmeCo', reason: 'timeout' }] }] },
      { createdAt: new Date(2), sources: [{ name: 'Greenhouse', outcome: 'partial', failures: [{ name: 'AcmeCo', reason: 'timeout' }] }] },
      { createdAt: new Date(1), sources: [{ name: 'Greenhouse', outcome: 'success', failures: [] }] },
    ];
    FetchRun.find.mockReturnValue(buildQuery(runs));

    const health = await getFetchHealth();

    expect(health.failingBoards).toEqual([expect.objectContaining({ name: 'AcmeCo', consecutiveFailures: 2, lastReason: 'timeout' })]);
  });

  test('the fetch-run scan is bounded (not a full collection scan)', async () => {
    const query = buildQuery([]);
    FetchRun.find.mockReturnValue(query);

    await getFetchHealth();

    expect(query.limit).toHaveBeenCalled();
    expect(query.limit.mock.calls[0][0]).toBeGreaterThan(0);
    expect(query.limit.mock.calls[0][0]).toBeLessThanOrEqual(50); // a bounded recent-history window, not unlimited
  });
});

describe('getMatchHealth', () => {
  test('reports unknown (not falsely healthy) when no match runs exist yet', async () => {
    MatchRun.findOne.mockReturnValue(buildQuery(null));
    const health = await getMatchHealth();
    expect(health.status).toBe('unknown');
  });

  test('a successful run reports success with its recorded counts', async () => {
    MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(), created: 5, updated: 2, errorCount: 0, pendingMarkedProcessed: true }));
    const health = await getMatchHealth();
    expect(health.status).toBe('success');
    expect(health.created).toBe(5);
    expect(health.updated).toBe(2);
  });

  test('a failed run is flagged with an error-severity warning', async () => {
    MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'failed', createdAt: new Date(), created: 0, updated: 0, errorCount: 0, pendingMarkedProcessed: false }));
    const health = await getMatchHealth();
    expect(health.status).toBe('failed');
    expect(health.warnings).toContainEqual(expect.objectContaining({ code: 'match_run_failed', severity: 'error' }));
  });

  // Improvement 9 audit finding — same gap as getFetchHealth's staleness check.
  describe('staleness (audit fix)', () => {
    test('a recent successful run is not flagged stale', async () => {
      MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(), created: 1, updated: 0, errorCount: 0, pendingMarkedProcessed: true }));
      const health = await getMatchHealth();
      expect(health.stale).toBe(false);
    });

    test('a run from well beyond the hourly cadence is flagged stale even though its own outcome was "success"', async () => {
      MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), created: 1, updated: 0, errorCount: 0, pendingMarkedProcessed: true }));
      const health = await getMatchHealth();
      expect(health.status).toBe('success');
      expect(health.stale).toBe(true);
      expect(health.warnings.some((w) => w.code === 'match_stale')).toBe(true);
    });
  });

  test('warns when the oldest pending job has aged past the configured threshold', async () => {
    MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(), created: 0, updated: 0, errorCount: 0, pendingMarkedProcessed: true }));
    const health = await getMatchHealth({ pendingBacklog: { count: 3, oldestPendingAgeMs: THRESHOLDS.MATCH_PENDING_AGE_WARN_MS + 1000 }, versionBacklog: 0 });
    expect(health.warnings.some((w) => w.code === 'match_pending_stale')).toBe(true);
  });

  test('does not warn about pending age when nothing is pending', async () => {
    MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(), created: 0, updated: 0, errorCount: 0, pendingMarkedProcessed: true }));
    const health = await getMatchHealth({ pendingBacklog: { count: 0, oldestPendingAgeMs: null }, versionBacklog: 0 });
    expect(health.warnings.some((w) => w.code === 'match_pending_stale')).toBe(false);
  });
});

describe('getEmailHealth', () => {
  test('distinguishes sent, skipped and failed — a skip is never counted as a failure', async () => {
    EmailLog.aggregate
      .mockResolvedValueOnce([{ _id: 'sent', count: 3 }, { _id: 'skipped', count: 7 }]) // last 24h
      .mockResolvedValueOnce([]); // previous 24h
    EmailLog.findOne.mockReturnValue(buildQuery({ sentAt: new Date() }));

    const health = await getEmailHealth();

    expect(health.last24h).toEqual({ sent: 3, skipped: 7, failed: 0 });
    expect(health.status).toBe('success'); // skips alone never degrade status
  });

  test('a window with both successes and failures is reported partial, not failed', async () => {
    EmailLog.aggregate
      .mockResolvedValueOnce([{ _id: 'sent', count: 2 }, { _id: 'failed', count: 1 }])
      .mockResolvedValueOnce([]);
    EmailLog.findOne.mockReturnValue(buildQuery({ sentAt: new Date() }));

    const health = await getEmailHealth();

    expect(health.status).toBe('partial');
  });

  test('a window with only failures and zero successes is reported failed', async () => {
    EmailLog.aggregate
      .mockResolvedValueOnce([{ _id: 'failed', count: 4 }])
      .mockResolvedValueOnce([]);
    EmailLog.findOne.mockReturnValue(buildQuery({ sentAt: new Date() }));

    const health = await getEmailHealth();

    expect(health.status).toBe('failed');
  });

  test('warns when there has been no successful delivery at all', async () => {
    EmailLog.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    EmailLog.findOne.mockReturnValue(buildQuery(null));

    const health = await getEmailHealth();

    expect(health.lastSuccessAt).toBeNull();
    expect(health.warnings.some((w) => w.code === 'email_no_recent_success')).toBe(true);
  });

  test('warns when failures are increasing relative to the prior window', async () => {
    EmailLog.aggregate
      .mockResolvedValueOnce([{ _id: 'failed', count: 5 }, { _id: 'sent', count: 1 }])
      .mockResolvedValueOnce([{ _id: 'failed', count: 1 }]);
    EmailLog.findOne.mockReturnValue(buildQuery({ sentAt: new Date() }));

    const health = await getEmailHealth();

    expect(health.warnings.some((w) => w.code === 'email_failures_increasing')).toBe(true);
  });
});

describe('getJobFreshnessHealth', () => {
  test('reuses a caller-supplied backlog instead of re-querying it', async () => {
    Job.countDocuments.mockResolvedValue(0);
    await getJobFreshnessHealth({ pendingBacklog: { count: 9, oldestPendingAgeMs: 123 }, versionBacklog: 4, failingBoards: [] });

    expect(getPendingMatchBacklog).not.toHaveBeenCalled();
    expect(getMatcherVersionBacklog).not.toHaveBeenCalled();
  });

  test('distinguishes active/closed/expired counts via separate bounded counts', async () => {
    Job.countDocuments.mockResolvedValueOnce(50) // active
      .mockResolvedValueOnce(10) // closed
      .mockResolvedValueOnce(5)  // expired
      .mockResolvedValueOnce(2); // recentlyExpired24h

    const health = await getJobFreshnessHealth({ pendingBacklog: { count: 0, oldestPendingAgeMs: null }, versionBacklog: 0, failingBoards: [] });

    expect(health).toEqual(expect.objectContaining({ active: 50, closed: 10, expired: 5, recentlyExpired24h: 2 }));
  });
});

describe('getOperationalOverview', () => {
  test('computes the shared backlog queries once, not once per domain', async () => {
    FetchRun.find.mockReturnValue(buildQuery([]));
    MatchRun.findOne.mockReturnValue(buildQuery(null));
    EmailLog.aggregate.mockResolvedValue([]);
    EmailLog.findOne.mockReturnValue(buildQuery(null));
    Job.countDocuments.mockResolvedValue(0);

    await getOperationalOverview();

    expect(getPendingMatchBacklog).toHaveBeenCalledTimes(1);
    expect(getMatcherVersionBacklog).toHaveBeenCalledTimes(1);
  });

  test('missing historical data across every domain reports unknown, not a false "ok"', async () => {
    FetchRun.find.mockReturnValue(buildQuery([]));
    MatchRun.findOne.mockReturnValue(buildQuery(null));
    EmailLog.aggregate.mockResolvedValue([]);
    EmailLog.findOne.mockReturnValue(buildQuery(null));
    Job.countDocuments.mockResolvedValue(0);

    const overview = await getOperationalOverview();

    expect(overview.fetch.status).toBe('unknown');
    expect(overview.fetch.indicator).toBe('warning'); // unknown is surfaced as needing attention, never 'ok'
    expect(overview.match.status).toBe('unknown');
    expect(overview.match.indicator).toBe('warning');
  });

  test('a failed match run surfaces an error-level indicator at the overview level', async () => {
    FetchRun.find.mockReturnValue(buildQuery([{ createdAt: new Date(), outcome: 'success', sources: [], durationMs: 100 }]));
    MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'failed', createdAt: new Date(), created: 0, updated: 0, errorCount: 0, pendingMarkedProcessed: false }));
    EmailLog.aggregate.mockResolvedValue([]);
    EmailLog.findOne.mockReturnValue(buildQuery(null));
    Job.countDocuments.mockResolvedValue(0);

    const overview = await getOperationalOverview();

    expect(overview.match.indicator).toBe('error');
  });
});
