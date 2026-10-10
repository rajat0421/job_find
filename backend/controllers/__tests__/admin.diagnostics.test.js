// Guards Improvement 6, Section 6: getDiagnostics distinguishes process-alive,
// Mongo-connected, scheduler-registered-in-this-process, and actual-recent-
// execution — and never claims a scheduler/HTTP-API exists in a process role
// that wouldn't have started it. Mongo's connection state is read via the
// real mongoose singleton's `connection.readyState` (a plain property, safe
// to flip directly in a unit test) rather than mocking the whole 'mongoose'
// module, which would break the real Schema/model definitions admin.controller.js
// loads at require-time.

jest.mock('../../config/processRole', () => ({ getProcessRole: jest.fn() }));
jest.mock('../../jobs/scheduler', () => ({ isSchedulerStarted: jest.fn() }));
jest.mock('../../services/monitoring.service', () => ({
  getOperationalOverview: jest.fn(),
  getFetchHealth: jest.fn(),
  getMatchHealth: jest.fn(),
  getEmailHealth: jest.fn(),
}));

const mongoose = require('mongoose');
const { getProcessRole } = require('../../config/processRole');
const { isSchedulerStarted } = require('../../jobs/scheduler');
const { getFetchHealth, getMatchHealth, getEmailHealth } = require('../../services/monitoring.service');
const { getDiagnostics } = require('../admin.controller');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const originalReadyState = mongoose.connection.readyState;
afterEach(() => { mongoose.connection.readyState = originalReadyState; jest.clearAllMocks(); });

beforeEach(() => {
  getFetchHealth.mockResolvedValue({ status: 'success', lastRunAt: new Date('2026-01-01') });
  getMatchHealth.mockResolvedValue({ status: 'success', lastRunAt: new Date('2026-01-01') });
  getEmailHealth.mockResolvedValue({ lastSuccessAt: new Date('2026-01-01') });
});

test('reports Mongo connected when the connection is actually up', async () => {
  mongoose.connection.readyState = 1; // connected
  getProcessRole.mockReturnValue('all');
  isSchedulerStarted.mockReturnValue(true);

  const res = mockRes();
  await getDiagnostics({}, res);

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ mongoConnected: true }));
});

test('reports Mongo disconnected without leaking any connection string or credentials', async () => {
  mongoose.connection.readyState = 0; // disconnected
  getProcessRole.mockReturnValue('all');
  isSchedulerStarted.mockReturnValue(true);

  const res = mockRes();
  await getDiagnostics({}, res);

  const body = res.json.mock.calls[0][0];
  expect(body.mongoConnected).toBe(false);
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/mongodb(\+srv)?:\/\//i); // no connection URI anywhere in the response
});

test('a registered scheduler alone is not reported as proof of successful execution — recentWork is separate', async () => {
  mongoose.connection.readyState = 1;
  getProcessRole.mockReturnValue('all');
  isSchedulerStarted.mockReturnValue(true);
  getMatchHealth.mockResolvedValue({ status: 'failed', lastRunAt: new Date('2026-01-01') }); // registered, but failing

  const res = mockRes();
  await getDiagnostics({}, res);

  const body = res.json.mock.calls[0][0];
  expect(body.schedulerRegistered).toBe(true);
  expect(body.recentWork.match.status).toBe('failed'); // registration status and execution status are independent
});

test('in a pure "api" role process, the scheduler is correctly reported as not expected/registered here', async () => {
  mongoose.connection.readyState = 1;
  getProcessRole.mockReturnValue('api');
  isSchedulerStarted.mockReturnValue(false);

  const res = mockRes();
  await getDiagnostics({}, res);

  const body = res.json.mock.calls[0][0];
  expect(body.schedulerExpectedInThisProcess).toBe(false);
  expect(body.schedulerRegistered).toBe(false);
  expect(body.httpApiExpectedInThisProcess).toBe(true); // an 'api' role process IS expected to serve HTTP
});

test('in a pure "worker" role process, the HTTP API is correctly reported as not expected here', async () => {
  mongoose.connection.readyState = 1;
  getProcessRole.mockReturnValue('worker');
  isSchedulerStarted.mockReturnValue(true);

  const res = mockRes();
  await getDiagnostics({}, res);

  const body = res.json.mock.calls[0][0];
  expect(body.httpApiExpectedInThisProcess).toBe(false); // never claim the HTTP API must be running in worker mode
  expect(body.schedulerExpectedInThisProcess).toBe(true);
});

test('a monitoring lookup failure degrades to "unknown" instead of crashing the whole endpoint', async () => {
  mongoose.connection.readyState = 1;
  getProcessRole.mockReturnValue('all');
  isSchedulerStarted.mockReturnValue(true);
  getFetchHealth.mockRejectedValue(new Error('aggregation failed'));

  const res = mockRes();
  await expect(getDiagnostics({}, res)).resolves.not.toThrow();

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    recentWork: expect.objectContaining({ fetch: expect.objectContaining({ status: 'unknown' }) }),
  }));
});
