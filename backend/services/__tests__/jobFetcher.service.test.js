jest.mock('../../platforms/adzuna');
jest.mock('../../platforms/greenhouse');
jest.mock('../../platforms/lever');
jest.mock('../../platforms/ashby');
jest.mock('../../models/FetchRun', () => ({ create: jest.fn().mockResolvedValue({}) }));
jest.mock('../../services/fetchBudget.service', () => ({ createCycleDeadline: jest.fn() }));

const adzuna = require('../../platforms/adzuna');
const greenhouse = require('../../platforms/greenhouse');
const lever = require('../../platforms/lever');
const ashby = require('../../platforms/ashby');
const FetchRun = require('../../models/FetchRun');
const { createCycleDeadline } = require('../../services/fetchBudget.service');
const { fetchAdzunaJobs } = require('../jobFetcher.service');

const ok = (added = 1, fetched = 1) => ({ added, fetched, requestsAttempted: 1, requestsFailed: 0, retries: 0, companiesFailed: [] });
const totalFailure = () => ({ added: 0, fetched: 0, requestsAttempted: 3, requestsFailed: 3, retries: 2, companiesFailed: [{ name: 'a', reason: 'timeout' }, { name: 'b', reason: 'timeout' }, { name: 'c', reason: 'timeout' }] });
const partialFailure = () => ({ added: 1, fetched: 2, requestsAttempted: 3, requestsFailed: 1, retries: 1, companiesFailed: [{ name: 'a', reason: 'not_found' }] });
const budgetCutShortButHealthy = () => ({
  added: 1, fetched: 1, requestsAttempted: 1, requestsFailed: 0, retries: 0,
  companiesFailed: [], companiesSkipped: [{ name: 'later-co', reason: 'provider_budget_exceeded' }], budgetExceeded: 'provider',
});

// A never-expiring deadline by default, so existing tests above are unaffected by budget logic.
beforeEach(() => {
  jest.clearAllMocks();
  createCycleDeadline.mockReturnValue({ expired: () => false, remainingMs: () => 999999 });
});

test("one provider's failure does not prevent the others from being attempted", async () => {
  adzuna.fetchJobs.mockRejectedValue(new Error('Adzuna crashed'));
  greenhouse.fetchJobs.mockResolvedValue(ok());
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockResolvedValue(ok());

  await fetchAdzunaJobs();

  expect(greenhouse.fetchJobs).toHaveBeenCalledTimes(1);
  expect(lever.fetchJobs).toHaveBeenCalledTimes(1);
  expect(ashby.fetchJobs).toHaveBeenCalledTimes(1);
});

test('all four providers are always attempted regardless of order of failure', async () => {
  adzuna.fetchJobs.mockResolvedValue(ok());
  greenhouse.fetchJobs.mockRejectedValue(new Error('timeout'));
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockRejectedValue(new Error('timeout'));

  await fetchAdzunaJobs();

  expect(adzuna.fetchJobs).toHaveBeenCalledTimes(1);
  expect(greenhouse.fetchJobs).toHaveBeenCalledTimes(1);
  expect(lever.fetchJobs).toHaveBeenCalledTimes(1);
  expect(ashby.fetchJobs).toHaveBeenCalledTimes(1);
});

test('all providers succeeding is reported as a success outcome', async () => {
  adzuna.fetchJobs.mockResolvedValue(ok());
  greenhouse.fetchJobs.mockResolvedValue(ok());
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockResolvedValue(ok());

  const result = await fetchAdzunaJobs();

  expect(result.outcome).toBe('success');
  const saved = FetchRun.create.mock.calls[0][0];
  expect(saved.outcome).toBe('success');
  expect(saved.sources.every((s) => s.outcome === 'success')).toBe(true);
});

test('one provider totally failing (all its requests failed) is reported as partial, not success', async () => {
  adzuna.fetchJobs.mockResolvedValue(totalFailure());
  greenhouse.fetchJobs.mockResolvedValue(ok());
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockResolvedValue(ok());

  const result = await fetchAdzunaJobs();

  expect(result.outcome).toBe('partial');
  const saved = FetchRun.create.mock.calls[0][0];
  const adzunaSource = saved.sources.find((s) => s.name === 'Adzuna');
  expect(adzunaSource.outcome).toBe('failed');
  expect(saved.errorSummary.length).toBeGreaterThan(0);
});

test('a provider with some failures but some success is reported as partial', async () => {
  adzuna.fetchJobs.mockResolvedValue(partialFailure());
  greenhouse.fetchJobs.mockResolvedValue(ok());
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockResolvedValue(ok());

  const result = await fetchAdzunaJobs();

  const adzunaSource = FetchRun.create.mock.calls[0][0].sources.find((s) => s.name === 'Adzuna');
  expect(adzunaSource.outcome).toBe('partial');
  expect(result.outcome).toBe('partial');
});

test('every provider failing is reported as a clear failure, never mistaken for a quiet success', async () => {
  adzuna.fetchJobs.mockRejectedValue(new Error('down'));
  greenhouse.fetchJobs.mockRejectedValue(new Error('down'));
  lever.fetchJobs.mockRejectedValue(new Error('down'));
  ashby.fetchJobs.mockRejectedValue(new Error('down'));

  const result = await fetchAdzunaJobs();

  expect(result.outcome).toBe('failed');
  expect(result.totalFetched).toBe(0);
  expect(result.totalAdded).toBe(0);
  const saved = FetchRun.create.mock.calls[0][0];
  expect(saved.outcome).toBe('failed');
  expect(saved.errorSummary.length).toBe(4);
});

