# Claude Code plugins

Plugins for [Claude Code](https://claude.com/claude-code) that change its own interface. I use them every day in my own setup.

| Plugin | What it does |
|---|---|
| [usermd](plugins/usermd) | A button above the prompt that opens your own reminders for writing a request. |

## Install

At the prompt of a Claude Code session in a terminal, with the name of the plugin you want:

```
/plugin install usermd --marketplace Capacap/claude-code-plugins
```

Or from a shell:

```sh
claude plugin install usermd --marketplace Capacap/claude-code-plugins
```

Claude Code asks once if it may add this repository as a marketplace, and then for a scope. Each plugin's own README says how to use it.

## Licence

MIT, in `LICENSE`.
