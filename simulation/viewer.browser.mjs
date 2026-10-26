import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = dirname(fileURLToPath(import.meta.url));
const servedRoot = process.env.SIMULATION_SITE_DIR ? resolve(process.env.SIMULATION_SITE_DIR) : root;
const source = readFileSync(join(root, 'artifacts/latest.js'), 'utf8');
const bundle = JSON.parse(source.slice(source.indexOf('=')+1).trim().replace(/;$/, ''));
const events = bundle.events;
assert.ok(events.some((event) => event.file?.operation === 'editing'), 'Run node simulation/run.mjs first to record editor snapshots.');
const assets = new Set(['index.html','viewer/index.html','viewer/viewer.css','viewer/viewer.js','viewer/replay-state.js','viewer/editor-workspace.js','scenario.js','artifacts/latest.js']);
const server = createServer((req,res) => {
  const urlPath = new URL(req.url,'http://localhost').pathname;
  if (!urlPath.startsWith('/multi-agents/')) { res.writeHead(404); res.end(); return; }
  let path = urlPath.slice('/multi-agents/'.length);
  if (!path && !existsSync(join(servedRoot,'index.html'))) { res.writeHead(302,{Location:'./viewer/index.html'}); res.end(); return; }
  if (!path) path = 'index.html';
  if (!assets.has(path)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type',path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(readFileSync(join(servedRoot,path)));
});
await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  const context = await browser.newContext({viewport:{width:1600,height:1100}});
  await context.route('https://fonts.googleapis.com/**',(route) => route.abort());
  await context.route('https://fonts.gstatic.com/**',(route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',(error) => errors.push(error.message));
  async function seek(predicate) {
    const index = events.findIndex(predicate);
    assert.ok(index >= 0, 'Expected replay event is recorded.');
    await page.locator('#scrub').evaluate((slider,cursor) => { slider.value = cursor; slider.dispatchEvent(new Event('input',{bubbles:true})); },index+1);
    return events[index];
  }
  const writer = events.find((event) => event.event === 'scope-acquire' && event.exit_code === 0).actor;
  const sourcePath = events.find((event) => event.event === 'write-fixture').file.path;
  const testPath = events.find((event) => event.event === 'test-file-saved').file.path;
  for (const url of [pathToFileURL(join(servedRoot,'viewer/index.html')).href,'http://127.0.0.1:' + server.address().port + '/multi-agents/']) {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('#sourceLabel').textContent === 'LATEST SAVED RUN');
    if (url.startsWith('http:')) assert.match(page.url(),/\/multi-agents\/viewer\/index\.html$/,'Pages redirect preserves the repository URL prefix');
    await seek((event) => event.event === 'scope-acquire' && event.exit_code === 3);
    assert.equal(await page.locator('[data-scope="packages"] .lease-owner').textContent(),writer,'a rejected writer never becomes the owner');
    await seek((event) => event.event === 'file-edit-start' && event.file.scope === 'tests');
    assert.equal(await page.locator('#leaseCount').textContent(),'2');
    assert.equal(await page.locator('#editorBreadcrumb').textContent(),testPath);
    assert.match(await page.locator('#editorOwner').textContent(),/Editing · kiro-test-engineer/);
    assert.equal(await page.locator('#fileTree .editing').count(),1);
    assert.equal(await page.locator('.editor-caret').count(),1);
    assert.ok(await page.locator('.log-event.current').evaluate((row) => { const bounds = row.getBoundingClientRect(); const panel = row.parentElement.getBoundingClientRect(); return bounds.bottom <= panel.bottom + 1 && bounds.top >= panel.top - 1; }), 'scrubbing keeps current activity visible inside its panel');
    assert.equal(await page.locator('[data-scope="tests"] .lease-owner').textContent(),'kiro-test-engineer');

    await page.locator('#fileTree button').filter({hasText:'README.md'}).click();
    assert.equal(await page.locator('#followEditor').isChecked(),false);
    await seek((event) => event.event === 'file-edit-start' && event.file.scope === 'packages');
    assert.equal(await page.locator('#editorBreadcrumb').textContent(),'README.md','manual file selection remains pinned');
    await page.locator('#followEditor').check();
    assert.equal(await page.locator('#editorBreadcrumb').textContent(),sourcePath);
    assert.match(await page.locator('#editorOwner').textContent(),new RegExp('Editing · ' + writer));
    assert.ok(await page.locator('.code-line.added').count() > 0);
    assert.match(await page.locator('#codeLines').textContent(),/testsAreGreen && reviewIsApproved/);

    await seek((event) => event.event === 'workspace-seeded');
    assert.match(await page.locator('#codeLines').textContent(),/TODO/);
    assert.equal(await page.locator('#fileTree .tree-row').filter({hasText:'release-policy.test.mjs'}).count(),0,'rewinding hides future files');
    assert.equal(await page.locator('#leaseCount').textContent(),'0');
    await seek((event) => event.test_run?.expected_failure);
    assert.equal(await page.locator('#systemTests').textContent(),'RED EXPECTED');
    await page.locator('#outputTab').click();
    assert.ok(await page.locator('#commandOutput').isVisible());
    assert.match(await page.locator('#commandOutput').textContent(),/not ok/);
    await seek((event) => event.test_run?.passed);
    assert.equal(await page.locator('#systemTests').textContent(),'GREEN');
    assert.match(await page.locator('#testSummary').textContent(),/3 passed · 0 failed/);
    await page.locator('#activityTab').click();
    await seek((event) => event.event === 'handoff-publish');
    assert.match(await page.locator('#handoffState').textContent(),/Ready for reviewer/);
    const review = await seek((event) => event.event === 'review-fixture');
    assert.match(await page.locator('#editorOwner').textContent(),new RegExp('Reviewing · ' + review.actor));
    assert.match(await page.locator('#handoffState').textContent(),/Claimed/);
    await seek((event) => event.event === 'run-complete');
    assert.equal(await page.locator('#leaseCount').textContent(),'0');
    assert.match(await page.locator('#handoffState').textContent(),/Completed · archived/);
    assert.equal(await page.locator('#auditState').textContent(),'8/8 HELD');
    assert.equal(await page.locator('.final-checks[open]').count(),0);
    assert.equal(await page.locator('#actorRoster .unit-card').count(),6);
    await page.locator('#latestBtn').click();
    await page.waitForFunction(() => !document.querySelector('#latestBtn').disabled);
    assert.equal(await page.locator('#runId').textContent(),bundle.verifier.run_id);
  }
  await seek((event) => event.event === 'file-edit-start' && event.file.scope === 'packages');
  await page.screenshot({path:join(root,'artifacts/editor-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'mobile must not overflow horizontally');
  assert.ok(await page.evaluate(() => document.querySelector('.roster-panel').getBoundingClientRect().top < document.querySelector('.editor-workspace').getBoundingClientRect().top),'mobile actor strip precedes the coding workspace');
  await page.screenshot({path:join(root,'artifacts/editor-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1600,height:1100});
  await page.locator('#demoBtn').click();
  await page.locator('#scrub').evaluate((slider) => { slider.value = slider.max; slider.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#sourceLabel').textContent(),'SYNTHETIC DEMO');
  assert.equal(await page.locator('#auditState').textContent(),'8/8 HELD');
  assert.match(await page.locator('#codeLines').textContent(),/testsAreGreen && reviewIsApproved/);
  await page.locator('#reportInput').setInputFiles({name:'legacy.jsonl',mimeType:'text/plain',buffer:Buffer.from(JSON.stringify({actor:'legacy-writer',event:'write-fixture',path:'packages/legacy.txt'}))});
  await page.locator('#scrub').evaluate((slider) => { slider.value = slider.max; slider.dispatchEvent(new Event('input')); });
  assert.equal(await page.locator('#snapshotSource').textContent(),'NOT RECORDED');
  assert.match(await page.locator('#editorFileState').textContent(),/not recorded/);
  assert.deepEqual(errors,[]);
  console.log('PASS: file/HTTP autoload; ownership and blocked writers; independent scopes; editor buffers and diffs; pinned files; rewind; RED/GREEN tests; review/archive; mobile; demo and legacy reports.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
