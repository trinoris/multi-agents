<!--
© 2026 TRINORIS. All rights reserved.
Proprietary and confidential.
-->

# Heartbeat, daemon, and network coordination threat review

**Status:** Decision — keep these capabilities out of protocol 3  
**Reviewed:** 2026-10-26  
**Scope:** `@trinoris/agent-core`, `@trinoris/agent-sdk`, and `@trinoris/agent-cli`

## Decision

Do not add automatic heartbeat renewal, a background daemon, or network coordination to
protocol 3. The package coordinates cooperating agents that share one local working tree;
each agent explicitly acquires, checks, renews, and releases a generation-scoped lease.
Handoffs communicate work between discrete agent sessions.

The current design already gives an explicit recovery path for an abandoned agent: wait
until the lease expiry and grace period, inspect the recorded state, stop the old actor when
possible, and perform a guarded takeover. Automatic liveness signals would not make this
recovery safer under the current trust model.

## Threat model

The coordination directory is writable by the agents and other processes that can write to
the checkout. The protocol is advisory. Agent identity, heartbeat files, leases, and
incident records are ordinary local data; they authenticate no actor and cannot prevent an
uncooperative process or editor from changing protected files.

The supported environment assumes one machine and a filesystem whose required atomic
operations have been verified. Wall-clock lease comparisons depend on that assumption.
Multiple machines, independent clones, and network partitions are outside the protocol 3
boundary.

## Why automatic heartbeat renewal is unsafe here

- A heartbeat proves at most that a process can still write a file. It does not prove that
  the agent is responsive, still working on the task, or authorized to keep the scope.
- A wrapper may remain alive after the model session has failed, been cancelled, or lost its
  working context. It could renew a lease indefinitely and block recovery from a dead task.
- Sleep, host suspension, long tool calls, and filesystem delays create false-dead signals.
  Treating a missed heartbeat as permission to break a lease could evict an agent that later
  resumes and writes.
- A peer with write access can forge or replay heartbeat data. Freshness timestamps do not
  supply authenticity, and a secret stored beside the heartbeat would be available to the
  same local writer.
- A heartbeat does not fence a paused writer. A client can pass a lease check, pause, lose
  its lease, then resume and edit. Only an enforcing write path or isolated working trees
  can prevent that stale write.

The current manual `renew` operation is tied to the exact instance and generation and is
performed by an active client. It is bounded by the original lease rules and does not
silently convert process liveness into authority.

## Why a daemon is not a safe extension

A daemon would add long-lived state, startup and shutdown semantics, crash recovery,
identity binding, log and credential handling, upgrade behavior, and an autonomous lease
renewal policy. Its process lifetime would still not match the lifecycle of an external
agent session. If it renewed on behalf of a session, a stale daemon could retain scopes
after the agent stopped; if it stopped renewing on uncertainty, it could cause a live
agent's lease to expire. Neither outcome is resolved by a PID file or a local heartbeat.

Protocol 3 intentionally has no scheduling or waiting loop. An agent that cannot acquire a
scope chooses other work or hands off; it does not stay resident polling for availability.
A daemon would add that behavior and weaken the no-spin operational rule unless designed as
a separate, user-visible orchestration service.

## Why network coordination needs a different system

The local atomic-directory primitive, shared clock assumption, and local identity metadata
do not transfer to multiple machines. A network filesystem or shared heartbeat directory
does not establish transactional ownership during partitions or establish which host may
write after an ownership change.

Multi-host coordination requires a central service that provides authenticated principals,
transactional lease mutation, monotonically increasing fencing tokens, and an enforcement
point that rejects writes carrying stale tokens. It also needs explicit partition,
availability, audit-retention, and recovery policies. Those requirements are outside the
purpose and trust boundary of this package. Use a task orchestrator or a dedicated
coordination service for that deployment model; do not extend the local file protocol by
adding shared heartbeat files.

## Reopen criteria

Reconsider this decision only when a concrete product requirement cannot be met by explicit
lease operations and handoffs. A new proposal must first define:

1. The actor whose liveness is being measured (agent process, model session, or task owner).
2. How the lease owner is authenticated and how stale owners are fenced from writes.
3. False-positive and false-negative behavior during suspension, slow work, crashes, and
   network partitions.
4. Bounded renewal, cancellation, shutdown, restart, and recovery semantics.
5. The persistence and audit model, including who may create, alter, or delete liveness
   records.
6. A protocol-version migration and adversarial tests on every supported filesystem or
   coordination backend.

Until those conditions have an approved design, protocol 3 must keep
`heartbeat.enabled: false`, reject enabled heartbeat configuration, and provide no daemon
or network coordination API.

## Implementation note

Setup currently creates an empty `.trinoris/heartbeat/` directory even though no heartbeat
writer or reader exists and the capability is disabled. This directory has no authority
and is not used for recovery. Treat it as inert compatibility residue, not evidence of
support. It is not a security or release blocker; any future layout cleanup should be a
separate TDD change and must not introduce automatic renewal.
