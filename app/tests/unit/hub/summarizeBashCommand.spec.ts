import { describe, expect, it } from 'vitest';
import { summarizeBashCommand } from '../../../src/renderer/hub/chat/toolLabels';

describe('summarizeBashCommand', () => {
  it('returns null for unknown commands', () => {
    expect(summarizeBashCommand('weirdtool --do-stuff')).toBeNull();
  });

  it('unwraps /bin/zsh -lc "..." before matching', () => {
    expect(summarizeBashCommand(`/bin/zsh -lc "sed -n '1,260p' AGENTS.md"`)).toEqual({
      active: 'Reading', completed: 'Read', value: 'AGENTS.md',
    });
  });

  it('summarizes cat as Read FILE', () => {
    expect(summarizeBashCommand('cat package.json')).toEqual({
      active: 'Reading', completed: 'Read', value: 'package.json',
    });
  });

  it('summarizes ls as Looked at files (folded into label)', () => {
    expect(summarizeBashCommand('ls -la')).toEqual({
      active: 'Looking at files', completed: 'Looked at files', value: '',
    });
  });

  it('summarizes find as Looked for files (folded into label)', () => {
    expect(summarizeBashCommand('find ./src -name "*.ts"')).toEqual({
      active: 'Looking for files', completed: 'Looked for files', value: '',
    });
  });

  it('summarizes grep with quoted pattern', () => {
    expect(summarizeBashCommand(`grep -r "useState" src/`)).toEqual({
      active: 'Searching for', completed: 'Searched for', value: 'useState',
    });
  });

  it('summarizes git status/diff/log/show as Reviewed recent changes', () => {
    expect(summarizeBashCommand('git status --short')?.completed).toBe('Reviewed recent changes');
    expect(summarizeBashCommand('git diff')?.completed).toBe('Reviewed recent changes');
    expect(summarizeBashCommand('git log')?.completed).toBe('Reviewed recent changes');
  });

  it('summarizes git commit as Saved progress', () => {
    expect(summarizeBashCommand('git commit -m "hi"')).toEqual({
      active: 'Saving progress', completed: 'Saved progress', value: '',
    });
  });

  it('summarizes git push as Sent changes to the cloud', () => {
    expect(summarizeBashCommand('git push origin main')?.completed).toBe('Sent changes to the cloud');
  });

  it('summarizes git checkout BRANCH', () => {
    expect(summarizeBashCommand('git checkout feature/chat-view')).toEqual({
      active: 'Switching to', completed: 'Switched to', value: 'feature/chat-view',
    });
  });

  it('summarizes curl as Visited URL', () => {
    expect(summarizeBashCommand('curl https://example.com')).toEqual({
      active: 'Visiting', completed: 'Visited', value: 'https://example.com',
    });
  });

  it('summarizes npm install as Installed tools', () => {
    expect(summarizeBashCommand('npm install lodash')?.completed).toBe('Installed tools');
  });

  it('summarizes npm test as Ran tests', () => {
    expect(summarizeBashCommand('yarn test')?.completed).toBe('Ran tests');
  });

  it('summarizes npm run build as Built project', () => {
    expect(summarizeBashCommand('npm run build')?.completed).toBe('Built project');
  });

  it('strips dirname from basename targets', () => {
    expect(summarizeBashCommand('cat /a/b/c.md')?.value).toBe('c.md');
  });

  it('maps browser-harness connectToAssignedTarget to "Connected to browser"', () => {
    const cmd = `/bin/zsh -lc "browser-harness-js 'await connectToAssignedTarget()'"`;
    expect(summarizeBashCommand(cmd)).toEqual({
      active: 'Connecting to browser', completed: 'Connected to browser', value: '',
    });
  });

  it('maps browser-harness session.connect to "Connected to browser"', () => {
    expect(summarizeBashCommand(`browser-harness-js 'await session.connect()'`)?.completed)
      .toBe('Connected to browser');
  });

  it('extracts the URL from browser-harness Page.navigate (URL is a specific identifier, stays in value)', () => {
    const cmd = `browser-harness-js 'await session.Page.navigate({url:"https://linkedin.com/mynetwork"})'`;
    expect(summarizeBashCommand(cmd)).toEqual({
      active: 'Visiting', completed: 'Visited', value: 'https://linkedin.com/mynetwork',
    });
  });

  it('maps browser-harness Page.captureScreenshot to "Took screenshot"', () => {
    expect(summarizeBashCommand(`browser-harness-js 'await session.Page.captureScreenshot()'`)?.completed)
      .toBe('Took screenshot');
  });

  it('maps browser-harness listPageTargets to "Listed open tabs"', () => {
    expect(summarizeBashCommand(`browser-harness-js 'await listPageTargets()'`)?.completed)
      .toBe('Listed open tabs');
  });

  it('maps browser-harness DOM.querySelector to "Inspected page"', () => {
    const cmd = `browser-harness-js 'await session.DOM.querySelector({nodeId:1,selector:"h1"})'`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Inspected page');
  });

  it('maps browser-harness Input.dispatchMouseEvent to "Clicked on page"', () => {
    expect(summarizeBashCommand(`browser-harness-js 'await session.Input.dispatchMouseEvent({type:"mousePressed",x:1,y:1})'`)?.completed)
      .toBe('Clicked on page');
  });

  it('returns null for arbitrary Runtime.evaluate (intent unknowable)', () => {
    const cmd = `browser-harness-js 'await session.Runtime.evaluate({expression:"window.myCustom()"})'`;
    expect(summarizeBashCommand(cmd)).toBeNull();
  });

  it('maps Runtime.evaluate reading document.title to "Looked at page"', () => {
    const cmd = `browser-harness-js 'await session.Runtime.evaluate({expression:"document.title", returnByValue:true})'`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Looked at page');
  });

  it('maps Runtime.evaluate reading location.href to "Looked at page"', () => {
    const cmd = `browser-harness-js 'await session.Runtime.evaluate({expression:"({ url: location.href })", returnByValue:true})'`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Looked at page');
  });

  it('handles browser-harness inside a heredoc', () => {
    const cmd = `/bin/zsh -lc "browser-harness-js <<'EOF'\nawait session.Page.navigate({url:'https://linkedin.com'});\nEOF"`;
    expect(summarizeBashCommand(cmd)?.value).toBe('https://linkedin.com');
  });

  it('multi-step script with connect+navigate labels the navigation (most informative wins)', () => {
    const cmd = `/bin/zsh -lc "browser-harness-js <<'EOF'\nawait connectToAssignedTarget()\nawait session.Page.navigate({ url: 'https://x.com' })\nEOF"`;
    expect(summarizeBashCommand(cmd)).toEqual({
      active: 'Visiting', completed: 'Visited', value: 'https://x.com',
    });
  });

  it('multi-step script with connect+screenshot labels the screenshot', () => {
    const cmd = `/bin/zsh -lc "browser-harness-js <<'EOF'\nawait connectToAssignedTarget()\nawait session.Page.captureScreenshot({ format: 'png' })\nEOF"`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Took screenshot');
  });

  it('maps page.goto(URL) as "Visited URL" even though the API is Puppeteer-style', () => {
    const cmd = `browser-harness-js 'await page.goto("https://x.com/home", {waitUntil: "domcontentloaded"})'`;
    expect(summarizeBashCommand(cmd)).toEqual({
      active: 'Visiting', completed: 'Visited', value: 'https://x.com/home',
    });
  });

  it('falls back to scanning raw inner when inline quoting is broken (multi-statement scripts)', () => {
    // No matching outer quotes — extractBrowserHarnessJs returns null, but the
    // raw inner still contains identifiable CDP calls.
    const cmd = `browser-harness-js 'await connectToAssignedTarget(); await page.goto("https://x.com/home", {waitUntil: "load"})'`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Visited');
  });

  it('connect-only script still labels as "Connected to browser"', () => {
    const cmd = `/bin/zsh -lc "browser-harness-js 'await connectToAssignedTarget()'"`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Connected to browser');
  });

  it('maps python -c to Ran Python code', () => {
    expect(summarizeBashCommand(`python3 -c "print('hi')"`)?.completed).toBe('Ran Python code');
  });

  it('maps node -e to Ran JavaScript code', () => {
    expect(summarizeBashCommand(`node -e "console.log(1)"`)?.completed).toBe('Ran JavaScript code');
  });

  it('falls back to binary name for unknown heredoc', () => {
    expect(summarizeBashCommand(`weird-tool <<EOF\nfoo\nEOF`)).toEqual({
      active: 'Running', completed: 'Ran', value: 'weird-tool',
    });
  });

  it('summarizes head -n N FILE', () => {
    expect(summarizeBashCommand('head -n 50 src/index.ts')?.value).toBe('index.ts');
  });

  it('summarizes mkdir as Created folder', () => {
    expect(summarizeBashCommand('mkdir -p build/out')).toEqual({
      active: 'Creating folder', completed: 'Created folder', value: 'out',
    });
  });

  it('summarizes rm as Deleted', () => {
    expect(summarizeBashCommand('rm -rf node_modules')?.completed).toBe('Deleted');
  });

  it('summarizes echo > FILE as Saved to', () => {
    expect(summarizeBashCommand('echo "hello" > out.txt')).toEqual({
      active: 'Saving to', completed: 'Saved to', value: 'out.txt',
    });
  });

  it('summarizes pwd as Checked current folder', () => {
    expect(summarizeBashCommand('pwd')?.completed).toBe('Checked current folder');
  });

  it('summarizes standalone cd as Changed folder', () => {
    expect(summarizeBashCommand('cd /tmp/foo')).toEqual({
      active: 'Changing folder to', completed: 'Changed folder to', value: 'foo',
    });
  });

  it('strips leading "cd X &&" so the chained command gets labeled', () => {
    expect(summarizeBashCommand('cd /tmp/foo && git status')?.completed)
      .toBe('Reviewed recent changes');
  });

  it('strips leading "cd X &&" before a browser-harness call', () => {
    const cmd = `/bin/zsh -lc "cd /work && browser-harness-js 'await connectToAssignedTarget()'"`;
    expect(summarizeBashCommand(cmd)?.completed).toBe('Connected to browser');
  });
});
