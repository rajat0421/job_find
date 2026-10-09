describe('getProcessRole', () => {
  const ORIGINAL = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = ORIGINAL;
    jest.resetModules();
  });

  test('defaults to "all" when PROCESS_ROLE is unset — required for the existing Render deployment', () => {
    delete process.env.PROCESS_ROLE;
    const { getProcessRole } = require('../processRole');
    expect(getProcessRole()).toBe('all');
  });

  test('accepts "api"', () => {
    process.env.PROCESS_ROLE = 'api';
    jest.resetModules();
    const { getProcessRole } = require('../processRole');
    expect(getProcessRole()).toBe('api');
  });

  test('accepts "worker"', () => {
    process.env.PROCESS_ROLE = 'worker';
    jest.resetModules();
    const { getProcessRole } = require('../processRole');
    expect(getProcessRole()).toBe('worker');
  });

  test('falls back to "all" for an unrecognized value', () => {
    process.env.PROCESS_ROLE = 'bogus';
    jest.resetModules();
    const { getProcessRole } = require('../processRole');
    expect(getProcessRole()).toBe('all');
  });

  test('is case-insensitive', () => {
    process.env.PROCESS_ROLE = 'WORKER';
    jest.resetModules();
    const { getProcessRole } = require('../processRole');
    expect(getProcessRole()).toBe('worker');
  });
});
