import { spawnSync } from 'node:child_process';
import { app } from 'electron';
import { loggerFactory } from './logger';

const DEFAULT_INTERVAL_MS = 15_000;
const MAX_LOGGED_PROCESSES = 40;
const COMMAND_MAX_CHARS = 240;

const resourceLogger = loggerFactory.getLogger('resource');

export type ResourceOwnerKind = 'agent' | 'harness';

export interface ResourceOwner {
  kind: ResourceOwnerKind;
  component: string;
  sessionId?: string;
  engineId?: string;
  label?: string;
  startedAt?: number;
}

export interface BrowserSessionResource {
  sessionId: string;
  attached: boolean;
  createdAt: number;
  pid: number;
}

export interface SessionResourceInfo {
  prompt?: string;
  status?: string;
  engine?: string | null;
}

export interface ResourceMonitorContext {
  browserSessions: () => BrowserSessionResource[];
  sessionInfo: (sessionId: string) => SessionResourceInfo | undefined;
}

export interface ResourceProcessUsage {
  pid: number;
  ppid?: number;
  source: 'electron' | 'os';
  kind: string;
  component: string;
  label: string;
  type?: string;
  sessionId?: string;
  engineId?: string;
  cpuPercent: number;
  rssMb: number;
  privateMb?: number;
  command?: string;
}

export interface ResourceSnapshot {
  total: {
    rssMb: number;
    cpuPercent: number;
    processCount: number;
    electronProcessCount: number;
    externalProcessCount: number;
  };
  byKind: Record<string, { rssMb: number; cpuPercent: number; processCount: number }>;
  bySession: Record<string, {
    rssMb: number;
    cpuPercent: number;
    processCount: number;
    status?: string;
    engine?: string | null;
    label: string;
  }>;
  processes: ResourceProcessUsage[];
  errors: string[];
}

interface OsProcessRow {
  pid: number;
  ppid: number;
  cpuPercent: number;
  rssKb: number;
  command: string;
}

const owners = new Map<number, ResourceOwner>();
let monitorTimer: ReturnType<typeof setInterval> | null = null;

export function registerResourceOwner(pid: number | undefined, owner: ResourceOwner): void {
  if (!pid || pid <= 0) return;
  owners.set(pid, {
    ...owner,
    startedAt: owner.startedAt ?? Date.now(),
  });
}

export function unregisterResourceOwner(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  owners.delete(pid);
}

export function startResourceMonitor(ctx: ResourceMonitorContext, intervalMs = readIntervalMs()): void {
  if (intervalMs <= 0) {
    resourceLogger.info('resource.monitor.disabled', { intervalMs });
    return;
  }
  if (monitorTimer) return;

  resourceLogger.info('resource.monitor.started', {
    intervalMs,
    topProcessLimit: MAX_LOGGED_PROCESSES,
  });

  logResourceSnapshot(ctx, intervalMs);
  monitorTimer = setInterval(() => {
    logResourceSnapshot(ctx, intervalMs);
  }, intervalMs);
  (monitorTimer as { unref?: () => void }).unref?.();
}

export function stopResourceMonitor(): void {
  if (!monitorTimer) return;
  clearInterval(monitorTimer);
  monitorTimer = null;
  resourceLogger.info('resource.monitor.stopped');
}

