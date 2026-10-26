(() => {
  const $ = (selector) => document.querySelector(selector);
  const scenario = globalThis.TrinorisSimulationScenario;
  const replay = globalThis.TrinorisWorkspaceReplay;
  const editor = globalThis.TrinorisEditorWorkspace;
  const state = { events:[], verifier:null, cursor:0, playing:false, speed:1, timer:null, label:'', demo:false, loadVersion:0, selectedFile:null, follow:true, collapsed:new Set(), model:null };
  const labels = {
    exclusive_scope_lease:'Exclusive lease', generation_fencing:'Generation fencing', recipient_enforcement:'Recipient routing',
    single_handoff_claimant:'Single claimant', reviewer_inspected_change:'Change inspected', completed_handoff_archived:'Handoff archived',
    tests_red_before_fix:'Regression caught', tests_green_after_fix:'Tests green',
    all_expected_outcomes:'All expected outcomes',
  };
  const knownRoles = {
    simulation:{ role:'runtime', badge:'S' }, orchestrator:{ role:'orchestrator', badge:'O' }, verifier:{ role:'verifier', badge:'V' },
    'codex-writer':{ role:'writer agent', badge:'C' }, 'codex-contender':{ role:'writer agent', badge:'C' },
    'claude-reviewer-a':{ role:'reviewer', badge:'A' }, 'claude-reviewer-b':{ role:'reviewer', badge:'A' }, 'kiro-outsider':{ role:'outsider probe', badge:'!' },
    'kiro-test-engineer':{ role:'test engineer', badge:'K' },
  };
  const phaseFor = (event) => {
    if (/review|inspect|complete|archive|run-complete/.test(event ?? '')) return 'review';
    if (/handoff|wrong-recipient|claim/.test(event ?? '')) return 'handoff';
    return 'compete';
  };
  function el(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = String(text);
    return item;
  }
  function actorMeta(actor) { return knownRoles[actor] ?? { role:'agent session', badge:String(actor ?? '?').slice(0,1).toUpperCase() }; }
  function actorColor(actor) { return ({'codex-writer':'#83aeff','codex-contender':'#6bd6bd','kiro-test-engineer':'#e4bb72','claude-reviewer-a':'#b9a1f5','claude-reviewer-b':'#e6a0d2','kiro-outsider':'#ef927b'})[actor] ?? '#83aeff'; }
  function eventTone(event) {
    if (event?.test_run?.expected_failure && !event.test_run.passed) return 'denied';
    if (['wrong-recipient-claim','stale-generation-probe'].includes(event?.event) || (event?.event === 'scope-acquire' && event.exit_code === 3) || (event?.event === 'handoff-claim-race' && event.exit_code !== 0)) return 'denied';
    if (event?.event === 'run-failed' || event?.passed === false || (event?.exit_code > 3)) return 'failed';
    if (event?.exit_code === 0 || event?.passed === true || ['write-fixture','review-fixture','run-start'].includes(event?.event)) return 'good';
    return 'pending';
  }
  function resetPlayback() { state.playing = false; clearTimeout(state.timer); state.timer = null; $('#playBtn').textContent = '▶ Play'; }
  function selectFile(path) { state.selectedFile = path; state.follow = false; $('#followEditor').checked = false; render(); }
  function renderRoster() {
    const actors = [...new Set(state.events.map((event) => event.actor).filter((actor) => actor && !['simulation','orchestrator','verifier'].includes(actor)))];
    const roster = $('#actorRoster'); roster.replaceChildren();
    $('#actorCount').textContent = `${actors.length} ${actors.length === 1 ? 'ACTOR' : 'ACTORS'}`;
    const latest = new Map();
    state.events.slice(0,state.cursor).forEach((event) => latest.set(event.actor,event));
    actors.forEach((actor) => {
      const current = latest.get(actor);
      const meta = actorMeta(actor);
      const tone = eventTone(current);
      const filePath = state.model.actorFiles.get(actor);
      const ownsScope = state.model.leases.some((lease) => lease.agent_instance === actor);
      const card = el('button', `unit-card ${current ? tone : ownsScope ? 'good' : 'idle'}${current && state.events[state.cursor-1] === current ? ' active' : ''}${filePath ? ' has-file' : ''}`);
      card.type = 'button'; card.style.setProperty('--actor-color',actorColor(actor));
      card.addEventListener('click',() => { if (filePath) selectFile(filePath); });
      card.dataset.actor = actor;
      card.append(el('div','unit-badge',meta.badge));
      const info = el('div','unit-info');
      const nameRow = el('div','unit-name-row');
      nameRow.append(el('span','unit-name',actor)); nameRow.append(el('span','unit-role',meta.role));
      info.append(nameRow);
      const file = state.model.files.get(filePath);
      const statusText = !current && !ownsScope ? 'Standing by' : tone === 'denied' ? (current.test_run ? 'Regression caught · RED' : 'Action safely refused') : tone === 'failed' ? 'Simulation error' : file?.activity === 'editing' && file.leaseOwner === actor ? 'Editing · scope leased' : file?.activity === 'reviewing' && file.leaseOwner === actor ? 'Reviewing · scope leased' : ownsScope ? 'Scope leased · ready' : 'Scope released';
      info.append(el('div','unit-status',statusText));
      const bar = el('div','unit-bar'); bar.append(el('div','unit-bar-fill'));
      info.append(bar); info.append(el('div','unit-last',filePath?.split('/').at(-1) ?? current?.summary ?? 'Waiting for this actor'));
      card.append(info); roster.append(card);
    });
    if (!actors.length) roster.append(el('p','log-empty','Load a run to identify its actors.'));
  }
  function renderLog() {
    const root = $('#logList'); root.replaceChildren();
    const visible = state.events.slice(0,state.cursor);
    $('#logCount').textContent = `${visible.length} / ${state.events.length} EVENTS`;
    visible.forEach((event,index) => {
      const tone = eventTone(event);
      const item = el('button',`log-event ${tone}${index === state.cursor-1 ? ' current' : ''}`);
      item.type = 'button'; item.setAttribute('aria-current',index === state.cursor-1 ? 'step' : 'false');
      const rail = el('span','log-rail'); rail.append(el('span','log-dot')); item.append(rail);
      const body = el('span','log-event-body');
      const head = el('span','log-event-head'); head.append(el('span','log-actor',event.actor ?? 'unknown actor'));
      let time = '';
      if (event.at) { const date = new Date(event.at); time = Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString(); }
      head.append(el('time','log-time',time)); body.append(head);
      body.append(el('span','log-summary',event.summary ?? event.event ?? 'Recorded event'));
      if (event.path || event.outcome || event.exit_code !== undefined) {
        const detail = [event.path, event.outcome, event.exit_code !== undefined ? `exit ${event.exit_code}` : ''].filter(Boolean).join(' · ');
        body.append(el('span','log-detail',detail));
      }
      item.append(body);
      item.addEventListener('click',() => { pause(); stepTo(index+1,true); });
      root.append(item);
    });
    if (!visible.length) root.append(el('p','log-empty',state.events.length ? 'Press Play to replay the first action.' : 'Load a saved report or start the demo run.'));
    const current = state.events[state.cursor-1];
    $('#eventPhase').textContent = current ? phaseFor(current.event).toUpperCase() : 'AWAITING RUN';
    if (current && state.playing) root.scrollTop = root.scrollHeight;
  }
  function renderGuards() {
    const checks = state.verifier?.checks;
    const keys = Object.keys(labels).filter((key) => key !== 'all_expected_outcomes');
    const held = keys.filter((key) => checks?.[key] === true).length;
    const failed = keys.filter((key) => checks?.[key] === false).length;
    $('#auditState').textContent = checks ? `${held}/${keys.length} HELD` : 'PENDING';
    $('#auditState').style.removeProperty('color');
    document.querySelectorAll('.invariant-gauge').forEach((gauge) => {
      gauge.classList.remove('held','violated');
      const key = gauge.dataset.check;
      const value = checks?.[key];
      const resolved = typeof value === 'boolean';
      const stateLabel = gauge.querySelector('.gauge-state');
      if (!resolved) stateLabel.textContent = checks ? 'NOT RECORDED' : 'PENDING';
      else { gauge.classList.add(value ? 'held' : 'violated'); stateLabel.textContent = value ? 'HELD' : 'VIOLATED'; }
    });
    const banner = $('#resolutionBanner');
    const show = Boolean(state.verifier);
    banner.hidden = !show;
    if (show) {
      banner.classList.toggle('fail',!state.verifier.passed || failed > 0);
      banner.classList.toggle('incomplete',state.verifier.passed && held + failed < keys.length);
      $('#resolutionVerdict').textContent = `${state.verifier.passed && failed === 0 ? '' : 'FAIL · '}${held}/${keys.length} CHECKS HELD`;
      $('#resolutionDetail').textContent = state.verifier.error ? String(state.verifier.error).split('\n')[0] : `${state.verifier.event_count ?? state.events.length} events · ${state.demo ? 'Synthetic demonstration' : 'Recorded CLI simulation'}`;
    }
  }
  function renderHeader() {
    const done = state.events.length > 0 && state.cursor >= state.events.length;
    $('#runId').textContent = state.verifier?.run_id ?? state.events.find((event) => event.run_id)?.run_id ?? (state.demo ? 'DEMO-REPLAY' : '—');
    $('#sourceLabel').textContent = state.label || (state.demo ? 'SYNTHETIC DEMO' : 'NO RUN LOADED');
    $('#sourceLabel').classList.toggle('source-live',state.demo);
    const runState = $('#runState');
    const resolved = Boolean(state.verifier && (done || !state.events.length));
    runState.textContent = state.playing ? 'REPLAYING' : resolved ? (state.verifier.passed ? 'PASSED' : 'FAILED') : done ? 'REPLAY COMPLETE' : state.events.length ? 'READY' : 'WAITING';
    runState.className = `run-state ${resolved ? (state.verifier.passed ? 'pass' : 'fail') : ''}`;
    $('#scrub').max = String(state.events.length); $('#scrub').value = String(state.cursor);
    $('#scrubReadout').textContent = `${state.cursor} / ${state.events.length}`;
  }
  function renderPhases() {
    const current = state.events[state.cursor-1];
    const order = ['compete','handoff','review'];
    const activeIndex = current ? order.indexOf(phaseFor(current.event)) : -1;
    document.querySelectorAll('.phase').forEach((phase) => {
      const i = order.indexOf(phase.dataset.phase);
      phase.classList.toggle('active',i === activeIndex);
      phase.classList.toggle('done',activeIndex >= 0 && i < activeIndex);
    });
  }
  function render() {
    state.model = replay.derive(state.events,state.cursor);
    renderHeader(); renderPhases(); editor.render({state,el,actorMeta,actorColor,selectFile}); renderRoster(); renderLog(); renderGuards();
  }
  function stepTo(cursor,scroll) {
    state.cursor = Math.max(0,Math.min(state.events.length,cursor)); render();
    if (scroll && state.cursor) $('#logList').scrollTop = $('#logList').scrollHeight;
    if (state.cursor >= state.events.length) pause();
  }
  function play() {
    if (!state.events.length) return;
    if (state.cursor >= state.events.length) stepTo(0);
    state.playing = true; $('#playBtn').textContent = 'Ⅱ Pause'; renderHeader();
    const tick = () => {
      if (!state.playing) return;
      stepTo(state.cursor+1,true);
      const dwell = state.events[state.cursor-1]?.file?.operation === 'editing' ? 1800 : 650;
      if (state.playing) state.timer = setTimeout(tick,Math.max(65,dwell/state.speed));
    };
    state.timer = setTimeout(tick,100);
  }
  function pause() { state.playing = false; clearTimeout(state.timer); state.timer = null; $('#playBtn').textContent = '▶ Play'; renderHeader(); }
  function loadRun(events,verifier,label,demo=false) {
    pause(); state.events = events; state.verifier = verifier; state.cursor = 0; state.label = label; state.demo = demo;
    state.selectedFile = null; state.follow = true; state.collapsed.clear(); $('#followEditor').checked = true;
    render(); if (events.length) play();
  }
  function demoRun() {
    const start = Date.now();
    const events = [];
    let leases = [], handoffs = [];
    const add = (actor,event,summary,extra={}) => events.push({sequence:events.length+1,at:new Date(start+events.length*850).toISOString(),actor,event,summary,...extra,system:JSON.parse(JSON.stringify({leases,handoffs,protocol_version:'3',mutation_guard:'clear'}))});
    const file = (actor,event,path,scope,operation,content,before,from) => add(actor,event,actor + ' · ' + operation + ' · ' + path.split('/').at(-1),{path,file:{path,scope,operation,content,before,from}});
    add('simulation','run-start','Starting an isolated coding workspace.',{run_id:'DEMO-REPLAY'});
    add('orchestrator','workspace-seeded','Prepared the shared source tree.',{workspace:{scope_paths:scenario.scopePaths,files:[{path:'README.md',scope:'root',content:scenario.readme},{path:scenario.sourcePath,scope:'packages',content:scenario.initialSource}]}});
    leases = [{scope:'packages',agent_instance:'codex-writer',generation:'demo-writer-generation'}];
    add('codex-writer','scope-acquire','Acquired packages/ for the source change.',{exit_code:0});
    add('codex-contender','scope-acquire','Another writer already owns packages/.',{exit_code:3});
    leases.push({scope:'tests',agent_instance:'kiro-test-engineer',generation:'demo-tests-generation'});
    add('kiro-test-engineer','test-scope-acquire','Acquired tests/ independently.',{exit_code:0});
    file('kiro-test-engineer','file-edit-start',scenario.testPath,'tests','editing',scenario.testSource,'');
    file('kiro-test-engineer','test-file-saved',scenario.testPath,'tests','saved',scenario.testSource,'');
    add('kiro-test-engineer','tests-run','RED: the new regression exposes the missing review gate.',{exit_code:1,test_run:{passed:false,expected_failure:true,pass:2,fail:1,tests:3,output:'TAP version 13\nok 1 - allows a release after tests and review pass\nnot ok 2 - blocks a release before its review is approved\nok 3 - blocks a release when tests fail\n# pass 2\n# fail 1'}});
    add('codex-writer','lease-check-before-write','Checked the writer generation before editing.',{exit_code:0});
    file('codex-writer','file-edit-start',scenario.sourcePath,'packages','editing',scenario.completedSource,scenario.initialSource);
    file('codex-writer','write-fixture',scenario.sourcePath,'packages','saved',scenario.completedSource,scenario.initialSource);
    add('kiro-test-engineer','tests-run','GREEN: all three release checks now pass.',{exit_code:0,test_run:{passed:true,expected_failure:false,pass:3,fail:0,tests:3,output:'TAP version 13\nok 1 - allows a release after tests and review pass\nok 2 - blocks a release before its review is approved\nok 3 - blocks a release when tests fail\n# pass 3\n# fail 0'}});
    leases = leases.filter((lease) => lease.scope !== 'tests');
    add('kiro-test-engineer','test-scope-release','Released the tests scope.',{exit_code:0});
    leases = [];
    add('codex-writer','scope-release','Released packages/ before publishing review work.',{exit_code:0});
    add('codex-writer','stale-generation-probe','The released generation no longer authorizes edits.',{exit_code:4});
    const draft = '.trinoris/handoff/drafts/review.md', inbox = '.trinoris/handoff/for-claude-opus-5/review.md', active = '.trinoris/active/claude-reviewer-a/review.md', archive = '.trinoris/archive/review.md';
    const note = '# Release policy review\n\nStatus: ready-for-review\n\n## Changes\nRequire both passing tests and approved review.\n\n## Verification\nThe new regression was RED before the change and GREEN afterward.\n';
    handoffs = [{path:draft,stage:'draft',to_class:'claude-opus-5',status:'ready-for-review'}];
    file('codex-writer','handoff-drafted',draft,null,'saved',note);
    handoffs = [{path:inbox,stage:'inbox',to_class:'claude-opus-5',status:'ready-for-review'}];
    file('codex-writer','handoff-publish',inbox,null,'moved',note,undefined,draft);
    add('kiro-outsider','wrong-recipient-claim','Claim refused: the handoff is addressed to Claude.',{exit_code:1});
    handoffs = [{path:active,stage:'active',owner:'claude-reviewer-a',status:'ready-for-review'}];
    file('claude-reviewer-a','handoff-claim-race',active,null,'moved',note,undefined,inbox);
    events.at(-1).exit_code = 0;
    add('claude-reviewer-b','handoff-claim-race','The other reviewer did not win this claim.',{exit_code:3});
    leases = [{scope:'packages',agent_instance:'claude-reviewer-a',generation:'demo-review-generation'}];
    add('claude-reviewer-a','review-scope-acquire','Reviewer acquired its own packages/ generation.',{exit_code:0});
    file('claude-reviewer-a','review-fixture',scenario.sourcePath,'packages','reviewing',scenario.completedSource,scenario.initialSource);
    leases = [];
    add('claude-reviewer-a','review-scope-release','Released the review scope.',{exit_code:0});
    handoffs = [{path:archive,stage:'archive',owner:'claude-reviewer-a',status:'complete'}];
    file('claude-reviewer-a','handoff-archived',archive,null,'moved',note.replace('ready-for-review','complete'),undefined,active);
    const checks = Object.fromEntries(Object.keys(labels).map((key) => [key,true]));
    add('verifier','run-complete','PASS: all recorded checks held.',{passed:true,checks,focus:scenario.sourcePath});
    loadRun(events,{schema_version:1,run_id:'DEMO-REPLAY',scenario:'Source and test scopes, a RED-to-GREEN change, and an archived review.',passed:true,checks,event_count:events.length},'SYNTHETIC DEMO',true);
  }
  function parseReport(text) {
    const events = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    validateEvents(events);
    return events;
  }
  function validateEvents(events) {
    if (!Array.isArray(events) || events.length > 10000 || events.some((event) => !event || typeof event.actor !== 'string' || typeof event.event !== 'string')) throw new Error('Invalid event report.');
  }
  function validateVerifier(verifier,events) {
    if (!verifier || typeof verifier.passed !== 'boolean' || !verifier.checks || typeof verifier.checks !== 'object' || Array.isArray(verifier.checks)) throw new Error('Invalid verifier result.');
    const runId = events.find((event) => event.run_id)?.run_id;
    if (runId && verifier.run_id !== runId) throw new Error('Report and verifier belong to different runs.');
  }
  function showLoadMessage(message) {
    $('#loadMessage').textContent = message;
    $('#loadMessage').hidden = !message;
  }
  async function loadLatest(fallback=false) {
    const version = ++state.loadVersion;
    $('#latestBtn').disabled = true;
    showLoadMessage('Loading latest saved run…');
    try {
      const bundle = await new Promise((resolve,reject) => {
        const script = document.createElement('script');
        const url = new URL('../artifacts/latest.js',location.href);
        url.searchParams.set('v',String(Date.now()));
        const timer = setTimeout(() => { script.remove(); reject(new Error('Loading the latest run timed out.')); },8000);
        delete globalThis.TRINORIS_SIMULATION_RUN;
        script.src = url.href;
        script.onload = () => { clearTimeout(timer); script.remove(); resolve(globalThis.TRINORIS_SIMULATION_RUN); };
        script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('No saved run found. Run pnpm simulate first.')); };
        document.head.append(script);
      });
      if (version !== state.loadVersion) return;
      if (bundle?.schema_version !== 1) throw new Error('Unsupported replay bundle.');
      validateEvents(bundle.events); validateVerifier(bundle.verifier,bundle.events);
      if (bundle.verifier.event_count !== bundle.events.length) throw new Error('Replay event count does not match the verifier.');
      loadRun(bundle.events,bundle.verifier,'LATEST SAVED RUN');
      showLoadMessage('');
    } catch (error) {
      if (version !== state.loadVersion) return;
      if (fallback) demoRun();
      showLoadMessage(`${error.message}${fallback ? ' Showing the synthetic demo.' : ''}`);
    } finally { $('#latestBtn').disabled = false; }
  }
  $('#playBtn').addEventListener('click',() => state.playing ? pause() : play());
  $('#followEditor').addEventListener('change',(event) => { state.follow = event.target.checked; render(); });
  for (const id of ['activityTab','outputTab']) $(('#' + id)).addEventListener('click',() => {
    const output = id === 'outputTab';
    $('#logList').hidden = output; $('#commandOutput').hidden = !output;
    for (const tab of ['activityTab','outputTab']) { $('#' + tab).classList.toggle('active',tab === id); $('#' + tab).setAttribute('aria-selected',String(tab === id)); }
  });
  $('#scrub').addEventListener('input',(event) => { const cursor = Number(event.target.value); pause(); stepTo(cursor,true); });
  document.querySelectorAll('.speed-btn').forEach((button) => button.addEventListener('click',() => {
    document.querySelectorAll('.speed-btn').forEach((entry) => entry.classList.remove('active'));
    button.classList.add('active'); state.speed = Number(button.dataset.speed);
  }));
  $('#demoBtn').addEventListener('click',() => { ++state.loadVersion; showLoadMessage(''); demoRun(); });
  $('#latestBtn').addEventListener('click',() => loadLatest());
  $('#reportInput').addEventListener('change',async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    ++state.loadVersion;
    try {
      const events = parseReport(await file.text());
      const reportRunId = events.find((item) => item.run_id)?.run_id;
      if (state.verifier?.run_id !== reportRunId) state.verifier = null;
      showLoadMessage('');
      state.label = file.name; state.events = events; state.cursor = 0; state.demo = false; pause(); render(); play();
    } catch {
      pause(); state.events = []; state.verifier = null; state.cursor = 0; render();
      $('#sourceLabel').textContent = 'INVALID REPORT'; $('#runState').textContent = 'LOAD ERROR'; $('#runState').className = 'run-state fail';
    }
  });
  $('#resultInput').addEventListener('change',async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    ++state.loadVersion;
    try {
      const verifier = JSON.parse(await file.text());
      const events = state.demo ? [] : state.events;
      validateVerifier(verifier,events);
      if (state.demo) pause();
      state.events = events; state.demo = false; state.verifier = verifier;
      showLoadMessage(''); if (!events.length) state.label = file.name; render();
    }
    catch (error) { state.verifier = null; render(); showLoadMessage(error.message); }
  });
  render();
  loadLatest(true);
})();
