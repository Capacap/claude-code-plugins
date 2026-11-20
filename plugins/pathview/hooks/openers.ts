// What a press on `open` or `terminal` starts, decided from the settings and
// from what the session's machine is. Nothing here asks the machine: `Facts`
// is gathered by the hooks module, so each system is a case in the tests.
//
// The order is the same for every target: the person's own command, then what
// the screen gives (the editor whose terminal this is, kitty with $EDITOR),
// then the system's opener. A route whose program is missing falls through to
// the next, and undefined means the button is not drawn.

export type Settings = {
  // auto, vscode or system: where a text file goes when editorCommand is empty.
  editor: string
  editorCommand: string
  terminalCommand: string
  imageCommand: string
  browserCommand: string
}

export type Facts = {
  platform: 'macos' | 'windows' | 'wsl' | 'linux' | 'unknown'
  // The hosted server: the person's machine is not the one the programs start on.
  isHosted: boolean
  // TERM, TERM_PROGRAM, KITTY_WINDOW_ID, KITTY_LISTEN_ON, TMUX, SSH_CONNECTION,
  // REMOTE_CONTAINERS, CODESPACES, CURSOR_TRACE_ID, VISUAL and EDITOR, each
  // where it is set.
  env: Readonly<Record<string, string | undefined>>
  // The person's home folder, which a program written as `~/bin/x` is under.
  home: string
  // The programs on PATH among those asked about, as `programOf` names them.
  found: ReadonlySet<string>
}

// A program started and let go, or one that runs in a kitty window of its own
// in a folder (no program is a shell there).
export type Launch = { argv: string[] } | { kitty: { folder: string; argv: string[] } }

export type Target = { kind: 'file' | 'image' | 'page' | 'dir'; path: string; line?: number }

export const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp)$/i
// What `open` takes to the browser where no line is named: a page and a PDF.
const BROWSED = /\.(?:html?|pdf)$/i

// What `open` is asked for: a page or a PDF named without a line goes to the
// browser, any other file to the editor at its line.
export const targetOf = (entry: { kind: 'file' | 'dir'; path: string; line?: number }): Target => ({
  kind: entry.kind === 'dir' ? 'dir' : IMAGE.test(entry.path) ? 'image' : entry.line === undefined && BROWSED.test(entry.path) ? 'page' : 'file',
  path: entry.path,
  line: entry.line,
})

// The programs `Facts.found` is asked about besides the ones the settings and
// $EDITOR name.
export const PROGRAMS = ['code', 'cursor', 'windsurf', 'kitty', 'setsid', 'xdg-open', 'wslview', 'open']

// The values the editor setting takes; any other counts as auto.
export const EDITORS = ['auto', 'vscode', 'system']

// Where the person's screen is, decided once from the variables a terminal
// and an editor leave, in this order. An editor's own terminal comes first,
// since a shell it starts inherits the variables of the terminal the editor
// was started from, such as kitty's.
//   hosted          the engine runs on a server
//   vscode          the terminal of VS Code, Cursor or Windsurf on this machine
//   vscode-remote   that terminal on another host: over ssh, in a dev container or a codespace
//   remote          any other shell over ssh
//   kitty, ghostty  the two terminals that draw a picture named by its file
//   other           any other terminal on this machine
export type Screen = 'hosted' | 'vscode' | 'vscode-remote' | 'remote' | 'kitty' | 'ghostty' | 'other'

