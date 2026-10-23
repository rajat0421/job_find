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
  PENDING_BATCH_SIZE: 200,
  VERSION_SWEEP_BATCH_SIZE: 300,
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

  // Monitoring correction: RECENT_FETCH_RUNS_WINDOW (24) caps how far back
  // this query ever looks, so a streak that reaches exactly 24 is a floor,
  // not an exact count — there may be more failures, or an earlier success,
  // beyond what this query ever sees.
  describe('consecutiveFailuresCapped (monitoring correction)', () => {
    test('is true when the streak exactly fills the full inspected window', async () => {
      const runs = Array.from({ length: 24 }, (_, i) => ({
        createdAt: new Date(24 - i), outcome: 'partial', sources: [{ name: 'Greenhouse', outcome: 'partial' }],
      }));
      FetchRun.find.mockReturnValue(buildQuery(runs));

      const health = await getFetchHealth();

      const gh = health.providers.find((p) => p.name === 'Greenhouse');
      expect(gh.consecutiveFailures).toBe(24);
      expect(gh.consecutiveFailuresCapped).toBe(true);
      expect(gh.lastSuccessAt).toBeNull();
      expect(health.warnings.find((w) => w.code === 'fetch_provider_failing').message).toMatch(/24\+/);
    });

    test('is false when fewer total runs exist than the window — the streak IS the complete history, not a truncated view', async () => {
      const runs = [
        { createdAt: new Date(2), outcome: 'partial', sources: [{ name: 'Greenhouse', outcome: 'partial' }] },
        { createdAt: new Date(1), outcome: 'partial', sources: [{ name: 'Greenhouse', outcome: 'partial' }] },
      ];
      FetchRun.find.mockReturnValue(buildQuery(runs));

      const health = await getFetchHealth();

      const gh = health.providers.find((p) => p.name === 'Greenhouse');
      expect(gh.consecutiveFailures).toBe(2);
      expect(gh.consecutiveFailuresCapped).toBe(false); // this really is "never, in all recorded history"
    });

    test('is false when the streak is below the window even though 24 runs exist', async () => {
      const runs = [
        { createdAt: new Date(3), outcome: 'partial', sources: [{ name: 'Greenhouse', outcome: 'partial' }] },
        { createdAt: new Date(2), outcome: 'success', sources: [{ name: 'Greenhouse', outcome: 'success' }] },
        ...Array.from({ length: 22 }, (_, i) => ({ createdAt: new Date(1 - i), outcome: 'partial', sources: [{ name: 'Greenhouse', outcome: 'partial' }] })),
      ];
      FetchRun.find.mockReturnValue(buildQuery(runs));

      const health = await getFetchHealth();

      const gh = health.providers.find((p) => p.name === 'Greenhouse');
      expect(gh.consecutiveFailures).toBe(1);
      expect(gh.consecutiveFailuresCapped).toBe(false);
    });
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

  // Monitoring correction: the dashboard previously had no way to show "when
  // did the pipeline last definitely work" independent of whatever the MOST
  // RECENT attempt's outcome happens to be — if the latest few ticks are
  // 'partial'/'failed', this is the only field that still answers "but when
  // did it last actually succeed".
  describe('lastSuccessfulRunAt (monitoring correction)', () => {
    test('is populated from the most recent run with outcome:success, even when the latest run is degraded', async () => {
      const lastSuccess = new Date(Date.now() - 5 * 60 * 60 * 1000);
      MatchRun.findOne
        .mockReturnValueOnce(buildQuery({ outcome: 'failed', createdAt: new Date(), created: 0, updated: 0, errorCount: 2, pendingMarkedProcessed: false }))
        .mockReturnValueOnce(buildQuery({ outcome: 'success', createdAt: lastSuccess }));

      const health = await getMatchHealth();

      expect(health.status).toBe('failed'); // the latest attempt's own outcome is untouched
      expect(health.lastSuccessfulRunAt).toEqual(lastSuccess);
    });

    test('is null when no run has ever succeeded', async () => {
      MatchRun.findOne
        .mockReturnValueOnce(buildQuery({ outcome: 'failed', createdAt: new Date(), created: 0, updated: 0, errorCount: 2, pendingMarkedProcessed: false }))
        .mockReturnValueOnce(buildQuery(null));

      const health = await getMatchHealth();

      expect(health.lastSuccessfulRunAt).toBeNull();
    });

    test('is still reported even when no run has been recorded at all (the "unknown" branch)', async () => {
      MatchRun.findOne
        .mockReturnValueOnce(buildQuery(null))
        .mockReturnValueOnce(buildQuery(null));

      const health = await getMatchHealth();

      expect(health.status).toBe('unknown');
      expect(health.lastSuccessfulRunAt).toBeNull();
    });
  });

  // Monitoring correction: present an ideal, best-case drain estimate
  // alongside the raw backlog counts, clearly labeled as an assumption-laden
  // estimate — never something that could be mistaken for proof of actual
  // progress.
  describe('idealDrainEstimate (monitoring correction)', () => {
    beforeEach(() => {
      MatchRun.findOne.mockReturnValue(buildQuery({ outcome: 'success', createdAt: new Date(), created: 0, updated: 0, errorCount: 0, pendingMarkedProcessed: true }));
    });

    test('computes hours as backlog-size / batch-size, rounded up', async () => {
      const health = await getMatchHealth({ pendingBacklog: { count: 450, oldestPendingAgeMs: null }, versionBacklog: 700 });

      expect(health.idealDrainEstimate.pendingBacklogHours).toBe(3); // 450 / 200 = 2.25 -> 3
      expect(health.idealDrainEstimate.versionBacklogHours).toBe(3); // 700 / 300 = 2.33 -> 3
      expect(health.idealDrainEstimate.assumptions).toMatch(/best case|assumes/i);
    });

    test('is zero for an empty backlog, not a misleading non-zero minimum', async () => {
      const health = await getMatchHealth({ pendingBacklog: { count: 0, oldestPendingAgeMs: null }, versionBacklog: 0 });

      expect(health.idealDrainEstimate.pendingBacklogHours).toBe(0);
      expect(health.idealDrainEstimate.versionBacklogHours).toBe(0);
    });
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

  // Monitoring correction: zero EmailLog rows in the last 24h previously
  // defaulted to 'success' (last24h.failed === 0 is vacuously true when
  // NOTHING happened), making "the pipeline hasn't run" indistinguishable
  // from "it ran and everything succeeded".
  describe('no_activity status (monitoring correction)', () => {
    test('reports no_activity, not success, when the 24h window has zero events of any kind', async () => {
      EmailLog.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      EmailLog.findOne.mockReturnValue(buildQuery(null));

      const health = await getEmailHealth();

      expect(health.status).toBe('no_activity');
      expect(health.last24h).toEqual({ sent: 0, skipped: 0, failed: 0 });
    });

    test('reports success (not no_activity) when the window has only skips — that IS real activity', async () => {
      EmailLog.aggregate.mockResolvedValueOnce([{ _id: 'skipped', count: 4 }]).mockResolvedValueOnce([]);
      EmailLog.findOne.mockReturnValue(buildQuery({ sentAt: new Date() }));

      const health = await getEmailHealth();

      expect(health.status).toBe('success');
    });

    test('a no_activity status still surfaces the no-recent-success warning, so the overview indicator reads as a warning, not ok', async () => {
      const { getOperationalOverview } = require('../monitoring.service');
      FetchRun.find.mockReturnValue(buildQuery([]));
      MatchRun.findOne.mockReturnValue(buildQuery(null));
      EmailLog.aggregate.mockResolvedValue([]);
      EmailLog.findOne.mockReturnValue(buildQuery(null));
      Job.countDocuments.mockResolvedValue(0);

      const overview = await getOperationalOverview();

      expect(overview.email.status).toBe('no_activity');
      expect(overview.email.indicator).toBe('warning');
    });
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
