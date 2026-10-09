// Guards the scheduler-startup module used by both the "all" and "worker"
// process roles: it must register each pipeline exactly once per process,
// even if called more than once (e.g. a future code path that starts
// schedulers twice by accident).

beforeEach(() => jest.resetModules());

test('registers all three pipelines exactly once', () => {
  jest.doMock('../fetchJobs.job', () => ({ startFetchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isFetchRunning: jest.fn(() => false) }));
  jest.doMock('../matchJobs.job', () => ({ startMatchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isMatchRunning: jest.fn(() => false) }));
  jest.doMock('../dailyEmail.job', () => ({ startDailyEmailCron: jest.fn(() => ({ stop: jest.fn() })), isEmailRunning: jest.fn(() => false) }));

  const { startFetchJobsCron } = require('../fetchJobs.job');
  const { startMatchJobsCron } = require('../matchJobs.job');
  const { startDailyEmailCron } = require('../dailyEmail.job');
  const { startSchedulers } = require('../scheduler');

  startSchedulers();

  expect(startFetchJobsCron).toHaveBeenCalledTimes(1);
  expect(startMatchJobsCron).toHaveBeenCalledTimes(1);
  expect(startDailyEmailCron).toHaveBeenCalledTimes(1);
});

test('calling startSchedulers twice in the same process does not double-register', () => {
  jest.doMock('../fetchJobs.job', () => ({ startFetchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isFetchRunning: jest.fn(() => false) }));
  jest.doMock('../matchJobs.job', () => ({ startMatchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isMatchRunning: jest.fn(() => false) }));
  jest.doMock('../dailyEmail.job', () => ({ startDailyEmailCron: jest.fn(() => ({ stop: jest.fn() })), isEmailRunning: jest.fn(() => false) }));

  const { startFetchJobsCron } = require('../fetchJobs.job');
  const { startSchedulers } = require('../scheduler');

  startSchedulers();
  startSchedulers();

  expect(startFetchJobsCron).toHaveBeenCalledTimes(1);
});

test('stopAll() stops every registered task', () => {
  const fetchStop = jest.fn();
  const matchStop = jest.fn();
  const emailStop = jest.fn();
  jest.doMock('../fetchJobs.job', () => ({ startFetchJobsCron: jest.fn(() => ({ stop: fetchStop })), isFetchRunning: jest.fn(() => false) }));
  jest.doMock('../matchJobs.job', () => ({ startMatchJobsCron: jest.fn(() => ({ stop: matchStop })), isMatchRunning: jest.fn(() => false) }));
  jest.doMock('../dailyEmail.job', () => ({ startDailyEmailCron: jest.fn(() => ({ stop: emailStop })), isEmailRunning: jest.fn(() => false) }));

  const { startSchedulers } = require('../scheduler');
  const handle = startSchedulers();
  handle.stopAll();

  expect(fetchStop).toHaveBeenCalledTimes(1);
  expect(matchStop).toHaveBeenCalledTimes(1);
  expect(emailStop).toHaveBeenCalledTimes(1);
});

test('isBusy() is true when any pipeline is currently running', () => {
  jest.doMock('../fetchJobs.job', () => ({ startFetchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isFetchRunning: jest.fn(() => false) }));
  jest.doMock('../matchJobs.job', () => ({ startMatchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isMatchRunning: jest.fn(() => true) }));
  jest.doMock('../dailyEmail.job', () => ({ startDailyEmailCron: jest.fn(() => ({ stop: jest.fn() })), isEmailRunning: jest.fn(() => false) }));

  const { startSchedulers } = require('../scheduler');
  const handle = startSchedulers();

  expect(handle.isBusy()).toBe(true);
});

test('isBusy() is false when nothing is running', () => {
  jest.doMock('../fetchJobs.job', () => ({ startFetchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isFetchRunning: jest.fn(() => false) }));
  jest.doMock('../matchJobs.job', () => ({ startMatchJobsCron: jest.fn(() => ({ stop: jest.fn() })), isMatchRunning: jest.fn(() => false) }));
  jest.doMock('../dailyEmail.job', () => ({ startDailyEmailCron: jest.fn(() => ({ stop: jest.fn() })), isEmailRunning: jest.fn(() => false) }));

  const { startSchedulers } = require('../scheduler');
  const handle = startSchedulers();

  expect(handle.isBusy()).toBe(false);
});
