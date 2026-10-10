// Production observability (Improvement 6). Pure read-side aggregation over
// data the pipelines already record (FetchRun, MatchRun, EmailLog, Job,
// UserJob) — this file introduces no new write paths and changes no existing
// behavior. Every query here is either a bounded `.limit(...)` scan or a
// count/findOne that an existing index covers (documented inline).
const FetchRun = require('../models/FetchRun');
const MatchRun = require('../models/MatchRun');
const EmailLog = require('../models/EmailLog');
const Job = require('../models/Job');
const { getPendingMatchBacklog, getMatcherVersionBacklog } = require('./jobMatcher.service');

// ── Documented, configurable warning thresholds ─────────────────────────────
// All are soft, dashboard/log-level signals only — nothing here blocks a
// pipeline, retries a job early, or pages anyone. Each has an env override so
// it can be tuned without a code change; defaults are picked relative to this
// app's actual cadences (hourly fetch/match, hourly-or-slower email).
const THRESHOLDS = {
  // A provider/board failing this many consecutive recent fetch runs in a row
  // is flagged — short enough to catch a real outage, long enough to ignore
  // one transient blip.
  FETCH_CONSECUTIVE_FAILURES: Number(process.env.MONITOR_FETCH_FAIL_STREAK) || 2,
  // Fetch runs hourly; flag a run that took long enough to start crowding the
  // next cycle.
  FETCH_DURATION_WARN_MS: Number(process.env.MONITOR_FETCH_DURATION_WARN_MS) || 45 * 60 * 1000,
  // A pending job waiting longer than this for its first match pass.
  MATCH_PENDING_AGE_WARN_MS: Number(process.env.MONITOR_MATCH_PENDING_AGE_WARN_MS) || 6 * 60 * 60 * 1000,
  // Matcher-version backlog size at which it's worth a dashboard warning —
  // this only grows right after a MATCHER_VERSION bump and should drain every
  // tick, so a large *and growing* number is the signal, not size alone.
  MATCH_VERSION_BACKLOG_WARN: Number(process.env.MONITOR_MATCH_VERSION_BACKLOG_WARN) || 500,
  // No successfully delivered digest at all in this long is worth a look —
  // generous enough to tolerate a quiet period with no due users.
  EMAIL_NO_SUCCESS_WARN_MS: Number(process.env.MONITOR_EMAIL_NO_SUCCESS_WARN_MS) || 24 * 60 * 60 * 1000,
  // Fetch runs hourly (`0 * * * *`). If the MOST RECENT FetchRun is older
  // than this, the pipeline may not be executing at all (scheduler crashed,
  // process never restarted, cron silently stopped firing) — a fundamentally
  // different failure mode than "the last run failed", which the stored
  // `outcome` field can never reveal on its own, since outcome only
  // describes what happened the last time something actually ran. 3h
  // tolerates one missed tick without a false alarm.
  FETCH_STALE_WARN_MS: Number(process.env.MONITOR_FETCH_STALE_WARN_MS) || 3 * 60 * 60 * 1000,
  // Match runs hourly at :15 — same reasoning as FETCH_STALE_WARN_MS.
  MATCH_STALE_WARN_MS: Number(process.env.MONITOR_MATCH_STALE_WARN_MS) || 3 * 60 * 60 * 1000,
};

// How many recent FetchRun documents to inspect for streak calculations.
// Bounded on purpose — this is never a full collection scan, and 24 hourly
// runs is more than enough to detect a real consecutive-failure streak.
const RECENT_FETCH_RUNS_WINDOW = 24;

// Walks `runs` (already sorted newest-first) counting how many of the leading
// (most recent) entries are non-success for whatever `getOutcome` extracts —
// i.e. a true streak counting backwards from "now", not a lifetime total. A
// run where this name/provider wasn't even present (`undefined`) is skipped
// without breaking the streak — e.g. a board temporarily removed from the
// company list shouldn't look like a failure streak.
const consecutiveNonSuccess = (runs, getOutcome) => {
  let streak = 0;
  for (const run of runs) {
    const outcome = getOutcome(run);
    if (outcome === undefined) continue;
    if (outcome === 'success') break;
    streak += 1;
  }
  return streak;
};

