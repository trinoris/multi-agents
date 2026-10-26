import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { buildPages, STATIC_FILES } from './build-pages.mjs';

function fixture(t, verifier = { run_id:'run-1', passed:true, event_count:1, checks:{ exclusive_scope_lease:true } }) {
  const root = mkdtempSync(join(tmpdir(),'trinoris-pages-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const sourceDir = join(root,'source');
  for (const file of STATIC_FILES) { mkdirSync(dirname(join(sourceDir,file)),{recursive:true}); writeFileSync(join(sourceDir,file),'asset: ' + file); }
  const bundle = { schema_version:1, events:[{ actor:'verifier', event:'run-complete', run_id:'run-1' }], verifier };
  writeFileSync(join(sourceDir,'artifacts/latest.js'),'globalThis.TRINORIS_SIMULATION_RUN=' + JSON.stringify(bundle) + ';\n');
  mkdirSync(join(sourceDir,'artifacts/run-1/workspace/.trinoris'),{recursive:true});
  writeFileSync(join(sourceDir,'artifacts/run-1/workspace/.trinoris/private-state.json'),'must not publish');
  return { sourceDir, outputDir:join(root,'site') };
}
function listFiles(directory,prefix='') {
  return readdirSync(directory,{withFileTypes:true}).flatMap((entry) => entry.isDirectory() ? listFiles(join(directory,entry.name),prefix+entry.name+'/') : [prefix+entry.name]);
}
test('Pages output contains only allowlisted viewer assets and the latest replay', (t) => {
  const options = fixture(t);
  buildPages(options);
  assert.deepEqual(listFiles(options.outputDir).sort(),[...STATIC_FILES,'index.html','.nojekyll'].sort());
  assert.match(readFileSync(join(options.outputDir,'index.html'),'utf8'),/url=\.\/viewer\/index\.html/);
  assert.equal(readFileSync(join(options.outputDir,'viewer/index.html'),'utf8'),'asset: viewer/index.html');
});
test('missing replay data aborts before a partial site can be published', (t) => {
  const options = fixture(t); rmSync(join(options.sourceDir,'artifacts/latest.js'));
  assert.throws(() => buildPages(options),/latest\.js/);
  assert.equal(existsSync(options.outputDir),false);
});
test('mismatched event counts or run IDs are rejected', (t) => {
  for (const verifier of [{run_id:'run-1',passed:true,event_count:2,checks:{}},{run_id:'wrong-run',passed:true,event_count:1,checks:{}}]) {
    const options = fixture(t,verifier);
    assert.throws(() => buildPages(options),/does not match/);
    assert.equal(existsSync(options.outputDir),false);
  }
});
test('failed simulations remain publishable so their results are visible', (t) => {
  const options = fixture(t,{run_id:'run-1',passed:false,event_count:1,checks:{exclusive_scope_lease:false}});
  buildPages(options);
  assert.match(readFileSync(join(options.outputDir,'artifacts/latest.js'),'utf8'),/"passed":false/);
});
test('existing output is never overwritten or reused', (t) => {
  const options = fixture(t); mkdirSync(options.outputDir);
  writeFileSync(join(options.outputDir,'existing.txt'),'preserve me');
  assert.throws(() => buildPages(options),/already exists/);
  assert.equal(readFileSync(join(options.outputDir,'existing.txt'),'utf8'),'preserve me');
});
