import { EventEmitter } from 'node:events';
import fs, { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { workerMock } = vi.hoisted(() => ({ workerMock: vi.fn(function WorkerMock() {}) }));

vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  return { ...actual, Worker: workerMock };
});

import { verify } from './verify.js';
import { setup } from './setup.js';

describe('verify probe options', () => {
  it.each([
    [0, 2, 'trials must be a positive integer'],
    [-1, 2, 'trials must be a positive integer'],
    [1.5, 2, 'trials must be a positive integer'],
    [Number.NaN, 2, 'trials must be a positive integer'],
    [Number.POSITIVE_INFINITY, 2, 'trials must be a positive integer'],
    [1, 0, 'concurrency must be an integer of at least 2'],
    [1, 1, 'concurrency must be an integer of at least 2'],
    [1, 1.5, 'concurrency must be an integer of at least 2'],
    [1, Number.NaN, 'concurrency must be an integer of at least 2'],
    [101, 2, 'trials'],
    [1, 33, 'concurrency'],
    [33, 32, 'trials x concurrency'],
  ])('rejects trials=%s and concurrency=%s before probing', async (trials, concurrency, message) => {
    await expect(verify('/path/that/should/not/be/read', Number(trials), Number(concurrency)))
      .rejects.toThrow(String(message));
  });
});

function makeWorkspace(): string {
  const workDir = mkdtempSync(join(tmpdir(), 'trinoris-agent-verify-'));
  setup({ workDir });
  return workDir;
}

function makeWorker() {
  const worker = new EventEmitter() as EventEmitter & {
    terminate: ReturnType<typeof vi.fn>;
  };
  worker.terminate = vi.fn(async () => {
    worker.emit('exit', 1);
    return 1;
  });
  return worker;
}

function mockSuccessfulRaces() {
  const winnerByBarrier = new WeakMap<object, number>();
  workerMock.mockImplementation(function (_url: URL, options: { workerData: { barrier: object } }) {
    const worker = makeWorker(); const barrier = options.workerData.barrier;
    const current = winnerByBarrier.get(barrier) ?? 0; winnerByBarrier.set(barrier, current + 1);
    queueMicrotask(() => {
      worker.emit('message', { type: 'ready' });
      setImmediate(() => { worker.emit('message', { type: 'outcome', outcome: current === 0 ? 'WIN' : 'LOSE' }); worker.emit('exit', 0); });
    });
    return worker;
  });
}