// Provider boards (Greenhouse/Lever/Ashby company tokens) that failed in the
// most recent run(s) in a row. Reuses FetchRun.sources[].failures[] entirely —
// no new schema. A board only ever appears here once it's actually failed at
// least once in the window; "not attempted"/"succeeded" are indistinguishable
// from the stored data alone (see Improvement 6's report), so the streak is
// conservative: it resets the moment a board stops appearing in `failures[]`,
// whether that's because it succeeded or wasn't attempted that run.
const getFailingBoards = async () => {
  const recentRuns = await FetchRun.find().sort({ createdAt: -1 }).limit(RECENT_FETCH_RUNS_WINDOW)
    .select('sources createdAt').lean();

  const everFailedNames = new Set();
  recentRuns.forEach((r) => (r.sources || []).forEach((s) => (s.failures || []).forEach((f) => everFailedNames.add(f.name))));

  const boards = [...everFailedNames].map((name) => {
    let streak = 0;
    for (const run of recentRuns) {
      const failedThisRun = (run.sources || []).some((s) => (s.failures || []).some((f) => f.name === name));
      if (!failedThisRun) break;
      streak += 1;
    }
    const lastFailedRun = recentRuns.find((r) => (r.sources || []).some((s) => (s.failures || []).some((f) => f.name === name)));
    const lastReason = lastFailedRun?.sources
      .flatMap((s) => s.failures || [])
      .find((f) => f.name === name)?.reason || null;
    return { name, consecutiveFailures: streak, lastReason, lastFailedAt: lastFailedRun?.createdAt || null };
  });

  return boards
    .filter((b) => b.consecutiveFailures >= THRESHOLDS.FETCH_CONSECUTIVE_FAILURES)
    .sort((a, b) => b.consecutiveFailures - a.consecutiveFailures);
};

// Fetch monitoring (Section 1). `status` is always the stored FetchRun.outcome
// field, never inferred from totalAdded — a healthy run that finds zero new
// jobs looks identical, in outcome terms, to any other successful run.
const getFetchHealth = async () => {
  const recentRuns = await FetchRun.find().sort({ createdAt: -1 }).limit(RECENT_FETCH_RUNS_WINDOW).lean();
  if (!recentRuns.length) {
    return { status: 'unknown', message: 'No fetch runs recorded yet', lastRunAt: null, providers: [], failingBoards: [], warnings: [] };
  }

  const latest = recentRuns[0];
  const providerNames = [...new Set(recentRuns.flatMap((r) => (r.sources || []).map((s) => s.name)))];

  const providers = providerNames.map((name) => {
    const lastSuccessRun = recentRuns.find((r) => (r.sources || []).some((s) => s.name === name && s.outcome === 'success'));
    const latestSource = (latest.sources || []).find((s) => s.name === name);
    return {
      name,
      latestOutcome: latestSource?.outcome || 'unknown',
      lastSuccessAt: lastSuccessRun?.createdAt || null,
      consecutiveFailures: consecutiveNonSuccess(recentRuns, (r) => (r.sources || []).find((s) => s.name === name)?.outcome),
      aborted: latestSource?.aborted || false,
      budgetExceeded: latestSource?.budgetExceeded || null,
    };
  });

  const failingBoards = await getFailingBoards();
  const degraded = providers.filter((p) => p.consecutiveFailures >= THRESHOLDS.FETCH_CONSECUTIVE_FAILURES);

  // Audit finding (Improvement 9): previously nothing compared "when did the
  // fetch pipeline last actually run" against "how long ago is too long" — a
  // dead scheduler would keep showing whatever `outcome` its last real run
  // happened to have (often 'success'), forever, with no warning at all.
  const ageMs = Date.now() - new Date(latest.createdAt).getTime();
  const stale = ageMs >= THRESHOLDS.FETCH_STALE_WARN_MS;

  const warnings = [];
  if (stale) {
    warnings.push({
      code: 'fetch_stale',
      severity: 'warning',
      message: `Most recent fetch run was ${Math.round(ageMs / 3600000)}h ago — the fetch pipeline may not be running`,
    });
  }
  if (degraded.length) {
    warnings.push({
      code: 'fetch_provider_failing',
      severity: 'warning',
      message: `${degraded.map((p) => p.name).join(', ')} failing ${THRESHOLDS.FETCH_CONSECUTIVE_FAILURES}+ run(s) in a row`,
    });
  }
  if ((latest.durationMs || 0) >= THRESHOLDS.FETCH_DURATION_WARN_MS) {
    warnings.push({
      code: 'fetch_duration_high',
      severity: 'warning',
      message: `Last fetch took ${Math.round(latest.durationMs / 60000)}m, approaching the hourly cycle budget`,
    });
  }
  if (failingBoards.length) {
    warnings.push({
      code: 'fetch_boards_failing',
      severity: 'warning',
      message: `${failingBoards.length} board(s) failing ${THRESHOLDS.FETCH_CONSECUTIVE_FAILURES}+ fetch(es) in a row: ${failingBoards.slice(0, 5).map((b) => b.name).join(', ')}`,
    });
  }

  return {
    status: latest.outcome,
    stale,
    lastRunAt: latest.createdAt,
    startedAt: latest.startedAt,
    finishedAt: latest.finishedAt,
    durationMs: latest.durationMs,
    totalFetched: latest.totalFetched,
    totalAdded: latest.totalAdded,
    totalUpdated: latest.totalUpdated || 0,
    errorSummary: latest.errorSummary || [],
    providers,
    failingBoards,
    warnings,
  };
};

