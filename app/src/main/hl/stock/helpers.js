/**
 * browser-harness-js bridge.
 *
 * Browser Use Desktop now drives the assigned Chromium view through the
 * vendored browser-harness-js CLI instead of exporting a large convenience
 * helper API from this file.
 *
 * Preferred usage from the harness directory:
 *
 *   browser-harness-js 'await connectToAssignedTarget()'
 *   browser-harness-js 'await session.Page.navigate({url:"https://example.com"})'
 *   browser-harness-js '(await session.Runtime.evaluate({expression:"document.title",returnByValue:true})).result.value'
 *
 * See ./AGENTS.md and ./interaction-skills/ for CDP recipes.
 */

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const CLI_PATH = path.join(__dirname, 'browser-harness-js', 'sdk', 'browser-harness-js');

function browserHarnessCommand() {
  return CLI_PATH;
}

async function browserHarnessEval(code, opts = {}) {
  const { stdout } = await execFileAsync(CLI_PATH, [code], {
    cwd: opts.cwd ?? __dirname,
    env: opts.env ?? process.env,
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

module.exports = {
  browserHarnessCommand,
  browserHarnessEval,
  connectSnippet: 'await connectToAssignedTarget()',
};
