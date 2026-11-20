import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EDITORS, IMAGE, PROGRAMS, drawsPictures, folderOf, opening, programOf, targetOf, terminalIn } from './openers'
import type { Facts, Launch, Settings } from './openers'

// A reply is shown in batches of lines while it streams and its list is
// drawn again on each fold, so what the disk said about a path is kept this
// long before it is asked again.
const FRESH_MS = 3000
const MAX_CANDIDATES = 60
const MAX_REMEMBERED = 2000
// The list after a reply: its rows, and how many it may hold before it
// starts folded.
const MAX_ROWS = 8
const OPEN_UP_TO = 3
// A text file's preview: this many lines, the named line fifth among them,
// each cut to this many characters (one drawing takes 100,000 in all).
const PREVIEW_LINES = 10
const LINES_BEFORE = 4
const LINE_CHARS = 400
const LISTED = 10
// A picture's box, in cells. A render hook is not told a cell's size in
// pixels; these fit a common font size.
const PICTURE_COLUMNS = 80
const PICTURE_ROWS = 20
const CELL_WIDTH_PX = 10
const CELL_HEIGHT_PX = 20
// The terminal draws PNG only; anything else is converted once, to a copy no
// larger than the biggest box a picture gets here.
const CONVERT_MAX_PX = '1600x800>'

// What a text outside its fenced blocks is cut into, in this order of
// precedence: a markdown link or image, a URL, a code span, and a run of path
// characters. Only the last two can become links. A path holding a space is
// not found. The fenced blocks are taken out before, by `fencedParts`.
const PIECES = new RegExp(
  [
    /!?\[[^\]\n]*\]\([^)\n]*\)/,
    /\b[a-z][\w+.-]*:\/\/\S+/,
    /`[^`\n]+`/,
    /(?<![\w/.~@%+-])(?:~\/|\.{1,2}\/|\/)?[\w.@%+-]+(?:\/[\w.@%+-]+)*\/?(?::\d+)*/,
  ]
    .map(one => one.source)
    .join('|'),
  'gi',
)

const WHOLE_PATH = /^(?:~\/|\.{1,2}\/|\/)?[\w.@%+-]+(?:\/[\w.@%+-]+)*\/?(?::\d+)*$/

// The path in a piece, without a line number or the full stop of a sentence.
// A piece with no slash counts only where it ends in a file suffix, which
// keeps ordinary words and version numbers from being looked up.
export const pathOf = (piece: string) => {
  const path = piece.replace(/(?::\d+)+$/, '').replace(/\.+$/, '')
  if (!WHOLE_PATH.test(path)) return undefined

  return path.includes('/') || /\.[A-Za-z]\w{0,7}$/.test(path) ? path : undefined
}

const innerOf = (piece: string) => (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2 ? piece.slice(1, -1) : piece)
const lineAfter = (inner: string, path: string) => {
  const line = /^:(\d+)/.exec(inner.slice(path.length))?.[1]

  return line === undefined ? undefined : Number(line)
}

export type Mention = { typed: string; line?: number }

// Each path a text without fenced blocks names, once, in the order it first
// appears, with the line number written after it there.
export const mentions = (text: string) => {
  const found = new Map<string, Mention>()
  for (const piece of text.match(PIECES) ?? []) {
    const inner = innerOf(piece)
    const typed = pathOf(inner)
    if (typed === undefined || found.has(typed)) continue
    const line = lineAfter(inner, typed)
    found.set(typed, line === undefined ? { typed } : { typed, line })
  }

  return [...found.values()]
}

const absolute = (typed: string, home: string, cwd: string) => {
  if (typed.startsWith('/')) return typed
  if (typed.startsWith('~/')) return `${home}${typed.slice(1)}`

  return `${cwd}/${typed.replace(/^\.\//, '')}`
}

const href = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`

// An absolute path in a tool's input or a message's text, cut off before a
// quote, a space or the full stop of a sentence.
const ABSOLUTE = /(?<![\w/.~@%+-])(?:~\/|\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*\/?/g

type Row = { role: string; text: string; toolUses?: readonly { input: Record<string, unknown> }[] }

// Every absolute path the conversation names, in a tool call's input or a
// message's text. A long input string, such as the content of a written
// file, is passed over and a long text is read only so far, since a resumed
// session holds up to 4096 messages and this runs again every FRESH_MS.
const INPUT_CHARS = 4096
const TEXT_CHARS = 20000
export const pathsIn = (rows: readonly Row[], home: string) => {
  const found = new Set<string>()
  const strings = (value: unknown): string[] =>
    typeof value === 'string'
      ? value.length > INPUT_CHARS
        ? []
        : [value]
      : Array.isArray(value)
        ? value.flatMap(strings)
        : value !== null && typeof value === 'object'
          ? Object.values(value).flatMap(strings)
          : []
  for (const row of rows)
    for (const text of [row.text.slice(0, TEXT_CHARS), ...(row.toolUses ?? []).flatMap(use => strings(use.input))])
      for (const match of text.match(ABSOLUTE) ?? []) {
        const path = match.replace(/\.+$/, '').replace(/\/+$/, '')
        found.add(path.startsWith('~/') ? `${home}${path.slice(1)}` : path)
      }

  return found
}

// A relative path with a slash in it, the only kind looked for elsewhere.
export const isPartial = (typed: string) => !/^(?:~\/|\.{1,2}\/|\/)/.test(typed) && typed.replace(/\/$/, '').includes('/')

// The one known path, or folder inside one, that ends in a relative path
// with a slash, as a message names a file the session reached outside its
// folder; none where two different ones do.
export const endingIn = (typed: string, known: Iterable<string>) => {
  if (!isPartial(typed)) return undefined
  const tail = `/${typed.replace(/\/$/, '')}`
  let match: string | undefined
  for (const path of known) {
    const inside = path.indexOf(`${tail}/`)
    const one = path.endsWith(tail) ? path : inside >= 0 ? path.slice(0, inside + tail.length) : undefined
    if (one === undefined || one === match) continue
    if (match !== undefined) return undefined
    match = one
  }

  return match
}

// The text with each piece that names a path in `targets` made a link to it.
// A code span becomes a link around the span, so it keeps its look.
export const linked = (text: string, targets: Map<string, string>) =>
  text.replace(PIECES, piece => {
    const isSpan = piece !== innerOf(piece)
    const inner = innerOf(piece)
    const path = pathOf(inner)
    const target = path === undefined ? undefined : targets.get(path)
    if (path === undefined || target === undefined) return piece
    // The line number rides as the fragment, which kitty hands to the editor.
    const line = lineAfter(inner, path)
    const to = line === undefined ? target : `${target}#${line}`
    if (isSpan) return `[${piece}](${to})`
    // The full stops left off the path stay outside the link.
    const label = inner.replace(/\.+$/, '')

    return `[${label}](${to})${inner.slice(label.length)}`
  })

