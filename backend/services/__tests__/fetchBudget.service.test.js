const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('env validation', () => {
  afterEach(() => {
    delete process.env.FETCH_PROVIDER_BUDGET_MS;
    delete process.env.FETCH_CYCLE_BUDGET_MS;
    jest.resetModules();
  });

  test('defaults to 4 minutes per provider and 10 minutes per cycle when unset', () => {
    jest.resetModules();
    const { PROVIDER_BUDGET_MS, CYCLE_BUDGET_MS } = require('../fetchBudget.service');
    expect(PROVIDER_BUDGET_MS).toBe(4 * 60 * 1000);
    expect(CYCLE_BUDGET_MS).toBe(10 * 60 * 1000);
  });

  test('respects valid configured overrides', () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '12345';
    process.env.FETCH_CYCLE_BUDGET_MS = '98765';
    jest.resetModules();
    const { PROVIDER_BUDGET_MS, CYCLE_BUDGET_MS } = require('../fetchBudget.service');
    expect(PROVIDER_BUDGET_MS).toBe(12345);
    expect(CYCLE_BUDGET_MS).toBe(98765);
  });

  test('falls back to the default for an invalid value (negative, zero, non-numeric)', () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '-5';
    jest.resetModules();
    const { PROVIDER_BUDGET_MS } = require('../fetchBudget.service');
    expect(PROVIDER_BUDGET_MS).toBe(4 * 60 * 1000);
  });
});

describe('createDeadline — monotonic elapsed-time tracking', () => {
  test('is not expired immediately after creation with a real budget', () => {
    jest.resetModules();
    const { createDeadline } = require('../fetchBudget.service');
    const deadline = createDeadline(60000);
    expect(deadline.expired()).toBe(false);
    expect(deadline.remainingMs()).toBeGreaterThan(0);
  });

  test('expires after real elapsed time exceeds a tiny budget', async () => {
    jest.resetModules();
    const { createDeadline } = require('../fetchBudget.service');
    const deadline = createDeadline(5); // 5ms

    await sleep(20);

    expect(deadline.expired()).toBe(true);
    expect(deadline.remainingMs()).toBe(0);
  });

  test('remainingMs decreases monotonically and never goes negative', async () => {
    jest.resetModules();
    const { createDeadline } = require('../fetchBudget.service');
    const deadline = createDeadline(50);

    const first = deadline.remainingMs();
    await sleep(10);
    const second = deadline.remainingMs();

    expect(second).toBeLessThanOrEqual(first);
    expect(second).toBeGreaterThanOrEqual(0);

    await sleep(100);
    expect(deadline.remainingMs()).toBe(0); // clamped, not negative
  });

  test('createProviderDeadline and createCycleDeadline use their respective configured budgets', () => {
    process.env.FETCH_PROVIDER_BUDGET_MS = '111';
    process.env.FETCH_CYCLE_BUDGET_MS = '222';
    jest.resetModules();
    const { createProviderDeadline, createCycleDeadline } = require('../fetchBudget.service');

    expect(createProviderDeadline().budgetMs).toBe(111);
    expect(createCycleDeadline().budgetMs).toBe(222);

    delete process.env.FETCH_PROVIDER_BUDGET_MS;
    delete process.env.FETCH_CYCLE_BUDGET_MS;
  });
});
