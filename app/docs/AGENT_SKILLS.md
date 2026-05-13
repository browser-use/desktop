# Skills

 Reagan here! This first version of personal skills is inspired by Hermes Agent's skill index injection and progressive skill-loading pattern.

## Browser Use Pattern

This app uses `agent-skill` as a provider-neutral CLI because Codex, Claude Code, and BrowserCode all already run in the same harness working directory and PATH. That avoids duplicating a tool schema per provider.

The harness contains:

- `interaction-skills/`: read-only browser mechanics
- `domain-skills/`: read-only site playbooks
- `skills/`: persistent user-created procedural skills
- `agent-skill/`: the local CLI used to search, view, create, patch, delete, and validate

Providers are prompted to run `agent-skill search` before inventing browser or site-specific steps, then `agent-skill view <id>` for the exact skill.

Each provider prompt also receives a generated compact skill index. The index is metadata only: skill id, title, and short description. Full skill bodies are not injected; agents still load them with `agent-skill view <id>`.

## Creation Rules

Create or patch a skill when the task produced reusable procedural knowledge:

- complex task succeeded after roughly 5 or more meaningful tool calls
- tricky error was fixed
- trial and error changed the approach
- a user correction revealed the method they want repeated
- an existing skill was stale, incomplete, or wrong

Do not write a skill for:

- simple one-off browsing or fact lookups
- user-specific secrets, temporary tokens, or private account details
- failed or speculative workflows
- content that belongs in task output

Run validation after writing:

```bash
agent-skill validate <id> --json
```

Delete only local user-created skills when they are wrong, duplicate, or no longer useful:

```bash
agent-skill delete <id> --json
```

## Evaluation

Run the timed ten-task suite:

```bash
npm run skills:eval
```

The suite covers five "find existing skill" tasks, two "create new skill" tasks, one "patch existing skill" task with deletion coverage, and two "do not write a skill" tasks. Each task records elapsed time for the overall task and each `agent-skill` operation.

This first evaluator proves discoverability, bloat control, write/no-write task classification, and static skill quality. It does not yet prove that a provider used the skill correctly inside a live browser session. The next layer should run the same fixture set through each provider and judge the resulting `skill_used`/`skill_written` events plus task output.