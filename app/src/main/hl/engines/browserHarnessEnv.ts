import { createHash } from 'node:crypto';
import path from 'node:path';
import type { SpawnContext } from './types';

export function browserHarnessReplPort(sessionId: string, targetId = ''): string {
  const n = createHash('sha256').update(`${sessionId}:${targetId}`).digest().readUInt16BE(0);
  return String(18_000 + (n % 20_000));
}

export function applyBrowserHarnessEnv(ctx: SpawnContext, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const agentSkillDir = path.join(ctx.harnessDir, 'agent-skill');
  const sdkDir = path.join(ctx.harnessDir, 'browser-harness-js', 'sdk');
  const harnessPath = `${agentSkillDir}${path.delimiter}${sdkDir}`;
  env.PATH = env.PATH ? `${harnessPath}${path.delimiter}${env.PATH}` : harnessPath;
  env.CDP_REPL_PORT = env.CDP_REPL_PORT ?? browserHarnessReplPort(ctx.sessionId, ctx.targetId);
  env.CDP_REPL_LOG = env.CDP_REPL_LOG ?? path.join(ctx.harnessDir, `browser-harness-js-${ctx.sessionId}.log`);
  env.BU_SESSION_ID = ctx.sessionId;
  // Watched session outputs dir — any file written here triggers a `file_output`
  // event in runEngine. The Page.captureScreenshot wrapper in repl.ts auto-saves
  // PNGs into this dir so screenshots surface in the chat instead of being
  // dumped as base64 into stdout.
  env.BU_OUTPUTS_DIR = path.join(ctx.harnessDir, 'outputs', ctx.sessionId);
  return env;
}
