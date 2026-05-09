import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SpawnContext } from './types';

export function browserHarnessReplPort(sessionId: string, targetId = ''): string {
  const n = createHash('sha256').update(`${sessionId}:${targetId}`).digest().readUInt16BE(0);
  return String(18_000 + (n % 20_000));
}

export function applyBrowserHarnessEnv(ctx: SpawnContext, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sdkDir = path.join(ctx.harnessDir, 'browser-harness-js', 'sdk');
  env.PATH = env.PATH ? `${sdkDir}${path.delimiter}${env.PATH}` : sdkDir;
  env.CDP_REPL_PORT = env.CDP_REPL_PORT ?? browserHarnessReplPort(ctx.sessionId, ctx.targetId);
  env.CDP_REPL_LOG = env.CDP_REPL_LOG ?? path.join(ctx.harnessDir, `browser-harness-js-${ctx.sessionId}.log`);
  env.BU_SESSION_ID = ctx.sessionId;
  return env;
}