describe('verify probe failures', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = makeWorkspace();
    vi.spyOn(fs, 'statfsSync').mockReturnValue({ type: 0x01021997 } as fs.StatsFs);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports worker errors as indeterminate instead of non-atomic', async () => {
    workerMock.mockImplementation(function () {
      const worker = makeWorker();
      queueMicrotask(() => { worker.emit('error', new Error('worker failed')); worker.emit('exit', 1); });
      return worker;
    });

    const result = await verify(workDir, 1, 2);

    expect(result.atomicityOk).toBeNull();
    expect(result.badTrials).toBe(0);
    expect(result.probeErrors[0]).toContain('race worker failed');
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('terminates already-started workers if a later worker cannot be created', async () => {
    const first = makeWorker(); let starts = 0;
    workerMock.mockImplementation(function () {
      starts++;
      if (starts === 2) throw new Error('thread resource denied');
      return first;
    });
    const result = await verify(workDir, 1, 2);
    expect(starts).toBe(2);
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(result.atomicityOk).toBeNull();
    expect(result.probeErrors[0]).toContain('could not start race worker');
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('reports a worker timeout explicitly as indeterminate', async () => {
    vi.useFakeTimers();
    const workers: ReturnType<typeof makeWorker>[] = [];
    workerMock.mockImplementation(function () { const worker = makeWorker(); workers.push(worker); return worker; });

    const pending = verify(workDir, 1, 2);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.atomicityOk).toBeNull();
    expect(result.badTrials).toBe(0);
    expect(result.probeErrors[0]).toContain('race workers timed out after 15s');
    expect(workers.length).toBeGreaterThan(0);
    expect(workers.every(worker => worker.terminate.mock.calls.length >= 1)).toBe(true);
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('SG-02 preserves an existing verifier directory even when workers fail', async () => {
    const path = join(workDir, '.trinoris/.verify-atomicity'); mkdirSync(path);
    writeFileSync(join(path, 'sentinel'), 'keep');
    workerMock.mockImplementation(function () { const p = makeWorker(); queueMicrotask(() => { p.emit('error', new Error('EPERM')); p.emit('exit', 1); }); return p; });
    await verify(workDir, 1, 2);
    expect(readFileSync(join(path, 'sentinel'), 'utf8')).toBe('keep');
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('SG-02 preserves preexisting data through successful concurrent verifier runs', async () => {
    const prior = join(workDir, '.trinoris/.verify-atomicity'); mkdirSync(prior);
    writeFileSync(join(prior, 'sentinel'), 'keep'); mockSuccessfulRaces();
    const results = await Promise.all([verify(workDir, 2, 2), verify(workDir, 2, 2)]);
    expect(results.every(result => result.ready && result.atomicityOk === true)).toBe(true);
    expect(readFileSync(join(prior, 'sentinel'), 'utf8')).toBe('keep');
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('SG-02 removes only its owned arena when verification is aborted', async () => {
    const prior = join(workDir, '.trinoris/.verify-atomicity'); mkdirSync(prior);
    writeFileSync(join(prior, 'sentinel'), 'keep'); const controller = new AbortController(); controller.abort();
    const result = await verify(workDir, 1, 2, { signal: controller.signal });
    expect(result.atomicityOk).toBeNull();
    expect(readFileSync(join(prior, 'sentinel'), 'utf8')).toBe('keep');
    expect(readdirSync(join(workDir, '.trinoris')).filter(name => name.startsWith('.verify-atomicity-'))).toEqual([]);
  });

  it('SG-09 separates protocol readiness from the filesystem probe', async () => {
    writeFileSync(join(workDir, '.trinoris/PROTOCOL.md'), '# placeholder');
    workerMock.mockImplementation(function () { const p = makeWorker(); queueMicrotask(() => { p.emit('error', new Error('EPERM')); p.emit('exit', 1); }); return p; });
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ protocolOk: false, ready: false, atomicityOk: null });
  });

  it('does not report ready when the coordination directory is not ignored by Git', async () => {
    writeFileSync(join(workDir, '.gitignore'), '');
    workerMock.mockImplementation(function () { const p = makeWorker(); queueMicrotask(() => { p.emit('error', new Error('EPERM')); p.emit('exit', 1); }); return p; });
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ gitignoreOk: false, ready: false });
    expect(result.notes.join(' ')).toContain('missing /.trinoris/ ignore rule');
  });

  it.each([
    ['worker exited before READY', '', 0],
    ['worker returned no race outcome', 'READY\n', 0],
    ['worker returned multiple outcomes', 'READY\nWIN\nLOSE\n', 0],
    ['worker exited unsuccessfully', 'READY\nWIN\n', 1],
  ])('reports invalid probe result: %s', async (_label, output, code) => {
    workerMock.mockImplementation(function () {
      const worker = makeWorker();
      queueMicrotask(() => {
        const lines = String(output).trim().split('\n').filter(Boolean);
        if (lines[0] === 'READY') worker.emit('message', { type: 'ready' });
        setImmediate(() => {
          for (const line of lines.slice(1)) worker.emit('message', { type: 'outcome', outcome: line });
          worker.emit('exit', code);
        });
      });
      return worker;
    });
    const result = await verify(workDir, 1, 2);
    expect(result.atomicityOk).toBeNull();
    expect(result.probeErrors).toHaveLength(1);
  });

  it('keeps filesystem identification failures as warnings after a valid probe', async () => {
    mockSuccessfulRaces();
    vi.spyOn(fs, 'statfsSync').mockImplementation(() => { throw new Error('stat unavailable'); });
    const result = await verify(workDir, 1, 2);
    expect(result.atomicityOk).toBe(true);
    expect(result.filesystem).toBe('unknown');
    expect(result.notes.join(' ')).toContain('could not identify filesystem type');
  });

  it('reports missing setup artifacts separately from a successful filesystem probe', async () => {
    rmSync(join(workDir, '.trinoris'), { recursive: true, force: true });
    for (const path of ['.gitignore', 'AGENTS.md', 'CLAUDE.md', '.claude']) {
      rmSync(join(workDir, path), { recursive: true, force: true });
    }
    mockSuccessfulRaces();
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ structureOk: false, configOk: false, protocolOk: false, gitignoreOk: false, atomicityOk: true, ready: false });
    expect(result.notes.join(' ')).toContain('no .trinoris/');
  });

  it('marks the probe non-atomic if contenders report zero winners', async () => {
    workerMock.mockImplementation(function () {
      const worker = makeWorker();
      queueMicrotask(() => { worker.emit('message', { type: 'ready' }); setImmediate(() => { worker.emit('message', { type: 'outcome', outcome: 'LOSE' }); worker.emit('exit', 0); }); });
      return worker;
    });
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ atomicityOk: false, badTrials: 1, totalWinners: 0 });
  });

  it('SG-09 blocks readiness when the Claude entry point loses its protocol pointer', async () => {
    writeFileSync(join(workDir, 'CLAUDE.md'), '# Project notes\n');
    mockSuccessfulRaces();
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ protocolOk: false, ready: false, atomicityOk: true });
    expect(result.notes.join(' ')).toContain('missing generated protocol pointer');
  });
});
