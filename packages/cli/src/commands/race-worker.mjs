/** Copyright 2026 TRINORIS. Licensed under Apache-2.0 — see LICENSE. */
import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('Filesystem race worker requires a parent thread');

const barrier = new Int32Array(workerData.barrier);
parentPort.postMessage({ type: 'ready' });
const result = Atomics.wait(barrier, 0, 0, workerData.timeoutMs);
if (result === 'timed-out' && Atomics.load(barrier, 0) === 0) {
  parentPort.postMessage({ type: 'error', error: 'shared race barrier timed out' });
} else {
  try {
    fs.mkdirSync(workerData.lockPath);
    parentPort.postMessage({ type: 'outcome', outcome: 'WIN' });
  } catch (error) {
    if (error?.code === 'EEXIST' || error?.code === 'EISDIR') parentPort.postMessage({ type: 'outcome', outcome: 'LOSE' });
    else parentPort.postMessage({ type: 'error', error: String(error?.message ?? error) });
  }
}
