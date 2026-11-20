# usermd

A button above the prompt in Claude Code that opens your own reminders for writing a request.

Most of the friction in a session comes from what the request left out, such as where to stop or what is not part of the job. This plugin keeps your own list of such reminders one click from the prompt, so you can read it before you press Enter.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install usermd --marketplace Capacap/claude-code-plugins
```

Or from a shell:

```sh
claude plugin install usermd --marketplace Capacap/claude-code-plugins
```

## Use

1. Write your reminders in `~/.claude/USER.md`, one to a line. `USER.example.md` in this folder is a list to start from.
2. Click `▸ USER.md` above the prompt, or type `/usermd`. The reminders open under the button.
3. Click the button or type `/usermd` again to close them.

The plugin reads the file each time it draws, so an edit shows without a restart. It draws the lines dim, and a line that starts with `#` bold as well.

The file is for you. Claude does not read it, and the plugin sends nothing to the model.

## Where the file is

The plugin looks for `USER.md` in the config folder of the session, which is `~/.claude` unless `CLAUDE_CONFIG_DIR` names another one. Where that other folder has no `USER.md`, the plugin shows the one in `~/.claude`.
