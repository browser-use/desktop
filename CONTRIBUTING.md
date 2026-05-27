[**English**](CONTRIBUTING.md) | [**简体中文**](CONTRIBUTING.zh.md)

# Contributing to Browser Use Desktop

Install these first:

- [Task](https://taskfile.dev) (`brew install go-task` on macOS)
- Node.js 22
- Yarn

From root:

```bash
git clone https://github.com/browser-use/desktop.git
cd desktop
task up
```

`task up` installs dependencies, patches the local Electron app bundle, and
starts the desktop app. 

Useful development commands:

```bash
task --list          # show available tasks
task lint            # run ESLint
task typecheck       # run tsc --noEmit
cd app && yarn test  # run unit and integration tests
task make            # build platform installers
```

Linux packages are built in Docker:

```bash
task linux:make:docker
```

## Pull requests

Great PRs are focused and easy to review:

1. Explain why the change is needed.
2. Keep the PR scoped to one bug fix, feature, or cleanup.
3. Include screenshots or a short recording for UI changes.

To get your PR reviewed faster, you can message any of the Browser Use employees on discord, twitter, or email.

## Reporting bugs

Open an issue at
[browser-use/desktop/issues](https://github.com/browser-use/desktop/issues)
with enough detail for someone else to reproduce the problem.

Good bug reports include:

- The app version / git commit.
- Your operating system.
- The provider you were using, such as Claude Code or Codex.
- Clear steps to reproduce the issue.
- What you expected to happen and what happened instead.
- Screenshots or recordings when the bug is visible.
- Relevant logs, with secrets and private URLs redacted.

Helpful log commands:

```bash
task logs:all
task logs:app
task logs:browser
task logs:agent SESSION_ID=<session-id>
task logs:engine
task logs:errors
```

By default, local logs are read from:

```text
~/Library/Application Support/Browser Use/logs
```

## Feature Reuests

Please describe both a problem + solution! Include:

- Why the current app does not solve it well / atall.
- The specific outcome you want.
- Screenshots, recordings, or example sites if they clarify the request.

If you plan to send a PR for the feature, open an issue first! and tag it in your PR. 

## Internationalization (i18n)

The app ships with English and Chinese (简体中文) interfaces. All UI strings use the **key = fallback** pattern — the English text itself serves as the translation key, so missing keys fall back gracefully to English.

### Adding or editing strings

1. Edit the component — wrap user-facing strings with `t('...')` (inside a React component) or `i18n.t('...')` (in module-level code).
2. Add the English key to `app/src/renderer/locales/en.json` (value = key).
3. Add the corresponding translation to `app/src/renderer/locales/zh.json` (or your target locale).
4. Run `cd app && task typecheck` to verify.

### Adding a new locale

1. Create `app/src/renderer/locales/{locale}.json` with all keys from `en.json`.
2. Add the locale option to the language dropdown in `app/src/renderer/hub/SettingsPane.tsx`.
3. Open a PR — one locale per PR please.

### File structure

```
app/src/renderer/
  i18n.ts                 # i18next initialization
  locales/
    en.json               # English source strings
    zh.json               # Chinese (simplified) translations
```

### Adding i18n to a new file

- **React components:** import `useTranslation` from `react-i18next`, call the `t()` function.
- **Module-level code (outside components):** import `i18n` from the relative path to `i18n.ts` (e.g. `../i18n` or `../../i18n` depending on file depth), call `i18n.t()`.
- All 5 renderer entry points (`hub/`, `onboarding/`, `pill/`, `popup/`, `logs/`) already wrap their content with `<I18nextProvider>`, so any component inside them can use the hook.

## Where to ask questions

[Browser Use Discord](https://discord.com/invite/fqPB2NCNKV)
[Twitter](https://x.com/browser_use)