// A text, or a batch of a streaming reply's lines, cut into the stretches
// inside and outside a fenced block. A fence may be indented, as under a
// list item, and closes at the next line that opens with its own mark. A
// fence can open in one batch and close in a later one, so the fence a batch
// starts inside is passed in and the one it ends inside is handed back. The
// parts joined by a newline are the text.
export const fencedParts = (text: string, fence: string | undefined) => {
  const parts: { text: string; isFenced: boolean }[] = []
  let inside = fence
  let held: string[] = []
  const close = (isFenced: boolean) => {
    if (held.length > 0) parts.push({ text: held.join('\n'), isFenced })
    held = []
  }
  for (const line of text.split('\n')) {
    const mark = /^[ \t]*(```|~~~)/.exec(line)?.[1]
    if (inside === undefined && mark !== undefined) {
      close(false)
      inside = mark
      held.push(line)
    } else if (inside !== undefined && mark === inside) {
      held.push(line)
      close(true)
      inside = undefined
    } else held.push(line)
  }
  close(inside !== undefined)

  return { parts, inside }
}

// A whole text without its fenced blocks. One left open runs to the end.
export const prose = (text: string) =>
  fencedParts(text, undefined)
    .parts.flatMap(one => (one.isFenced ? [] : [one.text]))
    .join('\n')

// The lines a preview shows: from four before the named one, or the top.
export const window = (line: number | undefined) => {
  const first = line === undefined ? 1 : Math.max(1, line - LINES_BEFORE)

  return { first, last: first + PREVIEW_LINES - 1 }
}

// Text a drawing takes: no control character but newline, tabs as spaces,
// each line cut short. A tree holding a C0 or C1 control character fails to
// validate, which drops the whole list. A NUL, or text that is more than a
// tenth U+FFFD (bytes that are no UTF-8), marks a binary file, which gets no
// preview; a Latin-1 file with a few such bytes still shows.
export const cleaned = (text: string) => {
  if (text.includes('\0') || (text.match(/\ufffd/g)?.length ?? 0) * 10 > text.length) return undefined

  return text
    .replace(/\n$/, '')
    .split('\n')
    .map(one => {
      const line = one.replaceAll('\t', '    ').replace(/[\x00-\x1f\x7f-\x9f]/g, '')

      // Cut by code point, so that no half of a surrogate pair is left.
      return line.length > LINE_CHARS ? `${Array.from(line).slice(0, LINE_CHARS).join('')}…` : line
    })
    .join('\n')
}

// The largest box of cells with the picture's proportions that fits, no
// larger than the picture's own size.
export const fit = (width: number, height: number, columns: number) => {
  const scale = Math.min(
    1,
    (Math.min(columns, PICTURE_COLUMNS) * CELL_WIDTH_PX) / width,
    (PICTURE_ROWS * CELL_HEIGHT_PX) / height,
  )

  return {
    columns: Math.max(1, Math.round((width * scale) / CELL_WIDTH_PX)),
    rows: Math.max(1, Math.round((height * scale) / CELL_HEIGHT_PX)),
  }
}

type Found = { kind: 'file' | 'dir'; stamp: number }

const onDisk = new Map<string, { at: number; found: Found | undefined }>()

const look = async ($: EngineInterface, path: string) => {
  const had = onDisk.get(path)
  if (had !== undefined && Date.now() - had.at < FRESH_MS) return had.found
  const found = await $.fs.stat(path).then(
    stat => (stat.kind === 'file' || stat.kind === 'dir' ? { kind: stat.kind, stamp: Math.floor(stat.mtimeMs) } : undefined),
    () => undefined,
  )
  if (onDisk.size >= MAX_REMEMBERED) onDisk.clear()
  onDisk.set(path, { at: Date.now(), found })

  return found
}

// The conversation's paths, read again at most once in this long. The read
// is kept while it runs, so the paths of one drawing share it.
let known: { at: number; paths: Promise<Set<string>> } | undefined

const knownPaths = ($: EngineInterface, home: string) => {
  if (known === undefined || Date.now() - known.at >= FRESH_MS)
    known = { at: Date.now(), paths: $.session.messages().then(rows => pathsIn(rows, home), () => new Set<string>()) }

  return known.paths
}

// What a preview drew, by path and the first line it shows, redone when the
// file's modification time moves or, for a folder, after FRESH_MS.
type Preview =
  | { kind: 'lines'; source: string; first: number }
  | { kind: 'listing'; text: string }
  | { kind: 'picture'; png: string; width: number; height: number }
  | { kind: 'none'; why: string }
const previews = new Map<string, { stamp: number; preview: Preview }>()

// The command's output, or undefined where it failed, could not start or ran
// past the timeout (which `$.process.run` rejects).
const run = async ($: EngineInterface, argv: string[]) => {
  const done = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)

  return done?.exitCode === 0 ? done.stdout : undefined
}

const lines = async ($: EngineInterface, path: string, line: number | undefined): Promise<Preview> => {
  let { first, last } = window(line)
  let text = await run($, ['sed', '-n', `${first},${last}p;${last}q`, path])
  // A window that runs past the end shows the file's last lines. awk counts a
  // last line with no newline after it, which `wc -l` leaves out.
  if (text !== undefined && first > 1 && text.split('\n').length - Number(text.endsWith('\n')) < PREVIEW_LINES) {
    const count = Number((await run($, ['awk', 'END { print NR }', path]))?.trim() ?? 0)
    first = Math.max(1, count - PREVIEW_LINES + 1)
    last = first + PREVIEW_LINES - 1
    text = await run($, ['sed', '-n', `${first},${last}p;${last}q`, path])
  }
  if (text === undefined) return { kind: 'none', why: 'unreadable' }
  const source = cleaned(text)
  if (source === undefined) return { kind: 'none', why: 'binary file' }

  return source === '' ? { kind: 'none', why: 'empty file' } : { kind: 'lines', source, first }
}

const listing = async ($: EngineInterface, path: string): Promise<Preview> => {
  const entries = await $.fs.list(path).catch(() => undefined)
  if (entries === undefined) return { kind: 'none', why: 'unreadable' }
  if (entries.length === 0) return { kind: 'none', why: 'empty folder' }
  const names = [...entries]
    .sort((a, b) => Number(b.kind === 'dir') - Number(a.kind === 'dir') || a.name.localeCompare(b.name))
    .map(one => (one.kind === 'dir' ? `${one.name}/` : one.name))
  const more = names.length > LISTED ? [`… ${names.length - LISTED} more`] : []

  return { kind: 'listing', text: cleaned([...names.slice(0, LISTED), ...more].join('\n')) ?? '' }
}

// A PNG opens with an 8-byte signature and the IHDR chunk, whose width and
// height are big-endian at bytes 16 and 20. `$.fs.read` rejects a file over
// 4 MiB and reads nothing less than a whole file, so the header comes from
// `od`, as hex.
const pngSize = async ($: EngineInterface, path: string) => {
  const stdout = (await run($, ['od', '-An', '-tx1', '-N24', path])) ?? ''
  const bytes = stdout.trim().split(/\s+/).map(hex => parseInt(hex, 16))
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return undefined
  const word = (at: number) => bytes.slice(at, at + 4).reduce((sum, byte) => sum * 256 + byte, 0)

  return { width: word(16), height: word(20) }
}

const hash = (text: string) => {
  let sum = 5381
  for (let i = 0; i < text.length; i++) sum = ((sum * 33) ^ text.charCodeAt(i)) >>> 0

  return sum.toString(16)
}

const picture = async ($: EngineInterface, path: string, stamp: number, home: string): Promise<Preview> => {
  let png = path
  if (!/\.png$/i.test(path)) {
    const folder = `${(await $.env.get('XDG_CACHE_HOME')) ?? `${home}/.cache`}/pathview`
    png = `${folder}/${hash(path)}-${stamp}.png`
    if (!(await $.fs.exists(png))) {
      await run($, ['mkdir', '-p', folder])
      // `[0]` takes the first frame of an animation.
      if ((await run($, ['magick', `${path}[0]`, '-resize', CONVERT_MAX_PX, png])) === undefined) return { kind: 'none', why: 'not drawn' }
    }
  }
  const size = await pngSize($, png)

  return size === undefined ? { kind: 'none', why: 'not drawn' } : { kind: 'picture', png, ...size }
}

const preview = async ($: EngineInterface, entry: Entry, home: string, hasPictures: boolean) => {
  // A picture is neither read nor converted where the terminal draws none.
  if (entry.isImage && !hasPictures) return { kind: 'none', why: 'this terminal draws no pictures' } as const
  const key = `${entry.path}#${entry.line ?? ''}`
  // A folder's time does not move when a file inside it changes.
  const stamp = entry.kind === 'dir' ? Math.floor(Date.now() / FRESH_MS) : entry.stamp
  const had = previews.get(key)
  if (had?.stamp === stamp) return had.preview
  const made = await (entry.kind === 'dir' ? listing($, entry.path) : entry.isImage ? picture($, entry.path, entry.stamp, home) : lines($, entry.path, entry.line)).catch(
    (): Preview => ({ kind: 'none', why: 'unreadable' }),
  )
  if (previews.size >= MAX_REMEMBERED) previews.clear()
  previews.set(key, { stamp, preview: made })

  return made
}

// What the machine is: the system, the variables that tell a terminal and an
// editor apart, and which programs are on PATH. PATH is searched once for
// each set of answers to the rest, since that takes a process.
const onPath = new Map<string, Promise<ReadonlySet<string> | undefined>>()
// When a search last could not run, by the same key: it is made again after
// this long, so a machine where it keeps failing does not wait on it at
// every drawing.
const failedAt = new Map<string, number>()
const RETRY_MS = 60000
const factsOf = async ($: EngineInterface, settings: Settings): Promise<Facts> => {
  const info = await $.session.info().catch(() => undefined)
  const home = (await $.env.get('HOME')) ?? ''
  // Each name is written out, since the validator lists the variables a mod reads.
  const [TERM, TERM_PROGRAM, KITTY_WINDOW_ID, KITTY_LISTEN_ON, TMUX, SSH_CONNECTION, REMOTE_CONTAINERS, CODESPACES, CURSOR_TRACE_ID, VISUAL, EDITOR] = await Promise.all([
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('KITTY_LISTEN_ON'),
    $.env.get('TMUX'),
    $.env.get('SSH_CONNECTION'),
    $.env.get('REMOTE_CONTAINERS'),
    $.env.get('CODESPACES'),
    $.env.get('CURSOR_TRACE_ID'),
    $.env.get('VISUAL'),
    $.env.get('EDITOR'),
  ])
  const env = { TERM, TERM_PROGRAM, KITTY_WINDOW_ID, KITTY_LISTEN_ON, TMUX, SSH_CONNECTION, REMOTE_CONTAINERS, CODESPACES, CURSOR_TRACE_ID, VISUAL, EDITOR }
  const platform = info?.platform ?? 'unknown'
  const own = [settings.editorCommand, settings.terminalCommand, settings.imageCommand, settings.browserCommand].flatMap(one => programOf(one, home) ?? [])
  const asked = [
    ...new Set([
      ...PROGRAMS,
      ...own,
      ...[VISUAL, EDITOR].flatMap(one => programOf(one, home) ?? []),
    ]),
  ]
  const key = JSON.stringify([platform, env, asked, home])
  const now = await $.clock.now().catch(() => Date.now())
  const failed = failedAt.get(key)
  if (failed !== undefined && now - failed < RETRY_MS) return { platform, isHosted: info?.isHosted ?? false, env, home, found: new Set() }
  let search = onPath.get(key)
  if (search === undefined) {
    failedAt.delete(key)
    // Windows has no `sh`; the mod draws nothing there. What the search
    // printed is taken whatever it exits with, since a loop exits as its last
    // test did; only a search that could not run, or ran out of time, failed.
    const searched =
      platform === 'windows'
        ? Promise.resolve('')
        : $.process
            .run(['sh', '-c', 'for one in "$@"; do command -v "$one" >/dev/null 2>&1 && printf "%s\\n" "$one"; done; exit 0', 'sh', ...asked], { timeoutMs: 5000 })
            .then(
              done => done.stdout,
              error => void $.ui.log(`pathview: the search of PATH failed, so no button is drawn: ${String(error)}`, { to: 'debug' }),
            )
    search = searched.then(out => {
      if (out === undefined) return undefined
      const found = new Set(out.split('\n').filter(one => one !== ''))
      // A setting that names a program the machine lacks falls through to the
      // next route; the debug log says so once.
      for (const one of own) if (!found.has(one) && platform !== 'windows') $.ui.log(`pathview: ${one}, which a setting names, is not on PATH`, { to: 'debug' })

      return found
    })
    if (onPath.size >= 20) onPath.clear()
    onPath.set(key, search)
  }
  const found = await search
  // A search that failed is made again after RETRY_MS, and until then the
  // buttons are missing.
  if (found === undefined && onPath.get(key) === search) {
    onPath.delete(key)
    failedAt.set(key, now)
  }

  return { platform, isHosted: info?.isHosted ?? false, env, home, found: found ?? new Set() }
}

// A program that stays open, started with its output let go, since
// `$.process.run` waits until the output pipe closes. `setsid` gives it a
// session of its own where the system has it, which macOS does not.
const detached = async ($: EngineInterface, argv: string[], facts: Facts) => {
  const started = await run(
    $,
    facts.found.has('setsid')
      ? ['sh', '-c', 'exec setsid -f "$@" >/dev/null 2>&1 </dev/null', 'sh', ...argv]
      : ['sh', '-c', 'nohup "$@" >/dev/null 2>&1 </dev/null &', 'sh', ...argv],
  )
  if (started === undefined) $.ui.log(`pathview: ${argv[0]} could not be started`, { to: 'debug' })

  return started
}

// Starts what `opening` or `terminalIn` decided. A kitty window of its own
// comes through `kitten @`, which reaches the kitty this session runs in;
// where it cannot, as after kitty restarted, a new kitty starts.
const launch = async ($: EngineInterface, what: Launch | undefined, facts: Facts) => {
  if (what === undefined) return
  if ('argv' in what) return void (await detached($, what.argv, facts))
  const { folder, argv } = what.kitty
  const reached = facts.env.KITTY_LISTEN_ON !== undefined && (await run($, ['kitten', '@', 'launch', '--type=os-window', `--cwd=${folder}`, ...argv])) !== undefined
  if (!reached) await detached($, ['kitty', '--directory', folder, ...argv], facts)
}

type Entry = Mention & Found & { path: string; isImage: boolean }

const toggled = atom({ plugin: 'pathview', key: 'toggled' } as const, [] as string[])
// What a placed row lists: the paths its reply named, as typed.
const listed = atom({ plugin: 'pathview', key: 'listed' } as const, [] as Mention[])
const WHOLE = '*'

// The paths among the typed ones that are on disk, one entry per path under
// its first mention, and the link target of each typed form.
const onDiskAmong = async ($: EngineInterface, typed: readonly Mention[]) => {
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const found = await Promise.all(
    typed.map(async (one): Promise<Entry | undefined> => {
      let path = absolute(one.typed, home, cwd)
      let there = await look($, path)
      if (there === undefined) {
        if (!isPartial(one.typed)) return undefined
        const elsewhere = endingIn(one.typed, await knownPaths($, home))
        if (elsewhere === undefined) return undefined
        path = elsewhere
        there = await look($, path)
      }

      return there === undefined ? undefined : { ...one, ...there, path, isImage: there.kind === 'file' && IMAGE.test(path) }
    }),
  )
  // Two ways of naming one path make one entry, under the first.
  const byPath = new Map<string, Entry>()
  for (const one of found) if (one !== undefined && !byPath.has(one.path)) byPath.set(one.path, one)
  const targets = new Map(found.filter(one => one !== undefined).map(one => [one.typed, href(one.path)] as const))

  return { entries: [...byPath.values()], targets, home, cwd }
}

// The fence each streaming reply's last batch ended inside, by message.
const fences = new Map<string, string>()

// The mod draws nothing on a reply's own row. A `ui.render` hook on
// `AssistantMessage`, even one that only passes the message on, makes the
// terminal draw the finished reply blank for one frame, since a new row is
// blank until its hook first answers. So the links go into the text as it
// is shown, and the list into a row of the mod's own after the reply.
export const register: Register = (on, options) => {
  const text = (name: string) => (typeof options?.[name] === 'string' ? (options[name] as string).trim() : '')
  const settings: Settings = {
    editor: EDITORS.includes(text('editor')) ? text('editor') : 'auto',
    editorCommand: text('editorCommand'),
    terminalCommand: text('terminalCommand'),
    imageCommand: text('imageCommand'),
    browserCommand: text('browserCommand'),
  }

  // The links: each batch of lines a streaming reply shows, with the paths
  // outside a fenced block made links. What is stored and what the model
  // reads stay as written. Only a session that draws in a terminal gets
  // them, since a `claude -p` run prints what is shown as its answer.
  on('classic.MessageDisplay', async ($, e, next) => {
    const beneath = await next(e)
    // The system alone is asked here, so no batch waits for the search of PATH.
    if (!(await $.session.surfaces()).includes('terminal') || (await $.session.info().catch(() => undefined))?.platform === 'windows') return beneath
    const shown = beneath?.displayContent ?? e.delta
    const { parts, inside } = fencedParts(shown, fences.get(e.message_id))
    if (inside === undefined || e.final) fences.delete(e.message_id)
    else {
      if (fences.size >= MAX_REMEMBERED) fences.clear()
      fences.set(e.message_id, inside)
    }
    const typed = mentions(parts.flatMap(one => (one.isFenced ? [] : [one.text])).join('\n')).slice(0, MAX_CANDIDATES)
    if (typed.length === 0) return beneath
    const { targets } = await onDiskAmong($, typed)
    if (targets.size === 0) return beneath

    return { ...beneath, displayContent: parts.map(one => (one.isFenced ? one.text : linked(one.text, targets))).join('\n') }
  })

  // The list: a row placed after each block of a reply that names a path on
  // disk. A subagent's reply gets none. The row is placed from a timer and
  // not in the hook itself: `$.ui.place` puts a row at the transcript's end,
  // and the reply's own row is not there until this hook has returned, so a
  // row placed here would stand above its reply.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door !== 'response' || e.message.type !== 'assistant' || e.agentId !== undefined) return stored
    // The text as a hook beneath left it, which is what the reply's row shows.
    const text = (stored?.message ?? e.message).content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n\n')
    const typed = mentions(prose(text)).slice(0, MAX_CANDIDATES)
    if (typed.length === 0) return stored
    const id = `m-${e.uuid}`
    // A failure leaves the reply without its list, and stored all the same;
    // the debug log says why. Windows gets no row, since nothing would be
    // drawn in it.
    const place = async () => {
      if ((await $.session.info().catch(() => undefined))?.platform === 'windows') return
      if ((await onDiskAmong($, typed)).entries.length === 0) return
      const placed = await $.ui.place({ id })
      const row = placed.requestId
      if (row === undefined) return void $.ui.log(`pathview: no list placed${placed.isPlaced ? '' : `: ${placed.reason}`}`, { to: 'debug' })
      await update($, memberOf(listed, { requestId: row }), () => typed)
    }
    $.clock.after(0, () => place().catch(error => $.ui.log(`pathview: no list placed: ${String(error)}`, { to: 'debug' })))

    return stored
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== 'pathview' || e.surface !== 'terminal') return next(e)
    const facts = await factsOf($, settings)
    if (facts.platform === 'windows') return next(e)
    const hasPictures = drawsPictures(facts)
    const { entries, home, cwd } = await onDiskAmong($, await read($, memberOf(listed, e)))
    if (entries.length === 0) return next(e)

    const ofRow = memberOf(toggled, e)
    const turned = new Set(await read($, ofRow))
    // Open is where a fold starts, turned by each press on it.
    const isOpen = (key: string, starts: boolean) => starts !== turned.has(key)
    const toggle = (key: string) => () =>
      void update($, ofRow, keys => (keys.includes(key) ? keys.filter(one => one !== key) : [...keys, key]))
    const hasHeader = entries.length > 1
    const isWhole = !hasHeader || isOpen(WHOLE, entries.length <= OPEN_UP_TO)
    const shown = isWhole ? entries.slice(0, MAX_ROWS) : []
    const drawn = await Promise.all(shown.map(async one => (isOpen(one.path, one.isImage && hasPictures) ? preview($, one, home, hasPictures) : undefined)))

    // A button is drawn only where its press has something to start.
    const opens = shown.map(one => opening(targetOf(one), cwd, settings, facts))
    const terminals = shown.map(one => terminalIn(folderOf(one.path), settings, facts))

    const { Box, Button, Code, Image, Text } = $.ui.resolve(e)
    // The room beside the rule: the list's indent, the rule and its gap.
    const columns = Math.max(1, (e.viewport?.columns ?? 80) - 4)

    return (
      <Box flexDirection="column" alignItems="flex-start" marginLeft={2}>
        {hasHeader && (
          <Button key="fold-all" label={`${isWhole ? '▼' : '▶'} ${entries.length} files`} plain dimColor onPress={toggle(WHOLE)} />
        )}
        {shown.map((one, i) => {
          const made = drawn[i]
          const label = `${made === undefined ? '▶' : '▼'} ${one.typed}${one.line === undefined ? '' : `:${one.line}`}${one.kind === 'dir' && !one.typed.endsWith('/') ? '/' : ''}`
          const title = (
            <Box flexDirection="row" columnGap={2}>
              <Button key={`fold-${i}`} label={label} plain dimColor onPress={toggle(one.path)} />
              {opens[i] !== undefined && (
                <Button key={`open-${i}`} label="open" plain dimColor onPress={() => void launch($, opens[i], facts).catch(() => undefined)} />
              )}
              {one.kind === 'file' && terminals[i] !== undefined && (
                <Button key={`terminal-${i}`} label="terminal" plain dimColor onPress={() => void launch($, terminals[i], facts).catch(() => undefined)} />
              )}
            </Box>
          )
          if (made === undefined) return title
          const box = made.kind === 'picture' ? fit(made.width, made.height, columns) : undefined
          // A dim rule down the left of an open preview, one cell per row.
          const height = box?.rows ?? (made.kind === 'lines' ? made.source : made.kind === 'listing' ? made.text : '').split('\n').length

          return (
            <Box flexDirection="column">
              {title}
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>{Array(height).fill('│').join('\n')}</Text>
                {made.kind === 'picture' && box !== undefined && (
                  <Image source={{ file: made.png, format: 'png', generation: one.stamp }} {...box} alt={one.typed} />
                )}
                {made.kind === 'lines' && <Code source={made.source} path={one.path} startLine={made.first} wrap="truncate-end" />}
                {made.kind === 'listing' && <Text>{made.text}</Text>}
                {made.kind === 'none' && <Text dimColor>{made.why}</Text>}
              </Box>
            </Box>
          )
        })}
        {shown.length < entries.length && isWhole && <Text dimColor>{`  +${entries.length - shown.length} more`}</Text>}
      </Box>
    )
  })
}
