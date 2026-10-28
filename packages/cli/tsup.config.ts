import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'node:fs';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  shims: true,
  onSuccess: () => {
    mkdirSync('dist', { recursive: true });
    copyFileSync('src/commands/race-worker.mjs', 'dist/race-worker.mjs');
  },
});
