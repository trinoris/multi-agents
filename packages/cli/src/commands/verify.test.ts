import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, execFileSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock, execFileSync: execFileSyncMock };
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
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  worker.stdout = new PassThrough();
  worker.stderr = new PassThrough();
  worker.kill = vi.fn(() => {
    worker.emit('close', null, 'SIGKILL');
    return true;
  });
  return worker;
}

describe('verify probe failures', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = makeWorkspace();
    execFileSyncMock.mockReturnValue('v9fs\n');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reports worker spawn errors as indeterminate instead of non-atomic', async () => {
    spawnMock.mockImplementation(() => {
      const worker = makeWorker();
      queueMicrotask(() => worker.emit('error', Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })));
      return worker;
    });

    const result = await verify(workDir, 1, 2);

    expect(result.atomicityOk).toBeNull();
    expect(result.badTrials).toBe(0);
    expect(result.probeErrors[0]).toContain('could not start race worker');
    expect(execFileSyncMock).toHaveBeenCalledWith('stat', expect.any(Array), expect.objectContaining({ timeout: 2000, maxBuffer: 4096 }));
  });

  it('reports a worker timeout explicitly as indeterminate', async () => {
    vi.useFakeTimers();
    spawnMock.mockImplementation(() => makeWorker());

    const pending = verify(workDir, 1, 2);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.atomicityOk).toBeNull();
    expect(result.badTrials).toBe(0);
    expect(result.probeErrors[0]).toContain('race workers timed out after 15s');
  });

  it('SG-02 preserves an existing verifier directory even when workers fail', async () => {
    const path = join(workDir, '.trinoris/.verify-atomicity'); mkdirSync(path);
    writeFileSync(join(path, 'sentinel'), 'keep');
    spawnMock.mockImplementation(() => { const p = makeWorker(); queueMicrotask(() => p.emit('error', new Error('EPERM'))); return p; });
    await verify(workDir, 1, 2);
    expect(readFileSync(join(path, 'sentinel'), 'utf8')).toBe('keep');
  });

  it('SG-09 separates protocol readiness from the filesystem probe', async () => {
    writeFileSync(join(workDir, '.trinoris/PROTOCOL.md'), '# placeholder');
    spawnMock.mockImplementation(() => { const p = makeWorker(); queueMicrotask(() => p.emit('error', new Error('EPERM'))); return p; });
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ protocolOk: false, ready: false, atomicityOk: null });
  });

  it('does not report ready when the coordination directory is not ignored by Git', async () => {
    writeFileSync(join(workDir, '.gitignore'), '');
    spawnMock.mockImplementation(() => { const p = makeWorker(); queueMicrotask(() => p.emit('error', new Error('EPERM'))); return p; });
    const result = await verify(workDir, 1, 2);
    expect(result).toMatchObject({ gitignoreOk: false, ready: false });
    expect(result.notes.join(' ')).toContain('missing /.trinoris/ ignore rule');
  });
});