// Matching monitoring (Section 2). `pendingBacklog`/`versionBacklog` can be
// supplied by a caller that already computed them this request (e.g.
// getOperationalOverview) to avoid running the same bounded query twice.
const getMatchHealth = async ({ pendingBacklog, versionBacklog } = {}) => {
  const [latestRun, resolvedPendingBacklog, resolvedVersionBacklog] = await Promise.all([
    MatchRun.findOne().sort({ createdAt: -1 }).lean(),
    pendingBacklog ?? getPendingMatchBacklog(),
    versionBacklog ?? getMatcherVersionBacklog(),
  ]);

  const warnings = [];
  if (resolvedPendingBacklog.oldestPendingAgeMs !== null && resolvedPendingBacklog.oldestPendingAgeMs >= THRESHOLDS.MATCH_PENDING_AGE_WARN_MS) {
    warnings.push({
      code: 'match_pending_stale',
      severity: 'warning',
      message: `Oldest job awaiting matching has waited ${Math.round(resolvedPendingBacklog.oldestPendingAgeMs / 3600000)}h`,
    });
  }
  if (resolvedVersionBacklog >= THRESHOLDS.MATCH_VERSION_BACKLOG_WARN) {
    warnings.push({
      code: 'match_version_backlog_high',
      severity: 'warning',
      message: `${resolvedVersionBacklog} UserJob record(s) still awaiting the current matcher version`,
    });
  }

  if (!latestRun) {
    return { status: 'unknown', message: 'No match runs recorded yet', pendingBacklog: resolvedPendingBacklog, versionBacklog: resolvedVersionBacklog, warnings };
  }

  if (latestRun.outcome === 'failed') {
    warnings.push({ code: 'match_run_failed', severity: 'error', message: 'Most recent match run failed' });
  }

  // Same audit finding as getFetchHealth: a dead match cron would otherwise
  // keep showing its last real outcome (often 'success') forever, with
  // nothing distinguishing "healthy and current" from "stopped running
  // hours ago".
  const ageMs = Date.now() - new Date(latestRun.createdAt).getTime();
  const stale = ageMs >= THRESHOLDS.MATCH_STALE_WARN_MS;
  if (stale) {
    warnings.push({
      code: 'match_stale',
      severity: 'warning',
      message: `Most recent match run was ${Math.round(ageMs / 3600000)}h ago — the matching pipeline may not be running`,
    });
  }

  return {
    status: latestRun.outcome,
    stale,
    lastRunAt: latestRun.createdAt,
    startedAt: latestRun.startedAt,
    finishedAt: latestRun.finishedAt,
    durationMs: latestRun.durationMs,
    usersConsidered: latestRun.usersConsidered,
    recentJobsConsidered: latestRun.recentJobsConsidered,
    pendingJobsConsidered: latestRun.pendingJobsConsidered,
    created: latestRun.created,
    updated: latestRun.updated,
    errors: latestRun.errorCount,
    pendingMarkedProcessed: latestRun.pendingMarkedProcessed,
    versionRescoredLastRun: latestRun.versionRescored,
    errorSummary: latestRun.errorSummary || [],
    pendingBacklog: resolvedPendingBacklog,
    versionBacklog: resolvedVersionBacklog,
    warnings,
  };
};