export function snapshotResourceUsage(ctx: ResourceMonitorContext): ResourceSnapshot {
  const errors: string[] = [];
  const processes: ResourceProcessUsage[] = [];
  const electronPids = new Set<number>();
  const browserSessionByPid = new Map<number, BrowserSessionResource>();

  for (const session of ctx.browserSessions()) {
    if (session.pid > 0) browserSessionByPid.set(session.pid, session);
  }

  for (const processUsage of readElectronUsage(ctx, browserSessionByPid, errors)) {
    processes.push(processUsage);
    electronPids.add(processUsage.pid);
  }

  for (const processUsage of readExternalUsage(ctx, electronPids, errors)) {
    processes.push(processUsage);
  }

  processes.sort((a, b) => b.rssMb - a.rssMb || b.cpuPercent - a.cpuPercent);

  const snapshot: ResourceSnapshot = {
    total: {
      rssMb: round1(sum(processes, (p) => p.rssMb)),
      cpuPercent: round1(sum(processes, (p) => p.cpuPercent)),
      processCount: processes.length,
      electronProcessCount: processes.filter((p) => p.source === 'electron').length,
      externalProcessCount: processes.filter((p) => p.source === 'os').length,
    },
    byKind: {},
    bySession: {},
    processes,
    errors,
  };

  for (const processUsage of processes) {
    addAggregate(snapshot.byKind, processUsage.kind, processUsage);
    if (processUsage.sessionId) {
      const info = ctx.sessionInfo(processUsage.sessionId);
      const existing = snapshot.bySession[processUsage.sessionId] ?? {
        rssMb: 0,
        cpuPercent: 0,
        processCount: 0,
        status: info?.status,
        engine: info?.engine,
        label: sessionLabel(processUsage.sessionId, info),
      };
      existing.rssMb = round1(existing.rssMb + processUsage.rssMb);
      existing.cpuPercent = round1(existing.cpuPercent + processUsage.cpuPercent);
      existing.processCount += 1;
      snapshot.bySession[processUsage.sessionId] = existing;
    }
  }

  return snapshot;
}

function logResourceSnapshot(ctx: ResourceMonitorContext, intervalMs: number): void {
  const snapshot = snapshotResourceUsage(ctx);
  resourceLogger.info('resource.snapshot', {
    intervalMs,
    total: snapshot.total,
    byKind: snapshot.byKind,
    bySession: snapshot.bySession,
    topProcesses: snapshot.processes.slice(0, MAX_LOGGED_PROCESSES),
    errors: snapshot.errors,
  });
}

function readElectronUsage(
  ctx: ResourceMonitorContext,
  browserSessionByPid: Map<number, BrowserSessionResource>,
  errors: string[],
): ResourceProcessUsage[] {
  const getMetrics = (app as unknown as {
    getAppMetrics?: () => Array<{
      pid: number;
      type?: string;
      memory?: { workingSetSize?: number; privateBytes?: number };
      cpu?: { percentCPUUsage?: number };
    }>;
  }).getAppMetrics;
  if (typeof getMetrics !== 'function') return [];

  let metrics: ReturnType<NonNullable<typeof getMetrics>>;
  try {
    metrics = getMetrics.call(app);
  } catch (err) {
    errors.push(`electron_metrics_failed:${(err as Error).message}`);
    return [];
  }

  return metrics.map((metric) => {
    const session = browserSessionByPid.get(metric.pid);
    const info = session ? ctx.sessionInfo(session.sessionId) : undefined;
    const type = metric.type ?? 'unknown';
    const kind = session ? 'browser-session' : electronKind(type);
    const label = session
      ? sessionLabel(session.sessionId, info)
      : `electron:${type}`;

    return {
      pid: metric.pid,
      source: 'electron' as const,
      kind,
      component: type,
      label,
      type,
      sessionId: session?.sessionId,
      engineId: info?.engine ?? undefined,
      cpuPercent: round1(metric.cpu?.percentCPUUsage ?? 0),
      rssMb: kbToMb(metric.memory?.workingSetSize ?? 0),
      privateMb: metric.memory?.privateBytes == null ? undefined : kbToMb(metric.memory.privateBytes),
    };
  });
}

function readExternalUsage(
  ctx: ResourceMonitorContext,
  electronPids: Set<number>,
  errors: string[],
): ResourceProcessUsage[] {
  const table = readOsProcessTable(errors);
  if (table.size === 0) return [];

  const childrenByPid = new Map<number, OsProcessRow[]>();
  for (const row of table.values()) {
    const children = childrenByPid.get(row.ppid) ?? [];
    children.push(row);
    childrenByPid.set(row.ppid, children);
  }

  const out: ResourceProcessUsage[] = [];
  const included = new Set<number>();

  for (const [pid, owner] of owners.entries()) {
    const root = table.get(pid);
    if (!root) continue;
    for (const row of collectProcessTree(root, childrenByPid)) {
      addOsUsage(out, included, electronPids, row, ownerForRow(owner, row.pid !== pid), ctx);
    }
  }

  for (const row of table.values()) {
    const owner = harnessOwnerFromCommand(row.command);
    if (!owner) continue;
    addOsUsage(out, included, electronPids, row, owner, ctx);
  }

  return out;
}