export const screenOf = ({ isHosted, env }: Facts): Screen => {
  if (isHosted) return 'hosted'
  const away = env.SSH_CONNECTION !== undefined || env.REMOTE_CONTAINERS !== undefined || env.CODESPACES !== undefined
  if (env.TERM_PROGRAM === 'vscode') return away ? 'vscode-remote' : 'vscode'
  if (away) return 'remote'
  if (env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty') return 'ghostty'
  // kitty's window variable alone does not say kitty, since every terminal
  // started from a kitty shell inherits it; under tmux, which takes TERM for
  // itself, it is the one sign left.
  if (env.TERM === 'xterm-kitty' || (env.KITTY_WINDOW_ID !== undefined && env.TMUX !== undefined)) return 'kitty'

  return 'other'
}

// The words of a command line. A word in double quotes is kept as one, spaces
// included; no other quoting is read, so a quote inside a word stays in it.
export const words = (line: string) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(one => one[1] ?? one[2] ?? '')

// A command's words with its program's `~/` written out, since the search of
// PATH and the start of a program both take a name as it is.
const command = (line: string | undefined, home: string) => {
  const [program, ...rest] = words(line ?? '')

  return program === undefined ? [] : [program.startsWith('~/') ? `${home}${program.slice(1)}` : program, ...rest]
}

// The program a setting or $EDITOR names, to ask the machine about.
export const programOf = (line: string | undefined, home: string) => command(line, home)[0]

export const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

// A setting's command with its {file}, {line} and {dir} filled in, or
// undefined where the setting is empty or its program is not on PATH. A
// command that names neither {file} nor {dir} gets the target as its last
// word: the folder for a terminal, the file for the rest.
const filled = (template: string, target: Target, facts: Facts) => {
  const parts = command(template, facts.home)
  if (parts[0] === undefined || !facts.found.has(parts[0])) return undefined
  const dir = target.kind === 'dir' ? target.path : folderOf(target.path)
  const values: Record<string, string> = { '{file}': target.path, '{line}': String(target.line ?? 1), '{dir}': dir }
  const argv = parts.map(one => one.replace(/\{(?:file|line|dir)\}/g, name => values[name] ?? name))

  return { argv: /\{(?:file|dir)\}/.test(template) ? argv : [...argv, target.path] }
}

// The system's own opener, which knows no line number.
const bySystem = (path: string, facts: Facts): Launch | undefined => {
  if (facts.platform === 'macos') return facts.found.has('open') ? { argv: ['open', path] } : undefined
  if (facts.platform === 'wsl' && facts.found.has('wslview')) return { argv: ['wslview', path] }

  return facts.found.has('xdg-open') ? { argv: ['xdg-open', path] } : undefined
}

// How an editor takes a line: VS Code and its kin as `--goto file:line`,
// these others as `file:line`, and the rest as `+line file`.
const VSCODE_KIN = ['code', 'cursor', 'windsurf', 'codium', 'code-insiders']
const COLON_LINE = new Set(['hx', 'helix', 'fresh', 'zed', 'subl', 'micro'])
const atLine = (parts: string[], target: Target) => {
  const name = (parts[0] ?? '').slice((parts[0] ?? '').lastIndexOf('/') + 1)
  if (VSCODE_KIN.includes(name)) return [...parts, '--goto', `${target.path}:${target.line ?? 1}`]
  if (target.line === undefined) return [...parts, target.path]

  return COLON_LINE.has(name) ? [...parts, `${target.path}:${target.line}`] : [...parts, `+${target.line}`, target.path]
}

// A tab in the window of the editor the session runs in, or in its last used
// one. Cursor and Windsurf are VS Code to their terminals; Cursor says which
// it is. A picture or a page opens there as a tab too, with no line.
const inVscode = (target: Target, facts: Facts): Launch | undefined => {
  const order = facts.env.CURSOR_TRACE_ID === undefined ? ['code', 'cursor', 'windsurf'] : ['cursor', 'code', 'windsurf']
  const program = order.find(one => facts.found.has(one))
  if (program === undefined) return undefined

  return { argv: target.kind === 'file' ? atLine([program, '--reuse-window'], target) : [program, '--reuse-window', target.path] }
}

// $VISUAL on the file at its line, or $EDITOR where $VISUAL is unset, empty
// or names a program that is missing.
const editorArgv = (target: Target, facts: Facts) => {
  for (const line of [facts.env.VISUAL, facts.env.EDITOR]) {
    const parts = command(line, facts.home)
    if (parts[0] !== undefined && facts.found.has(parts[0])) return atLine(parts, target)
  }

  return undefined
}

// A terminal in a folder: the person's command, or kitty where the session
// runs in it. No other terminal is started unasked, since each takes its
// folder its own way.
export const terminalIn = (folder: string, settings: Settings, facts: Facts): Launch | undefined => {
  const screen = screenOf(facts)
  if (screen === 'hosted' || facts.platform === 'windows') return undefined
  const own = filled(settings.terminalCommand, { kind: 'dir', path: folder }, facts)
  if (own !== undefined) return own

  return screen === 'kitty' && facts.found.has('kitty') ? { kitty: { folder, argv: [] } } : undefined
}

// What `open` starts for a target. `cwd` is the session's folder, where an
// editor in a terminal starts.
export const opening = (target: Target, cwd: string, settings: Settings, facts: Facts): Launch | undefined => {
  const screen = screenOf(facts)
  if (screen === 'hosted' || facts.platform === 'windows') return undefined
  // The system's opener shows its window on the machine the session runs on,
  // which is the person's only where the screen is.
  const isHere = screen !== 'remote' && screen !== 'vscode-remote'
  const system = isHere ? bySystem(target.path, facts) : undefined
  // An editor on another host shows every file it can as a tab; this machine
  // has a viewer and a browser of its own for a picture and a page.
  const tab = screen === 'vscode-remote' ? inVscode(target, facts) : undefined
  if (target.kind === 'dir') return terminalIn(target.path, settings, facts) ?? system
  if (target.kind === 'image') return filled(settings.imageCommand, target, facts) ?? system ?? tab
  if (target.kind === 'page') return filled(settings.browserCommand, target, facts) ?? system ?? tab

  const own = filled(settings.editorCommand, target, facts)
  if (own !== undefined) return own
  if (settings.editor === 'system') return system
  if (settings.editor === 'vscode') return (screen === 'remote' ? undefined : inVscode(target, facts)) ?? system
  if (screen === 'vscode' || screen === 'vscode-remote') return inVscode(target, facts) ?? system
  if (screen === 'kitty' && facts.found.has('kitty')) {
    const argv = editorArgv(target, facts)
    if (argv !== undefined) return { kitty: { folder: cwd, argv } }
  }

  return system
}

// Whether a picture read from a file is drawn: kitty and Ghostty take one by
// its name, where tmux is not between.
export const drawsPictures = (facts: Facts) => {
  const screen = screenOf(facts)

  return (screen === 'kitty' || screen === 'ghostty') && facts.env.TMUX === undefined
}
