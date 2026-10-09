// Verifies the process-role contract that both server.js (default entry
// point, "all"/"api") and worker.js (dedicated "worker" entry point) rely on:
//   - "all"    starts BOTH the HTTP API and the schedulers (current Render default)
//   - "api"    starts the HTTP API and does NOT register schedulers
//   - "worker" registers schedulers and does NOT start the HTTP API
// This is the automated check for the "before finishing" verification steps.

jest.mock('../config/db', () => jest.fn().mockResolvedValue());
jest.mock('../config/processRole', () => ({ getProcessRole: jest.fn() }));
jest.mock('../app', () => ({
  listen: jest.fn((_port, cb) => {
    cb();
    return { close: jest.fn((done) => done && done()) };
  }),
}));
jest.mock('../jobs/scheduler', () => ({
  startSchedulers: jest.fn(() => ({ stopAll: jest.fn(), isBusy: jest.fn(() => false) })),
}));

const connectDB = require('../config/db');
const { getProcessRole } = require('../config/processRole');
const app = require('../app');
const { startSchedulers } = require('../jobs/scheduler');
const { startProcess } = require('../bootstrap');

beforeEach(() => jest.clearAllMocks());

test('"all" mode (the current Render default) starts both the API and the schedulers', async () => {
  getProcessRole.mockReturnValue('all');

  const ctx = await startProcess();

  expect(connectDB).toHaveBeenCalledTimes(1);
  expect(app.listen).toHaveBeenCalledTimes(1);
  expect(startSchedulers).toHaveBeenCalledTimes(1);
  expect(ctx.role).toBe('all');
  expect(ctx.httpServer).toBeTruthy();
  expect(ctx.schedulerHandle).toBeTruthy();
});

test('"api" mode starts the HTTP API and does NOT register background schedulers', async () => {
  getProcessRole.mockReturnValue('api');

  const ctx = await startProcess();

  expect(app.listen).toHaveBeenCalledTimes(1);
  expect(startSchedulers).not.toHaveBeenCalled();
  expect(ctx.schedulerHandle).toBeNull();
});

test('"worker" mode registers schedulers and does NOT start the HTTP API', async () => {
  getProcessRole.mockReturnValue('worker');

  const ctx = await startProcess();

  expect(app.listen).not.toHaveBeenCalled();
  expect(startSchedulers).toHaveBeenCalledTimes(1);
  expect(ctx.httpServer).toBeNull();
});

test('an explicit role override (used by worker.js) takes precedence over PROCESS_ROLE resolution', async () => {
  getProcessRole.mockReturnValue('all'); // should be ignored in favor of the override

  await startProcess('worker');

  expect(app.listen).not.toHaveBeenCalled();
  expect(startSchedulers).toHaveBeenCalledTimes(1);
});

test('every role connects to MongoDB', async () => {
  for (const role of ['all', 'api', 'worker']) {
    jest.clearAllMocks();
    await startProcess(role);
    expect(connectDB).toHaveBeenCalledTimes(1);
  }
});