test('FetchRun records start/finish times and a per-source breakdown', async () => {
  adzuna.fetchJobs.mockResolvedValue(ok(5, 10));
  greenhouse.fetchJobs.mockResolvedValue(ok());
  lever.fetchJobs.mockResolvedValue(ok());
  ashby.fetchJobs.mockResolvedValue(ok());

  await fetchAdzunaJobs();

  const saved = FetchRun.create.mock.calls[0][0];
  expect(saved.startedAt).toBeInstanceOf(Date);
  expect(saved.finishedAt).toBeInstanceOf(Date);
  expect(saved.totalFetched).toBe(13); // 10 + 1 + 1 + 1
  expect(saved.totalAdded).toBe(8); // 5 + 1 + 1 + 1
});

describe('time-budget integration', () => {
  test('one provider hitting its own budget does not stop the remaining providers from being attempted', async () => {
    adzuna.fetchJobs.mockResolvedValue(budgetCutShortButHealthy());
    greenhouse.fetchJobs.mockResolvedValue(ok());
    lever.fetchJobs.mockResolvedValue(ok());
    ashby.fetchJobs.mockResolvedValue(ok());

    await fetchAdzunaJobs();

    expect(greenhouse.fetchJobs).toHaveBeenCalledTimes(1);
    expect(lever.fetchJobs).toHaveBeenCalledTimes(1);
    expect(ashby.fetchJobs).toHaveBeenCalledTimes(1);
  });

  test('a provider cut short by its own budget, with no actual failures, is reported as partial — never a plain success', async () => {
    adzuna.fetchJobs.mockResolvedValue(budgetCutShortButHealthy());
    greenhouse.fetchJobs.mockResolvedValue(ok());
    lever.fetchJobs.mockResolvedValue(ok());
    ashby.fetchJobs.mockResolvedValue(ok());

    await fetchAdzunaJobs();

    const saved = FetchRun.create.mock.calls[0][0];
    const adzunaSource = saved.sources.find((s) => s.name === 'Adzuna');
    expect(adzunaSource.outcome).toBe('partial');
    expect(adzunaSource.budgetExceeded).toBe('provider');
    expect(adzunaSource.skipped).toEqual([{ name: 'later-co', reason: 'provider_budget_exceeded' }]);
    expect(saved.outcome).toBe('partial');
  });

  test('each provider is handed the shared cycle deadline', async () => {
    adzuna.fetchJobs.mockResolvedValue(ok());
    greenhouse.fetchJobs.mockResolvedValue(ok());
    lever.fetchJobs.mockResolvedValue(ok());
    ashby.fetchJobs.mockResolvedValue(ok());
    const deadline = { expired: () => false, remainingMs: () => 999999 };
    createCycleDeadline.mockReturnValue(deadline);

    await fetchAdzunaJobs();

    expect(adzuna.fetchJobs).toHaveBeenCalledWith({ cycleDeadline: deadline });
    expect(greenhouse.fetchJobs).toHaveBeenCalledWith({ cycleDeadline: deadline });
    expect(lever.fetchJobs).toHaveBeenCalledWith({ cycleDeadline: deadline });
    expect(ashby.fetchJobs).toHaveBeenCalledWith({ cycleDeadline: deadline });
  });

  test('once the overall cycle budget expires mid-run, no further providers are even started', async () => {
    let expired = false;
    createCycleDeadline.mockReturnValue({ expired: () => expired, remainingMs: () => (expired ? 0 : 999999) });
    adzuna.fetchJobs.mockImplementation(async () => {
      expired = true; // flips only once Adzuna has actually run
      return ok();
    });
    greenhouse.fetchJobs.mockResolvedValue(ok());
    lever.fetchJobs.mockResolvedValue(ok());
    ashby.fetchJobs.mockResolvedValue(ok());

    const result = await fetchAdzunaJobs();

    expect(adzuna.fetchJobs).toHaveBeenCalledTimes(1);
    expect(greenhouse.fetchJobs).not.toHaveBeenCalled();
    expect(lever.fetchJobs).not.toHaveBeenCalled();
    expect(ashby.fetchJobs).not.toHaveBeenCalled();

    const saved = FetchRun.create.mock.calls[0][0];
    const gh = saved.sources.find((s) => s.name === 'Greenhouse');
    expect(gh.outcome).toBe('failed'); // skipped entirely is never a quiet success
    expect(gh.budgetExceeded).toBe('cycle');
    expect(gh.requestsAttempted).toBe(0);
    expect(result.outcome).toBe('partial'); // Adzuna itself still succeeded
  });

  test('a cycle-budget-triggered skip is clearly distinguished from a legitimate empty success in the error summary', async () => {
    let expired = false;
    createCycleDeadline.mockReturnValue({ expired: () => expired, remainingMs: () => (expired ? 0 : 999999) });
    adzuna.fetchJobs.mockImplementation(async () => {
      expired = true;
      return ok(0, 0); // legitimately found nothing new, but succeeded
    });
    greenhouse.fetchJobs.mockResolvedValue(ok());
    lever.fetchJobs.mockResolvedValue(ok());
    ashby.fetchJobs.mockResolvedValue(ok());

    await fetchAdzunaJobs();

    const saved = FetchRun.create.mock.calls[0][0];
    const adzunaSource = saved.sources.find((s) => s.name === 'Adzuna');
    const ghSource = saved.sources.find((s) => s.name === 'Greenhouse');
    expect(adzunaSource.outcome).toBe('success'); // genuinely ran fine, zero new jobs
    expect(ghSource.outcome).toBe('failed'); // never ran at all — not the same thing
    expect(saved.errorSummary.some((line) => line.includes('Greenhouse') && line.includes('budget'))).toBe(true);
  });
});