// Email monitoring (Section 3). Reuses EmailLog entirely — every due user
// already gets exactly one EmailLog entry per tick (sent/skipped/failed), so
// this is pure aggregation, no new write path. `status` summarizes the
// window, it is not a per-user guarantee — the counts alongside it are what
// actually distinguish sent/skipped/failed (never conflated with each other).
const getEmailHealth = async () => {
  const now = Date.now();
  const window24hStart = new Date(now - 24 * 60 * 60 * 1000);
  const prevWindow24hStart = new Date(now - 48 * 60 * 60 * 1000);

  const [last24hAgg, prev24hAgg, lastSuccess] = await Promise.all([
    EmailLog.aggregate([{ $match: { sentAt: { $gte: window24hStart } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    EmailLog.aggregate([{ $match: { sentAt: { $gte: prevWindow24hStart, $lt: window24hStart } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    EmailLog.findOne({ status: 'sent' }).sort({ sentAt: -1 }).lean(),
  ]);

  const asCounts = (arr) => arr.reduce((acc, x) => ({ ...acc, [x._id]: x.count }), { sent: 0, skipped: 0, failed: 0 });
  const last24h = asCounts(last24hAgg);
  const previous24h = asCounts(prev24hAgg);

  const warnings = [];
  const noRecentSuccess = !lastSuccess || (now - new Date(lastSuccess.sentAt).getTime()) >= THRESHOLDS.EMAIL_NO_SUCCESS_WARN_MS;
  if (noRecentSuccess) {
    warnings.push({
      code: 'email_no_recent_success',
      severity: 'warning',
      message: lastSuccess ? `No successful delivery since ${lastSuccess.sentAt.toISOString()}` : 'No successful delivery recorded yet',
    });
  }
  if (last24h.failed > 0 && last24h.failed > previous24h.failed) {
    warnings.push({
      code: 'email_failures_increasing',
      severity: 'warning',
      message: `Failed deliveries rose from ${previous24h.failed} to ${last24h.failed} over the last 24h`,
    });
  }

  return {
    // Summarizes the 24h window only — 'failed' means at least one delivery
    // failed and none succeeded; 'partial' means a mix; 'success' means no
    // failures (which includes "nothing was due" — not the same as "sent").
    status: last24h.failed > 0 ? (last24h.sent > 0 ? 'partial' : 'failed') : 'success',
    last24h,
    previous24h,
    lastSuccessAt: lastSuccess?.sentAt || null,
    warnings,
  };
};

// Job freshness/lifecycle monitoring (Section 4).
const getJobFreshnessHealth = async ({ pendingBacklog, versionBacklog, failingBoards } = {}) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [active, closed, expired, recentlyExpired24h, resolvedPendingBacklog, resolvedVersionBacklog, resolvedFailingBoards] = await Promise.all([
    Job.countDocuments({ status: 'active' }),
    Job.countDocuments({ status: 'closed' }),
    Job.countDocuments({ status: 'expired' }),
    // Covered by the existing {status,lastSeenAt} index's status prefix —
    // `updatedAt` is the best available signal for "transitioned recently"
    // since there's no dedicated expiredAt timestamp (see Improvement 6's
    // report for this limitation).
    Job.countDocuments({ status: 'expired', updatedAt: { $gte: dayAgo } }),
    pendingBacklog ?? getPendingMatchBacklog(),
    versionBacklog ?? getMatcherVersionBacklog(),
    failingBoards ?? getFailingBoards(),
  ]);

  return {
    active,
    closed,
    expired,
    recentlyExpired24h,
    needsMatching: resolvedPendingBacklog.count,
    oldestPendingAgeMs: resolvedPendingBacklog.oldestPendingAgeMs,
    matcherVersionBacklog: resolvedVersionBacklog,
    failingBoards: resolvedFailingBoards,
  };
};

// Section 5's "concise operational overview" — combines the four domains plus
// a neutral success/warning/error indicator per domain so the dashboard can
// render a status pill without re-deriving the logic itself.
const indicatorFor = (status, warnings = []) => {
  if (status === 'failed' || warnings.some((w) => w.severity === 'error')) return 'error';
  if (status === 'partial' || status === 'unknown' || warnings.length) return 'warning';
  return 'ok';
};

const getOperationalOverview = async () => {
  const [pendingBacklog, versionBacklog, failingBoards] = await Promise.all([
    getPendingMatchBacklog(),
    getMatcherVersionBacklog(),
    getFailingBoards(),
  ]);

  const [fetch, match, email, jobs] = await Promise.all([
    getFetchHealth(),
    getMatchHealth({ pendingBacklog, versionBacklog }),
    getEmailHealth(),
    getJobFreshnessHealth({ pendingBacklog, versionBacklog, failingBoards }),
  ]);

  return {
    fetch: { ...fetch, indicator: indicatorFor(fetch.status, fetch.warnings) },
    match: { ...match, indicator: indicatorFor(match.status, match.warnings) },
    email: { ...email, indicator: indicatorFor(email.status, email.warnings) },
    jobs,
    warnings: [...fetch.warnings, ...match.warnings, ...email.warnings],
    generatedAt: new Date(),
  };
};

module.exports = {
  THRESHOLDS,
  getFetchHealth,
  getMatchHealth,
  getEmailHealth,
  getJobFreshnessHealth,
  getFailingBoards,
  getOperationalOverview,
};
