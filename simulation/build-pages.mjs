import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const STATIC_FILES = [
  'viewer/index.html', 'viewer/viewer.css', 'viewer/viewer.js',
  'viewer/replay-state.js', 'viewer/editor-workspace.js',
  'scenario.js', 'artifacts/latest.js',
];

function readAsset(root, file) {
  let path = root;
  if (lstatSync(path).isSymbolicLink()) throw new Error('Unsafe source directory: ' + root);
  for (const part of file.split('/')) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error('Linked assets cannot be published: ' + file);
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size === 0 || stat.size > 20_000_000) throw new Error('Invalid or oversized asset: ' + file);
  return readFileSync(path);
}

export function buildPages({ sourceDir = here, outputDir = join(here,'site') } = {}) {
  sourceDir = resolve(sourceDir); outputDir = resolve(outputDir);
  if (existsSync(outputDir)) throw new Error('Output directory already exists; choose a fresh directory: ' + outputDir);
  // Read and validate everything before creating output. Never recursively copy a run workspace.
  const assets = new Map(STATIC_FILES.map((file) => [file, readAsset(sourceDir,file)]));
  const assignment = assets.get('artifacts/latest.js').toString('utf8').match(/^globalThis\.TRINORIS_SIMULATION_RUN=([\s\S]+);\s*$/);
  if (!assignment) throw new Error('Invalid latest replay bundle; run the simulation first.');
  const bundle = JSON.parse(assignment[1]);
  if (bundle.schema_version !== 1 || !Array.isArray(bundle.events) || !bundle.verifier || typeof bundle.verifier.passed !== 'boolean') throw new Error('Invalid latest replay shape.');
  if (bundle.verifier.event_count !== bundle.events.length) throw new Error('Replay event count does not match the verifier.');
  const runId = bundle.events.find((event) => event.run_id)?.run_id;
  if (runId && runId !== bundle.verifier.run_id) throw new Error('Replay run ID does not match the verifier.');
  mkdirSync(dirname(outputDir),{recursive:true});
  mkdirSync(outputDir);
  for (const [file, content] of assets) {
    const target = join(outputDir,file);
    mkdirSync(dirname(target),{recursive:true});
    writeFileSync(target,content,{flag:'wx'});
  }
  writeFileSync(join(outputDir,'.nojekyll'),'');
  writeFileSync(join(outputDir,'index.html'),'<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./viewer/index.html"><title>Trinoris Multi-Agent Simulator Replay</title><meta name="description" content="Watch coding agents coordinate file ownership, edits, tests, and review handoffs."></head><body><p><a href="./viewer/index.html">Open the interactive simulator replay →</a></p></body></html>\n');
  return { outputDir, files:[...STATIC_FILES,'index.html','.nojekyll'], runId:bundle.verifier.run_id, passed:bundle.verifier.passed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1] || args[1].startsWith('--'))) throw new Error('Usage: node simulation/build-pages.mjs [--output DIRECTORY]');
    const result = buildPages(args.length ? {outputDir:args[1]} : {});
    console.log('Pages site: ' + result.outputDir);
    console.log('Replay: ' + result.runId + ' · ' + (result.passed ? 'PASS' : 'FAIL') + ' · ' + result.files.length + ' published files');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
