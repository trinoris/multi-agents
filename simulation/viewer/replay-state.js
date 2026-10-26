(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrinorisWorkspaceReplay = factory();
})(globalThis, function () {
  const validPath = (path) => typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.split('/').some((part) => part === '..' || part === '');
  function derive(events, cursor) {
    const state = { files: new Map(), leases: [], handoffs: [], scopePaths: { packages: ['packages/'], tests: ['tests/'] }, focus: null, actorFiles: new Map(), latest: new Map(), testRun: null, blocked: 0, hasSnapshots: false, mutationGuard: 'not recorded', protocol: null };
    for (const event of events.slice(0, Math.max(0, cursor))) {
      state.latest.set(event.actor, event);
      if (event.workspace?.scope_paths) state.scopePaths = event.workspace.scope_paths;
      for (const file of event.workspace?.files ?? []) {
        if (validPath(file.path)) state.files.set(file.path, { ...file, recorded: typeof file.content === 'string', activity: 'saved', author: null });
      }
      if (event.system) {
        state.hasSnapshots = true;
        state.leases = Array.isArray(event.system.leases) ? event.system.leases.map((lease) => ({ ...lease })) : [];
        state.handoffs = Array.isArray(event.system.handoffs) ? event.system.handoffs.map((handoff) => ({ ...handoff })) : [];
        state.mutationGuard = event.system.mutation_guard ?? 'not recorded';
        state.protocol = event.system.protocol_version ?? state.protocol;
      }
      if (['wrong-recipient-claim', 'stale-generation-probe'].includes(event.event) || ((event.event === 'scope-acquire' || event.event === 'handoff-claim-race') && event.exit_code !== 0)) state.blocked++;
      const delta = event.file ?? (event.path ? { path: event.path } : null);
      if (delta && validPath(delta.path)) {
        if (delta.from && delta.from !== delta.path) state.files.delete(delta.from);
        const prior = state.files.get(delta.path) ?? {};
        const content = delta.content ?? prior.content;
        const scope = delta.scope ?? prior.scope ?? Object.entries(state.scopePaths).find(([, paths]) => paths.some((prefix) => delta.path.startsWith(prefix)))?.[0] ?? null;
        const changed = ['editing', 'saved'].includes(delta.operation);
        const file = { ...prior, ...delta, path: delta.path, scope, content, recorded: typeof content === 'string', activity: delta.operation ?? 'saved', lastActor: event.actor, author: changed ? event.actor : prior.author ?? null };
        state.files.set(delta.path, file);
        state.actorFiles.set(event.actor, delta.path);
        state.focus = delta.path;
      }
      if (event.test_run) state.testRun = { ...event.test_run, actor: event.actor };
      if (event.focus && state.files.has(event.focus)) state.focus = event.focus;
      for (const file of state.files.values()) {
        const lease = state.leases.find((item) => item.scope === file.scope);
        file.leaseOwner = lease?.agent_instance ?? null;
        file.generation = lease?.generation ?? null;
        if (['editing', 'reviewing'].includes(file.activity) && file.leaseOwner !== file.lastActor) file.activity = 'saved';
      }
    }
    return state;
  }
  return { derive };
});