function addOsUsage(
  out: ResourceProcessUsage[],
  included: Set<number>,
  electronPids: Set<number>,
  row: OsProcessRow,
  owner: ResourceOwner,
  ctx: ResourceMonitorContext,
): void {
  if (included.has(row.pid) || electronPids.has(row.pid)) return;
  included.add(row.pid);
  const info = owner.sessionId ? ctx.sessionInfo(owner.sessionId) : undefined;
  out.push({
    pid: row.pid,
    ppid: row.ppid,
    source: 'os',
    kind: owner.kind,
    component: owner.component,
    label: owner.label ?? (owner.sessionId ? sessionLabel(owner.sessionId, info) : owner.component),
    sessionId: owner.sessionId,
    engineId: owner.engineId ?? info?.engine ?? undefined,
    cpuPercent: round1(row.cpuPercent),
    rssMb: kbToMb(row.rssKb),
    command: truncate(row.command, COMMAND_MAX_CHARS),
  });
}

function readOsProcessTable(errors: string[]): Map<number, OsProcessRow> {
  if (process.platform === 'win32') {
    return new Map();
  }

  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pcpu=,rss=,command='], {
    encoding: 'utf8',
    timeout: 2_500,
  });

  if (result.error) {
    errors.push(`os_process_scan_failed:${result.error.message}`);
    return new Map();
  }
  if (result.status !== 0) {
    errors.push(`os_process_scan_exit:${result.status ?? 'unknown'}`);
    return new Map();
  }

  const table = new Map<number, OsProcessRow>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/u);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const cpuPercent = Number(match[3]);
    const rssKb = Number(match[4]);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    table.set(pid, {
      pid,
      ppid,
      cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
      rssKb: Number.isFinite(rssKb) ? rssKb : 0,
      command: match[5] ?? '',
    });
  }

  return table;
}

function collectProcessTree(root: OsProcessRow, childrenByPid: Map<number, OsProcessRow[]>): OsProcessRow[] {
  const out: OsProcessRow[] = [];
  const queue = [root];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    out.push(row);
    queue.push(...(childrenByPid.get(row.pid) ?? []));
  }
  return out;
}

function ownerForRow(owner: ResourceOwner, descendant: boolean): ResourceOwner {
  if (!descendant) return owner;
  return {
    ...owner,
    component: `${owner.component}:child`,
    label: owner.label ? `${owner.label} child` : undefined,
  };
}

function harnessOwnerFromCommand(command: string): ResourceOwner | null {
  if (!/browser-harness-js\/sdk\/repl\.ts/u.test(command)) return null;
  const sessionId = command.match(/--resource-session=([^\s]+)/u)?.[1];
  if (!sessionId || sessionId === 'unknown') return null;
  return {
    kind: 'harness',
    component: 'browser-harness-js',
    sessionId,
    label: `harness:${sessionId.slice(0, 8)}`,
  };
}

function electronKind(type: string): string {
  switch (type.toLowerCase()) {
    case 'browser': return 'app-main';
    case 'gpu': return 'app-gpu';
    case 'utility': return 'app-utility';
    case 'tab':
    case 'renderer':
      return 'app-renderer';
    default:
      return `app-${type.toLowerCase()}`;
  }
}

function sessionLabel(sessionId: string, info?: SessionResourceInfo): string {
  const prompt = info?.prompt?.trim();
  if (!prompt) return `session:${sessionId.slice(0, 8)}`;
  return truncate(prompt.replace(/\s+/gu, ' '), 64);
}

function addAggregate(
  target: Record<string, { rssMb: number; cpuPercent: number; processCount: number }>,
  key: string,
  processUsage: ResourceProcessUsage,
): void {
  const existing = target[key] ?? { rssMb: 0, cpuPercent: 0, processCount: 0 };
  existing.rssMb = round1(existing.rssMb + processUsage.rssMb);
  existing.cpuPercent = round1(existing.cpuPercent + processUsage.cpuPercent);
  existing.processCount += 1;
  target[key] = existing;
}

function readIntervalMs(): number {
  const raw = process.env.AGB_RESOURCE_LOG_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_INTERVAL_MS;
  return n;
}

function kbToMb(kb: number): number {
  return round1(kb / 1024);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((acc, item) => acc + fn(item), 0);
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
}
