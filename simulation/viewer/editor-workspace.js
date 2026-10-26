globalThis.TrinorisEditorWorkspace = (() => {
  const $ = (selector) => document.querySelector(selector);
  function render(context) {
    const { state } = context;
    const model = state.model;
    if (state.follow && model.focus) state.selectedFile = model.focus;
    if (!model.files.has(state.selectedFile)) state.selectedFile = [...model.files.keys()].find((path) => path.endsWith('.mjs')) ?? [...model.files.keys()][0] ?? null;
    renderTree(context); renderEditor(context); renderSystem(context);
  }
  function renderTree({state,el,actorMeta,actorColor,selectFile}) {
    const model = state.model;
    const root = { children:new Map() };
    function addPath(path,file) {
      let node = root;
      path.split('/').forEach((name,index,parts) => {
        if (!node.children.has(name)) node.children.set(name,{name,path:parts.slice(0,index+1).join('/'),children:new Map()});
        node = node.children.get(name);
      });
      if (file) node.file = file;
    }
    for (const file of model.files.values()) addPath(file.path,file);
    for (const paths of Object.values(model.scopePaths)) for (const prefix of paths) if (prefix.endsWith('/')) addPath(prefix.slice(0,-1));
    const container = $('#fileTree'); container.replaceChildren();
    $('#fileCount').textContent = model.files.size + ' files';
    function appendNodes(parent,depth) {
      const nodes = [...parent.children.values()].sort((a,b) => Number(Boolean(a.file))-Number(Boolean(b.file)) || a.name.localeCompare(b.name));
      for (const node of nodes) {
        const file = node.file;
        const scope = file?.scope ?? Object.entries(model.scopePaths).find(([,paths]) => paths.some((prefix) => node.path === prefix.replace(/\/$/,'') || node.path.startsWith(prefix)))?.[0];
        const lease = model.leases.find((entry) => entry.scope === scope);
        const editing = file?.activity === 'editing' && file.leaseOwner;
        const reviewing = file?.activity === 'reviewing' && file.leaseOwner;
        const row = el('button','tree-row' + (file && state.selectedFile === file.path ? ' selected' : '') + (lease ? ' leased' : '') + (editing ? ' editing' : '') + (reviewing ? ' reviewing' : ''));
        row.type = 'button'; row.dataset.path = node.path; row.style.paddingLeft = (9+depth*11) + 'px';
        row.title = node.path + (lease ? ' · ' + scope + ' scope leased by ' + lease.agent_instance : model.hasSnapshots ? ' · scope available' : ' · scope ownership not recorded') + (editing ? ' · editing' : '');
        row.append(el('span','tree-icon',file ? (file.path.endsWith('.md') ? 'MD' : file.path.includes('.test.') ? 'T' : 'JS') : state.collapsed.has(node.path) ? '›' : '⌄'));
        row.append(el('span','tree-name',node.name));
        if (file && (editing || reviewing)) {
          const badge = el('span','tree-actor',actorMeta(file.lastActor).badge);
          badge.style.setProperty('--actor-color',actorColor(file.lastActor)); row.append(badge);
        } else if (lease) row.append(el('span','tree-lock','◇'));
        if (file) { row.setAttribute('aria-current',String(state.selectedFile === file.path)); row.addEventListener('click',() => selectFile(file.path)); }
        else {
          row.setAttribute('aria-expanded',String(!state.collapsed.has(node.path)));
          row.addEventListener('click',() => { if (state.collapsed.has(node.path)) state.collapsed.delete(node.path); else state.collapsed.add(node.path); renderTree({state,el,actorMeta,actorColor,selectFile}); });
        }
        container.append(row);
        if (!file && lease && model.scopePaths[scope]?.includes(node.path + '/')) container.append(el('span','tree-scope-owner',lease.agent_instance));
        if (!file && !state.collapsed.has(node.path)) appendNodes(node,depth+1);
      }
    }
    appendNodes(root,0);
    if (!root.children.size) container.append(el('p','log-empty','Workspace not created yet.'));
  }
  function appendHighlighted(parent,line,path,el) {
    if (path.endsWith('.md')) { parent.append(document.createTextNode(line)); return; }
    const pattern = /(\/\/.*$|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:export|import|from|function|return|const|let|if|else|true|false|test)\b|\b\d+\b)/g;
    let last = 0;
    for (const match of line.matchAll(pattern)) {
      parent.append(document.createTextNode(line.slice(last,match.index)));
      const token = match[0];
      const kind = token.startsWith('//') ? 'comment' : /^['"]/.test(token) ? 'string' : /^\d/.test(token) ? 'number' : 'keyword';
      parent.append(el('span','token-' + kind,token)); last = match.index+token.length;
    }
    parent.append(document.createTextNode(line.slice(last)));
  }
  function renderEditor({state,el,actorColor,selectFile}) {
    const model = state.model;
    const selected = model.files.get(state.selectedFile);
    const tabs = $('#editorTabs'); tabs.replaceChildren();
    const paths = [...model.files.keys()].filter((path) => !path.endsWith('.md') || path === state.selectedFile);
    for (const path of paths) {
      const file = model.files.get(path);
      const tab = el('button','editor-tab',path.split('/').at(-1)); tab.type = 'button';
      tab.setAttribute('role','tab'); tab.setAttribute('aria-selected',String(path === state.selectedFile));
      tab.setAttribute('aria-controls','codeViewport'); tab.tabIndex = path === state.selectedFile ? 0 : -1;
      tab.style.setProperty('--actor-color',actorColor(file.leaseOwner ?? file.lastActor));
      if (file.activity === 'editing') tab.append(el('span','tab-state','●'));
      tab.addEventListener('click',() => selectFile(path));
      tab.addEventListener('keydown',(event) => {
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault(); selectFile(paths[(paths.indexOf(path)+(event.key === 'ArrowRight' ? 1 : -1)+paths.length)%paths.length]);
        $('#editorTabs [aria-selected=true]')?.focus();
      });
      tabs.append(tab);
    }
    const code = $('#codeLines'); code.replaceChildren();
    if (!selected) {
      $('#editorBreadcrumb').textContent = 'Workspace not created yet'; $('#editorOwner').textContent = 'Waiting for an actor';
      $('#editorFileState').textContent = 'Replay to see files appear'; $('#editorLanguage').textContent = '—';
      code.append(el('p','log-empty','Files and editing buffers appear at their recorded step.')); return;
    }
    $('#editorBreadcrumb').textContent = selected.path;
    const mode = selected.activity === 'editing' ? 'Editing' : selected.activity === 'reviewing' ? 'Reviewing' : selected.leaseOwner ? 'Scope leased' : 'Saved';
    const actor = selected.leaseOwner ?? selected.lastActor;
    $('#editorOwner').textContent = actor ? mode + ' · ' + actor : 'Available';
    $('#editorOwner').style.setProperty('--actor-color',actorColor(actor));
    $('#editorLanguage').textContent = selected.path.endsWith('.md') ? 'Markdown' : selected.path.endsWith('.mjs') ? 'JavaScript · UTF-8' : 'Plain text';
    $('#editorFileState').textContent = !selected.recorded ? 'Content was not recorded in this run' : selected.activity === 'editing' ? 'Unsaved buffer · lease checked' : selected.activity === 'reviewing' ? 'Read-only review · recorded content' : 'Saved snapshot';
    if (!selected.recorded) { code.append(el('p','log-empty','This older run records the path but not its file contents.')); return; }
    const lines = selected.content.split('\n');
    const before = new Set((selected.before ?? selected.content).split('\n'));
    const changed = lines.map((line,index) => !before.has(line) ? index : -1).filter((index) => index >= 0);
    lines.forEach((line,index) => {
      const added = changed.includes(index);
      const active = selected.activity === 'editing' && index === changed.at(-1);
      const row = el('div','code-line' + (added ? ' added' : '') + (active ? ' editing-line' : ''));
      row.append(el('span','line-number',index+1)); row.append(el('span','line-marker',added ? '+' : ''));
      const content = el('span','line-content'); appendHighlighted(content,line,selected.path,el);
      if (active) content.append(el('span','editor-caret'));
      row.append(content); code.append(row);
    });
  }
  function renderSystem({state,el,actorColor}) {
    const model = state.model;
    $('#stateEvent').textContent = 'EVENT ' + state.cursor;
    $('#leaseCount').textContent = model.leases.length; $('#blockedCount').textContent = model.blocked;
    $('#snapshotSource').textContent = model.hasSnapshots ? (state.demo ? 'DEMO' : 'RECORDED') : 'NOT RECORDED';
    $('#protocolVersion').textContent = model.protocol ?? '—'; $('#mutationState').textContent = model.mutationGuard;
    const leaseList = $('#leaseList'); leaseList.replaceChildren();
    for (const scope of [...new Set(['packages','tests',...model.leases.map((lease) => lease.scope)])]) {
      const lease = model.leases.find((entry) => entry.scope === scope);
      const card = el('div','lease-card' + (lease ? '' : ' available'));
      card.dataset.scope = scope;
      const head = el('div','lease-head',scope + '/'); head.append(el('span','',lease ? 'LEASED' : model.hasSnapshots ? 'AVAILABLE' : 'UNKNOWN')); card.append(head);
      if (lease) {
        const owner = el('span','lease-owner',lease.agent_instance); owner.style.setProperty('--actor-color',actorColor(lease.agent_instance)); card.append(owner);
        card.append(el('span','lease-token','generation · ' + String(lease.generation ?? 'unknown').slice(0,12)));
      }
      leaseList.append(card);
    }
    const handoff = $('#handoffState'); handoff.replaceChildren();
    const note = model.handoffs.at(-1);
    if (note) {
      handoff.append(el('span','handoff-stage ' + note.stage,note.stage === 'archive' ? 'Completed · archived' : note.stage === 'active' ? 'Claimed · review in progress' : note.stage === 'inbox' ? 'Ready for reviewer' : 'Draft'));
      handoff.append(el('span','handoff-owner',note.owner ?? note.to_class ?? 'No assignee'));
      handoff.append(el('span','handoff-path',note.path));
    } else handoff.append(document.createTextNode(model.hasSnapshots ? 'No handoff yet.' : 'No handoff snapshot recorded.'));
    const test = model.testRun;
    const label = !test ? 'NOT RUN' : test.passed ? 'GREEN' : test.expected_failure ? 'RED EXPECTED' : 'FAILED';
    for (const selector of ['#systemTests','#testOutputStatus']) {
      $(selector).textContent = label;
      $(selector).className = !test ? '' : test.passed ? 'status-green' : test.expected_failure ? 'status-red' : 'status-failed';
    }
    $('#testSummary').textContent = !test ? 'Waiting for the regression.' : (test.pass ?? 0) + ' passed · ' + (test.fail ?? 0) + ' failed' + (test.expected_failure ? ' · before source fix' : '');
    $('#commandOutput').textContent = test?.output ?? 'No test command has run at this point in the replay.';
  }
  return { render };
})();
