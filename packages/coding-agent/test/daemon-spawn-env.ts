import { ORPHAN_PROCESS_JOURNAL_ENV } from "../src/core/orphan-process-journal.js";
import { SESSION_LEASE_OWNER_ID_ENV, SESSION_LEASES_ENABLED_ENV } from "../src/core/session-lease.js";
import {
	DAEMON_WORKER_ACTIVE_SESSION_ID_ENV,
	DAEMON_WORKER_RECOVERY_JOURNAL_ENV,
	DAEMON_WORKER_ROLE_ENV,
	DAEMON_WORKER_SUPERVISOR_SOCKET_ENV,
	DAEMON_WORKER_TOKEN_ENV,
} from "../src/modes/daemon/daemon-worker-protocol.js";

/**
 * Base env for spawning a root daemon subprocess. The test runner may itself
 * live inside a daemon worker (agent-driven test runs); stale worker/lease env
 * inherited through `process.env` would silently flip the spawned daemon into
 * worker mode. Mirrors the production spawn cleanup in AgentDaemon.
 */
export function createRootDaemonEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	delete env[DAEMON_WORKER_ROLE_ENV];
	delete env[DAEMON_WORKER_TOKEN_ENV];
	delete env[DAEMON_WORKER_ACTIVE_SESSION_ID_ENV];
	delete env[DAEMON_WORKER_RECOVERY_JOURNAL_ENV];
	delete env[DAEMON_WORKER_SUPERVISOR_SOCKET_ENV];
	delete env[ORPHAN_PROCESS_JOURNAL_ENV];
	delete env[SESSION_LEASES_ENABLED_ENV];
	delete env[SESSION_LEASE_OWNER_ID_ENV];
	delete env.RLM_DEPTH;
	return { ...env, ...overrides };
}
