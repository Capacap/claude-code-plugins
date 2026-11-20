# pathview

Makes the file paths in Claude's replies clickable in Claude Code, and lists them after each reply with a preview and an `open` button.

When Claude writes "I changed `src/app.ts:42`", you usually want to look at that file. This plugin turns the path into a link, and puts a row under the reply that shows the ten lines around line 42. The `open` button takes you to that line in your editor.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install pathview --marketplace Capacap/claude-code-plugins
```

Or from a shell:

```sh
claude plugin install pathview --marketplace Capacap/claude-code-plugins
```

## What you get

- **Links.** Each path in a reply that exists on disk becomes a `file://` link. Paths inside a code block stay as they are.
- **A list after the reply.** One row for each path, with a fold. A list of more than three paths starts folded to one line.
- **Previews.** A text file unfolds to ten lines around the line the reply named. A folder unfolds to its first ten entries. A picture unfolds to the picture.
- **`open`.** Opens the file in your editor at the line, a picture in your image viewer, and an HTML page or a PDF in your browser.
- **`terminal`.** Starts a terminal in the folder that holds the file.

The plugin only changes what you see. Claude reads the reply as it wrote it.

## Where `open` takes a file

With no settings, the plugin looks at where the session runs.

| The session runs in | A text file opens in |
|---|---|
| The terminal of VS Code, Cursor or Windsurf | A tab in that editor, at the line |
| That terminal on a remote host, in a dev container or in a codespace | A tab in that editor, also for a picture, a page or a PDF |
| kitty | A new kitty window with `$VISUAL` or `$EDITOR`, at the line |
| Any other terminal | The system's opener (`xdg-open`, `open` on macOS, `wslview` on WSL), without the line |

On your own machine, pictures, pages, PDFs and folders go to the system's opener, or to your own command where you set one. In kitty a folder opens as a terminal in it.

A button shows only where it has something to start. So the `terminal` button shows in kitty, or after you set a terminal command.

## Settings

Type `/config` in a session and look for pathview, or run `claude plugin configure pathview`.

| Setting | What it does | Example |
|---|---|---|
| Editor | Where a text file opens when the editor command is empty. `auto` works as the table above says. `vscode` opens a tab in VS Code from any terminal on your own machine. `system` always uses the system's opener. | `vscode` |
| Editor command | Opens a text file, and comes before the Editor setting. | `zed {file}:{line}` |
| Terminal command | Starts a terminal in a folder. | `wezterm start --cwd {dir}` |
| Image viewer command | Opens a picture. | `qimgv {file}` |
| Browser command | Opens an HTML page or a PDF. | `firefox {file}` |

In a command, `{file}` is the full path, `{line}` is the line the reply named or 1, and `{dir}` is the folder. A command with neither `{file}` nor `{dir}` gets the path as its last word.

The plugin starts the program itself, without a shell. So a word in double quotes is one word, such as a program name that holds a space, and no other quoting or shell syntax is read.

An editor that runs inside a terminal needs a terminal to run in. Name both in the command, such as `alacritty -e nvim +{line} {file}`.

Where the program of a command is not installed, the plugin goes on as if the setting were empty. `claude --debug` logs a line that names the missing program.

## Limits

- **Terminal sessions only.** The plugin draws in a session in a terminal, the terminal of an editor included. It draws nothing in the VS Code panel, the desktop app or the mobile app.
- **Windows.** The plugin needs a Unix shell, so it draws nothing in a session on Windows itself. It works under WSL.
- **Pictures.** A picture preview shows in kitty and Ghostty, outside tmux. Other terminals show the row and the `open` button without the picture. A picture that is not a PNG needs ImageMagick's `magick` for its preview.
- **Over ssh.** The buttons start programs on the machine the session runs on. Over ssh they show only for a command you set yourself. VS Code's terminal on a remote host opens tabs, and has a button for a folder only where you set a terminal command.
- **Paths with a space** are not found.

## What was tested

I use the plugin every day in kitty on Linux. The tests in `tests/` cover the rules for VS Code, Cursor, macOS, Ghostty, WSL, tmux and ssh with a faked machine, and nobody has run those systems for real yet. If the plugin does the wrong thing on yours, please open an issue with your terminal and your system.

## Where it keeps things

A preview of a picture that is not a PNG is a converted copy in `~/.cache/pathview/` (or under `$XDG_CACHE_HOME`). Nothing cleans that folder, and you can delete it at any time.
