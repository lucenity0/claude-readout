# claude-readout

Shows which files Claude Code read. The folded `Read 3 files` line names them instead.

```
before   ● Read 3 files (ctrl+o to expand)

after    ● Read  hooks/register.tsx, hooks/sprites.ts, README.md
```

It answers [#21151](https://github.com/anthropics/claude-code/issues/21151). Verbose mode shows the names too, but it turns on more than names, and it doesn't reach VS Code. readout changes only the folded line, on every surface, at no token cost.

&nbsp;

## install

readout runs on function hooks, an early-access part of Claude Code. Turn them on in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

Then install it and start a new session:

```sh
claude plugin marketplace add lucenity0/claude-readout
claude plugin install readout@claude-readout
```

To hack on it instead, clone it and load the folder with `claude --plugin-dir ~/claude-readout`.

Function hooks may change between releases. readout was tested on Claude Code 2.1.289.

&nbsp;

## what it shows

```
Read                 the path, relative to the project or under ~
Grep, Glob           the pattern, and where it looked
Bash                 the command
WebFetch, WebSearch  the url or the query
```

Calls in a row to the same tool share a line. A line that runs past the window ends in `+N more`.

A call that failed is red, along with its reason. A call a plugin blocked says which one (`blocked by <plugin>`).

```
● Read  src/old.ts  File does not exist
```

`ctrl+o` and `--verbose` work as before.

&nbsp;

## settings

```json
{ "pluginConfigs": { "readout@claude-readout": { "options": { "mode": "inline" } } } }
```

`mode` is `inline` (the default: one line per tool, as above) or `expand`, which unfolds every group into Claude Code's own row per call.

&nbsp;

## contributing

```sh
claude plugin validate .
claude plugin test .
```

The labels live in [`format.ts`](hooks/format.ts) and the drawing in [`register.tsx`](hooks/register.tsx).

&nbsp;

---

<sub>MIT · built with Claude Code</sub>
