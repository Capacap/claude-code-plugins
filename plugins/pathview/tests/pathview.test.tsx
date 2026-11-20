import { expect, test } from 'claude-code/testing'

import { drawsPictures, opening, screenOf, terminalIn } from '../hooks/openers'
import type { Facts, Settings } from '../hooks/openers'
import { cleaned, endingIn, fencedParts, fit, linked, mentions, pathOf, pathsIn, prose, window } from '../hooks/register'

// A machine with kitty, as the mod's own probe of PATH is answered: the
// programs among those it asks about that this machine has.
const KITTY_ENV: Record<string, string> = { HOME: '/home/someone', KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty', EDITOR: 'fresh' }
const onPath = (argv: readonly string[], has: readonly string[]) =>
  argv[0] === 'sh' && argv[2]?.startsWith('for one') ? argv.slice(4).filter(one => has.includes(one)).map(one => `${one}\n`).join('') : undefined
const LINUX = ['kitty', 'setsid', 'xdg-open', 'fresh']

test('a piece is a path where it has a slash or a file suffix, without its line number or full stop', () => {
  expect(pathOf('claude/hooks/lib/words.py:42')).toBe('claude/hooks/lib/words.py')
  expect(pathOf('deploy.sh.')).toBe('deploy.sh')
  expect(pathOf('~/.notes.md')).toBe('~/.notes.md')
  expect(pathOf('kitty/')).toBe('kitty/')
  expect(pathOf('kitty')).toBe(undefined)
  expect(pathOf('0.1.0')).toBe(undefined)
  expect(pathOf('git status')).toBe(undefined)
})

test('fenced blocks, links and URLs are passed over, code spans and bare paths are mentions, once each with the first line number', () => {
  const text = [
    'See `deploy.sh` and claude/mods/nts/hooks/register.tsx:12, also `git commit -m x`.',
    'Not https://example.com/a/b.md, not [the doc](docs/old.md).',
    '```',
    'cat inside/fence.md',
    '```',
    'Again deploy.sh:9 and claude/mods/nts/hooks/register.tsx:40.',
  ].join('\n')
  expect(mentions(prose(text))).toEqual([{ typed: 'deploy.sh' }, { typed: 'claude/mods/nts/hooks/register.tsx', line: 12 }])
})

test('a known path becomes a link, a code span keeps its backticks, the full stop stays outside, a line number becomes the fragment', () => {
  const targets = new Map([['deploy.sh', 'file:///work/deploy.sh']])
  expect(linked('Run `deploy.sh`, then read deploy.sh:7. Not other.sh.', targets)).toBe(
    'Run [`deploy.sh`](file:///work/deploy.sh), then read [deploy.sh:7](file:///work/deploy.sh#7). Not other.sh.',
  )
})

test('the paths a conversation names, in tool inputs and texts, passing over long input strings', () => {
  const rows = [
    { role: 'user', text: 'Look at ~/notes/todo.md.', toolUses: [] },
    {
      role: 'assistant',
      text: '',
      toolUses: [
        { input: { file_path: '/sync/proj/handoff/a-file.md' } },
        { input: { command: "cat '/srv/x.txt' | wc" } },
        { input: { file_path: '/w/big.md', content: `see /long/one.md ${'x'.repeat(5000)}` } },
      ],
    },
  ]
  expect([...pathsIn(rows, '/home/someone')].sort()).toEqual(['/home/someone/notes/todo.md', '/srv/x.txt', '/sync/proj/handoff/a-file.md', '/w/big.md'])
})

test('a relative path with a slash finds the one known path ending in it, and none where two do', () => {
  const known = ['/sync/proj/handoff/a-file.md', '/sync/proj/handoff/b.md', '/a/docs/x.md', '/b/docs/x.md']
  expect(endingIn('handoff/a-file.md', known)).toBe('/sync/proj/handoff/a-file.md')
  expect(endingIn('proj/handoff/', known)).toBe('/sync/proj/handoff')
  expect(endingIn('a/docs', known)).toBe('/a/docs')
  expect(endingIn('docs/x.md', known)).toBe(undefined)
  expect(endingIn('a-file.md', known)).toBe(undefined)
  expect(endingIn('./handoff/a-file.md', known)).toBe(undefined)
  expect(endingIn('dlehandoff/a-file.md', ['/x/middlehandoff/a-file.md'])).toBe(undefined)
})

test('a preview shows ten lines from four before the named one, or from the top', () => {
  expect(window(57)).toEqual({ first: 53, last: 62 })
  expect(window(2)).toEqual({ first: 1, last: 10 })
  expect(window(undefined)).toEqual({ first: 1, last: 10 })
})

test('preview text loses control characters, tabs become spaces, long lines are cut, a NUL means binary', () => {
  expect(cleaned('a\tb\x1b[31mred\r\nnext\n')).toBe('a    b[31mred\nnext')
  expect(cleaned('ok \x9b31m red \u0085 nel')).toBe('ok 31m red  nel')
  expect(cleaned(`${'😀'.repeat(401)}`)).toBe(`${'😀'.repeat(400)}…`)
  expect(cleaned('\x89PNG\ufffd\ufffd')).toBe(undefined)
  expect(cleaned('Latin-1 bytes in a line: caf\ufffd au lait, cr\ufffdme')).toBe('Latin-1 bytes in a line: caf\ufffd au lait, cr\ufffdme')
  expect(cleaned(`${'x'.repeat(500)}\n`)).toBe(`${'x'.repeat(400)}…`)
  expect(cleaned('PK\0\x03')).toBe(undefined)
})

test('a box keeps the proportions, is capped, and never enlarges a small picture', () => {
  expect(fit(3840, 2176, 200)).toEqual({ columns: 71, rows: 20 })
  expect(fit(3840, 960, 60)).toEqual({ columns: 60, rows: 8 })
  expect(fit(32, 32, 100)).toEqual({ columns: 3, rows: 2 })
})

// What `od -An -tx1 -N24` prints for a PNG of this size.
const header = (width: number, height: number) => {
  const word = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...word(width), ...word(height)]

  return ` ${bytes.map(byte => byte.toString(16).padStart(2, '0')).join(' ')}\n`
}

type Node = { props: unknown; text?: string }
const labels = (nodes: Node[]) => nodes.map(one => (one.props as { label: string }).label)

// What stands for the engine where the mod places a row: the row's id is the
// id it was placed under, and the timer the placing waits on runs at once.
const placing = (on: any) => {
  const placed: string[] = []
  on('ui.place', (_: unknown, e: { id: string }) => {
    placed.push(e.id)

    return { value: { isPlaced: true as const, requestId: e.id } }
  })
  on('clock.after', () => ({ value: undefined }))

  return placed
}

const pause = () => new Promise(done => setTimeout(done, 20))

// What stands for the engine under the display hook: a session that draws
// in a terminal, and no other hook's answer.
const showing = (on: any) => {
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('classic.MessageDisplay', () => ({}))
}

// A block of a reply as the engine stores one, raised at the mod.
const store = async ($: any, text: string, uuid: string, more: object = {}) => {
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'a-model' },
    uuid,
    ...more,
  })
  // The row is placed from a timer, after the hook has returned.
  await pause()
}

// The row the mod placed after such a block, mounted.
const listOf = async ($: any, text: string, surface: 'terminal' | 'desktop' = 'terminal', uuid = 'block-1') => {
  await store($, text, uuid)

  return $.ui.mount({
    plugin: 'pathview',
    surface,
    component: 'Placed',
    requestId: `m-${uuid}`,
    props: { id: `m-${uuid}`, plugin: 'pathview' },
    viewport: { columns: 100, rows: 40 },
  } as never)
}

// A batch of a streaming reply's lines, raised at the mod: what it shows.
const shownOf = async ($: any, delta: string, more: object = {}) =>
  (
    await $.classic.MessageDisplay({
      hook_event_name: 'MessageDisplay',
      session_id: 'a-session',
      transcript_path: '/transcript.jsonl',
      cwd: '/',
      turn_id: 'a-turn',
      message_id: 'a-message',
      index: 0,
      final: false,
      delta,
      ...more,
    })
  )?.displayContent ?? delta

test('a batch is cut at each fence, and a fence left open carries into the next batch', () => {
  expect(fencedParts('See a.md.\n```sh\ncat b.md', undefined)).toEqual({
    parts: [
      { text: 'See a.md.', isFenced: false },
      { text: '```sh\ncat b.md', isFenced: true },
    ],
    inside: '```',
  })
  expect(fencedParts('cat c.md\n```\nThen d.md.', '```')).toEqual({
    parts: [
      { text: 'cat c.md\n```', isFenced: true },
      { text: 'Then d.md.', isFenced: false },
    ],
    inside: undefined,
  })
  // A fence indented under a list item is one, and closes at any indent.
  expect(fencedParts('1. Run:\n   ```sh\n   cat a.md\n   ```\n2. Read b.md.', undefined).parts).toEqual([
    { text: '1. Run:', isFenced: false },
    { text: '   ```sh\n   cat a.md\n   ```', isFenced: true },
    { text: '2. Read b.md.', isFenced: false },
  ])
  // A whole text loses its fenced blocks, one left open to its end.
  expect(prose('See a.md.\n```\ncat b.md\n```\nAnd c.md.\n~~~\ncat d.md')).toBe('See a.md.\nAnd c.md.')
  // A tilde fence is not closed by backticks.
  expect(fencedParts('```\nx', '~~~').inside).toBe('~~~')
  const text = 'a\n```\nb\n```\n\nc\n'
  expect(fencedParts(text, undefined).parts.map(one => one.text).join('\n')).toBe(text)
})

test('a reply is shown with links in its text, and a folding list of its paths is placed after it', async ($, on) => {
  const ran: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_LISTEN_ON' ? 'unix:@kitty-1' : KITTY_ENV[e.name] }))
  on('session.cwd', () => ({ value: '/work dir' }))
  on('session.messages', () => ({ value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 't1', tool: 'Write', input: { file_path: '/sync/handoff/a-file.md' } }] }] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({
    value: [
      { name: 'b.txt', kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false },
      { name: 'sub', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false },
    ],
  }))
  on('fs.stat', (_, e) => {
    if (e.path.endsWith('gone.md') || e.path.startsWith('/work dir/handoff')) throw new Error('ENOENT')

    return { value: { kind: /www|\/sub$/.test(e.path) ? ('dir' as const) : ('file' as const), size: 1, mtimeMs: 7.5, isLink: false } }
  })
  on('process.run', (_, e) => {
    ran.push(e.argv[0] === 'magick' ? 'magick' : e.argv.join(' '))
    const stdout = onPath(e.argv, LINUX) ?? (e.argv[0] === 'od' ? header(800, 400) : e.argv[0] === 'sed' ? 'line one\n\tline two\n' : '')

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  // Stands for the engine's drawing of a placed row the mod leaves alone.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>nothing</Text>
  })
  showing(on)
  const placed = placing(on)
  const mount = (text: string, surface: 'terminal' | 'desktop' = 'terminal', uuid = 'block-1') => listOf($, text, surface, uuid)

  // Nothing that exists: the text as it was, and no row.
  expect(await shownOf($, 'Nothing here, gone.md is no file.')).toBe('Nothing here, gone.md is no file.')
  await store($, 'Nothing here, gone.md is no file.', 'block-0')
  expect(placed).toEqual([])
  // A subagent's reply gets no row either.
  await store($, 'Edited src/a.py:3.', 'block-sub', { agentId: 'an-agent' })
  expect(placed).toEqual([])

  // Three paths: each a link in the text as it is shown.
  const text = 'Edited src/a.py:3 and wrote `handoff/a-file.md`, see ~/shot.jpg, gone.md is no file.'
  expect(await shownOf($, text)).toBe(
    'Edited [src/a.py:3](file:///work%20dir/src/a.py#3) and wrote [`handoff/a-file.md`](file:///sync/handoff/a-file.md), see [~/shot.jpg](file:///home/someone/shot.jpg), gone.md is no file.',
  )
  // A path in a fenced block stays as written, also where the fence opened
  // in an earlier batch.
  expect(await shownOf($, 'Run:\n```sh\ncat src/a.py', { message_id: 'fenced' })).toBe('Run:\n```sh\ncat src/a.py')
  expect(await shownOf($, 'cat src/a.py\n```\nThat was src/a.py.', { message_id: 'fenced', index: 1 })).toBe(
    'cat src/a.py\n```\nThat was [src/a.py](file:///work%20dir/src/a.py).',
  )

  // A fence indented under a list item keeps its path as written too.
  expect(await shownOf($, '1. Run:\n   ```sh\n   cat src/a.py\n   ```', { message_id: 'indented' })).toBe('1. Run:\n   ```sh\n   cat src/a.py\n   ```')
  // A fence left open at a message's last batch is not carried into a later
  // message of the same id.
  await shownOf($, '```\ncat src/a.py', { message_id: 'ended', final: true })
  expect(await shownOf($, 'See src/a.py.', { message_id: 'ended' })).toBe('See [src/a.py](file:///work%20dir/src/a.py).')

  // A row that is no reply's block gets no list: a tool's result, a row
  // that is no assistant's, a block with no text, a path only in a fence.
  await store($, 'Edited src/a.py:3.', 'block-tool', { door: 'tool-result' })
  await store($, 'Edited src/a.py:3.', 'block-user', { message: { type: 'user', role: 'user', content: [{ type: 'text', text: 'Edited src/a.py:3.' }] } })
  await store($, '', 'block-call', { message: { type: 'assistant', role: 'assistant', content: [{ type: 'tool_use', id: 't9', name: 'Read', input: { file_path: 'src/a.py' } }] } })
  await store($, '```\ncat src/a.py\n```', 'block-fence')
  expect(placed).toEqual([])

  // The list starts open, the picture unfolded, the file folded.
  const three = await mount(text)
  expect(placed).toEqual(['m-block-1'])
  expect(labels(await three.findAll({ type: 'Button' }))).toEqual(['▼ 3 files', '▶ src/a.py:3', 'open', 'terminal', '▶ handoff/a-file.md', 'open', 'terminal', '▼ ~/shot.jpg', 'open', 'terminal'])
  expect((await three.findAll({ type: 'Image' })).map(one => (one.props as { source: { file: string } }).source.file)).toEqual([
    `/home/someone/.cache/pathview/${ran.find(one => one.startsWith('od'))?.split('/').pop()}`,
  ])
  expect(ran.filter(one => one.startsWith('sed'))).toEqual([])

  // Unfolding the file reads its lines around line 3; the picture folds away.
  await three.press({ key: 'fold-0' })
  await three.press({ key: 'fold-2' })
  const code = (await three.findAll({ type: 'Code' })).map(one => one.props as { source: string; startLine: number })
  expect(code).toEqual([expect.objectContaining({ source: 'line one\n    line two', startLine: 1 })])
  expect(await three.findAll({ type: 'Image' })).toEqual([])
  expect((await three.findAll({ type: 'Text' })).map(one => one.text)).toContain('│\n│')
  expect(ran.filter(one => one.startsWith('sed'))).toEqual(['sed -n 1,10p;10q /work dir/src/a.py'])

  // `open` takes a file to $EDITOR at its line in a kitty window, and the
  // picture to the system's opener.
  await three.press({ key: 'open-0' })
  await three.press({ key: 'open-2' })
  expect(ran.slice(-2)).toEqual([
    'kitten @ launch --type=os-window --cwd=/work dir fresh /work dir/src/a.py:3',
    'sh -c exec setsid -f "$@" >/dev/null 2>&1 </dev/null sh xdg-open /home/someone/shot.jpg',
  ])

  // `terminal` starts a shell in the folder that holds the file.
  await three.press({ key: 'terminal-1' })
  expect(ran.at(-1)).toBe('kitten @ launch --type=os-window --cwd=/sync/handoff')

  // The folds hold through a redraw and are kept per row.
  await three.redraw({ id: 'm-block-1', plugin: 'pathview' })
  expect(labels(await three.findAll({ type: 'Button' }))[1]).toBe('▼ src/a.py:3')
  const other = await mount(text, 'terminal', 'block-2')
  expect(labels(await other.findAll({ type: 'Button' }))[1]).toBe('▶ src/a.py:3')
  await other.unmount()

  // The list folds whole.
  await three.press({ key: 'fold-all' })
  expect(labels(await three.findAll({ type: 'Button' }))).toEqual(['▶ 3 files'])
  await three.unmount()

  // More than three paths start folded; more than eight show eight and a count.
  const many = Array.from({ length: 11 }, (_, i) => `f${i}.md`).join(' ')
  const long = await mount(`Files: ${many}, the folder /srv/www/sub.`, 'terminal', 'block-3')
  expect(labels(await long.findAll({ type: 'Button' }))).toEqual(['▶ 12 files'])
  await long.press({ key: 'fold-all' })
  expect(labels(await long.findAll({ type: 'Button' })).filter(one => one !== 'open' && one !== 'terminal')).toHaveLength(9)
  expect((await long.findAll({ type: 'Text' })).map(one => one.text).at(-1)).toBe('  +4 more')
  await long.unmount()

  // A folder unfolds to its listing, folders first.
  const folder = await mount('Look in /srv/www/sub.', 'terminal', 'block-4')
  expect(labels(await folder.findAll({ type: 'Button' }))).toEqual(['▶ /srv/www/sub/', 'open'])
  await folder.press({ key: 'fold-0' })
  expect((await folder.findAll({ type: 'Text' })).map(one => one.text).at(-1)).toBe('sub/\nb.txt')
  await folder.unmount()

  // Another mod's row is left to it.
  const others = await $.ui.mount({
    plugin: 'pathview',
    surface: 'terminal',
    component: 'Placed',
    requestId: 'm-block-1',
    props: { id: 'm-block-1', plugin: 'another-mod' },
    viewport: { columns: 100, rows: 40 },
  } as never)
  expect(await others.findAll({ type: 'Button' })).toEqual([])
  await others.unmount()

  // Elsewhere than the terminal the row is left empty.
  const desktop = await mount(text, 'desktop', 'block-5')
  expect(await desktop.findAll({ type: 'Button' })).toEqual([])
  await desktop.unmount()
})

test('a file read with a NUL in it, or past its end, is shown as such', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }))
  on('process.run', (_, e) => {
    const [cmd, , range, path] = e.argv
    const stdout =
      cmd === 'wc' ? '3 /w/short.md\n' : path === '/w/bin.dat' ? 'PK\0' : range === '96,105p;105q' ? '' : range === '1,10p;10q' ? 'a\nb\nc\n' : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>message</Text>
  })

  placing(on)
  const message = await listOf($, 'See bin.dat and short.md:100.', 'terminal', 'block-9')
  await message.press({ key: 'fold-0' })
  await message.press({ key: 'fold-1' })
  expect((await message.findAll({ type: 'Text' })).map(one => one.text)).toContain('binary file')
  expect((await message.findAll({ type: 'Code' })).map(one => one.props)).toEqual([expect.objectContaining({ source: 'a\nb\nc', startLine: 1 })])
  await message.unmount()
})

test('the batches of a streaming reply ask the disk about each path once, not on every batch', async ($, on) => {
  let stats = 0
  let reads = 0
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/stream' }))
  on('session.messages', () => {
    reads++

    return { value: [] }
  })
  on('fs.stat', (_, e) => {
    stats++
    if (e.path.includes('missing')) throw new Error('ENOENT')

    return { value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }
  })
  showing(on)

  const paths = Array.from({ length: 20 }, (_, i) => `docs/s${i}.md`).join(' ')
  for (let i = 0; i < 50; i++) await shownOf($, `${paths} and docs/missing.md, batch ${i}`, { index: i })
  expect(stats).toBe(21)
  expect(reads).toBe(1)
})

test('names that are no file read the transcript once per batch, and only those with a slash', async ($, on) => {
  let reads = 0
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/none' }))
  on('session.messages', () => {
    reads++

    return { value: [] }
  })
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  showing(on)
  const placed = placing(on)

  const bare = 'Bare names foo.md, Node.js and e.g. are never looked for elsewhere.'
  expect(await shownOf($, bare)).toBe(bare)
  await store($, bare, 'r-1')
  expect(reads).toBe(0)
  await shownOf($, Array.from({ length: 10 }, (_, i) => `gone/n${i}.md`).join(' '))
  expect(reads).toBe(1)
  expect(placed).toEqual([])
})

test('one path named twice keeps its first mention; a window past the end shows the last ten lines; a folder lists ten and a count; a PNG is not converted; open falls back to a new kitty', async ($, on) => {
  const ran: string[] = []
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_LISTEN_ON' ? 'unix:@kitty-gone' : e.name === 'HOME' ? undefined : KITTY_ENV[e.name] }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', (_, e) => ({ value: { kind: /\/(dir|empty)$/.test(e.path) ? ('dir' as const) : ('file' as const), size: 1, mtimeMs: 3, isLink: false } }))
  on('fs.list', (_, e) => ({
    value: e.path.endsWith('empty') ? [] : Array.from({ length: 13 }, (_, i) => ({ name: `e${String(i).padStart(2, '0')}`, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })),
  }))
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))
    if (e.argv[0] === 'kitten') throw new Error('no socket')
    const lines = (a: number, b: number) => Array.from({ length: Math.min(b, 100) - a + 1 }, (_, i) => `l${a + i}`).join('\n') + '\n'
    const range = /^(\d+),(\d+)p/.exec(e.argv[2] ?? '')
    const stdout = onPath(e.argv, LINUX) ?? (e.argv[0] === 'od' ? header(64, 32) : e.argv[0] === 'awk' ? '100\n' : range ? lines(Number(range[1]), Number(range[2])) : '')

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>message</Text>
  })

  placing(on)
  const message = await listOf($, 'See src/a.md:102, then ./src/a.md:7, the folder /w/dir, /w/empty and pic.png.', 'terminal', 'mixed-1')
  // Four entries: the list starts folded.
  await message.press({ key: 'fold-all' })
  expect(labels(await message.findAll({ type: 'Button' })).filter(one => one !== 'open' && one !== 'terminal')).toEqual([
    '▼ 4 files',
    '▶ src/a.md:102',
    '▶ /w/dir/',
    '▶ /w/empty/',
    '▼ pic.png',
  ])
  expect(ran.some(one => one.startsWith('magick'))).toBe(false)
  for (const key of ['fold-0', 'fold-1', 'fold-2']) await message.press({ key })
  const code = (await message.findAll({ type: 'Code' })).map(one => one.props as { source: string; startLine: number })
  expect(code[0]?.startLine).toBe(91)
  expect(code[0]?.source.split('\n')).toHaveLength(10)
  const texts = (await message.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts).toContain(`${Array.from({ length: 10 }, (_, i) => `e0${i}`).join('\n')}\n… 3 more`)
  expect(texts).toContain('empty folder')

  await message.press({ key: 'open-0' })
  expect(ran.slice(-2)).toEqual(['kitten @ launch --type=os-window --cwd=/w fresh /w/src/a.md:102', 'sh -c exec setsid -f "$@" >/dev/null 2>&1 </dev/null sh kitty --directory /w fresh /w/src/a.md:102'])
  await message.press({ key: 'open-1' })
  expect(ran.at(-1)).toBe('sh -c exec setsid -f "$@" >/dev/null 2>&1 </dev/null sh kitty --directory /w/dir')
  await message.unmount()
})

test('open takes a page and a PDF to the system, and to the editor where a line is named; a terminal that is not kitty gets no terminal button and no picture', async ($, on) => {
  const ran: string[] = []
  let env: Record<string, string> = { ...KITTY_ENV, KITTY_LISTEN_ON: 'unix:@kitty' }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? undefined : env[e.name] }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 3, isLink: false } }))
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))

    return { value: { exitCode: 0, stdout: onPath(e.argv, LINUX) ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>message</Text>
  })

  placing(on)
  const message = await listOf($, 'Wrote out/page.html and out/doc.PDF, see src/index.html:4.', 'terminal', 'browsed-1')
  const detached = 'sh -c exec setsid -f "$@" >/dev/null 2>&1 </dev/null sh'
  await message.press({ key: 'open-0' })
  expect(ran.at(-1)).toBe(`${detached} xdg-open /w/out/page.html`)
  await message.press({ key: 'open-1' })
  expect(ran.at(-1)).toBe(`${detached} xdg-open /w/out/doc.PDF`)
  await message.press({ key: 'open-2' })
  expect(ran.at(-1)).toBe('kitten @ launch --type=os-window --cwd=/w fresh /w/src/index.html:4')
  await message.press({ key: 'terminal-2' })
  expect(ran.at(-1)).toBe('kitten @ launch --type=os-window --cwd=/w/src')
  await message.unmount()

  // Another terminal: the file goes to the system's opener, no terminal
  // button is drawn, and a picture is named but neither read nor drawn.
  env = { TERM: 'xterm-256color', EDITOR: 'vim' }
  const plain = await listOf($, 'See src/a.md:5 and pic.png.', 'terminal', 'plain-1')
  expect(labels(await plain.findAll({ type: 'Button' }))).toEqual(['▼ 2 files', '▶ src/a.md:5', 'open', '▶ pic.png', 'open'])
  await plain.press({ key: 'open-0' })
  expect(ran.at(-1)).toBe(`${detached} xdg-open /w/src/a.md`)
  await plain.press({ key: 'fold-1' })
  expect(await plain.findAll({ type: 'Image' })).toEqual([])
  expect((await plain.findAll({ type: 'Text' })).map(one => one.text)).toContain('this terminal draws no pictures')
  expect(ran.some(one => one.startsWith('od ') || one.startsWith('magick'))).toBe(false)
  await plain.unmount()
})

// Each system a person may run the mod on, as the facts the mod gathers there.
const AUTO: Settings = { editor: 'auto', editorCommand: '', terminalCommand: '', imageCommand: '', browserCommand: '' }
const facts = (platform: Facts['platform'], env: Record<string, string>, found: string[], isHosted = false): Facts => ({ platform, isHosted, env, home: '/home/u', found: new Set(found) })
const FILE = { kind: 'file', path: '/w/src/a.ts', line: 12 } as const
const SYSTEMS = {
  kitty: facts('linux', { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1', EDITOR: 'nvim' }, ['kitty', 'nvim', 'xdg-open', 'setsid']),
  plainLinux: facts('linux', { TERM: 'xterm-256color', EDITOR: 'vim' }, ['vim', 'xdg-open', 'setsid']),
  vscode: facts('linux', { TERM_PROGRAM: 'vscode', TERM: 'xterm-256color' }, ['code', 'xdg-open']),
  cursor: facts('macos', { TERM_PROGRAM: 'vscode', CURSOR_TRACE_ID: 'x' }, ['code', 'cursor', 'open']),
  vscodeOverSsh: facts('linux', { TERM_PROGRAM: 'vscode', SSH_CONNECTION: '1.2.3.4 1 5.6.7.8 22' }, ['code', 'xdg-open']),
  vscodeInContainer: facts('linux', { TERM_PROGRAM: 'vscode', REMOTE_CONTAINERS: 'true' }, ['code']),
  vscodeFromKitty: facts('linux', { TERM_PROGRAM: 'vscode', KITTY_WINDOW_ID: '3', EDITOR: 'nvim' }, ['code', 'kitty', 'nvim', 'xdg-open']),
  iterm: facts('macos', { TERM_PROGRAM: 'iTerm.app', EDITOR: 'vim' }, ['vim', 'open']),
  ghostty: facts('macos', { TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty' }, ['open']),
  wsl: facts('wsl', { TERM: 'xterm-256color' }, ['wslview', 'xdg-open']),
  ssh: facts('linux', { TERM: 'xterm-kitty', SSH_CONNECTION: '1.2.3.4 1 5.6.7.8 22', EDITOR: 'vim' }, ['vim', 'xdg-open', 'kitty']),
  tmuxInKitty: facts('linux', { TERM: 'tmux-256color', KITTY_WINDOW_ID: '1', TMUX: '/tmp/tmux-1/default,1,0', EDITOR: 'hx' }, ['kitty', 'hx', 'xdg-open']),
  hosted: facts('linux', { TERM: 'xterm-256color' }, ['xdg-open', 'code'], true),
  windows: facts('windows', {}, []),
  bare: facts('linux', {}, []),
}

test('with no setting, a file opens in the editor whose terminal it is, in kitty with $EDITOR, or by the system; away from the screen nothing opens', () => {
  const opened = Object.fromEntries(Object.entries(SYSTEMS).map(([name, one]) => [name, opening(FILE, '/w', AUTO, one)]))
  expect(opened).toEqual({
    kitty: { kitty: { folder: '/w', argv: ['nvim', '+12', '/w/src/a.ts'] } },
    plainLinux: { argv: ['xdg-open', '/w/src/a.ts'] },
    vscode: { argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'] },
    cursor: { argv: ['cursor', '--reuse-window', '--goto', '/w/src/a.ts:12'] },
    vscodeOverSsh: { argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'] },
    vscodeInContainer: { argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'] },
    vscodeFromKitty: { argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'] },
    iterm: { argv: ['open', '/w/src/a.ts'] },
    ghostty: { argv: ['open', '/w/src/a.ts'] },
    wsl: { argv: ['wslview', '/w/src/a.ts'] },
    ssh: undefined,
    tmuxInKitty: { kitty: { folder: '/w', argv: ['hx', '/w/src/a.ts:12'] } },
    hosted: undefined,
    windows: undefined,
    bare: undefined,
  })
})

test('a picture, a page and a folder go to the system unless a command is set, and a terminal starts only in kitty or by a command', () => {
  const { kitty, plainLinux, vscode, iterm, ssh, hosted } = SYSTEMS
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', AUTO, vscode)).toEqual({ argv: ['xdg-open', '/w/p.png'] })
  expect(opening({ kind: 'page', path: '/w/p.html' }, '/w', AUTO, iterm)).toEqual({ argv: ['open', '/w/p.html'] })
  expect(opening({ kind: 'dir', path: '/w/src' }, '/w', AUTO, kitty)).toEqual({ kitty: { folder: '/w/src', argv: [] } })
  expect(opening({ kind: 'dir', path: '/w/src' }, '/w', AUTO, plainLinux)).toEqual({ argv: ['xdg-open', '/w/src'] })
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', AUTO, ssh)).toBe(undefined)
  expect(terminalIn('/w/src', AUTO, kitty)).toEqual({ kitty: { folder: '/w/src', argv: [] } })
  expect([plainLinux, vscode, iterm, ssh, hosted].map(one => terminalIn('/w/src', AUTO, one))).toEqual([undefined, undefined, undefined, undefined, undefined])
  expect(Object.entries(SYSTEMS).filter(([, one]) => drawsPictures(one)).map(([name]) => name)).toEqual(['kitty', 'ghostty'])
  expect(Object.fromEntries(Object.entries(SYSTEMS).map(([name, one]) => [name, screenOf(one)]))).toEqual({
    kitty: 'kitty',
    plainLinux: 'other',
    vscode: 'vscode',
    cursor: 'vscode',
    vscodeOverSsh: 'vscode-remote',
    vscodeInContainer: 'vscode-remote',
    vscodeFromKitty: 'vscode',
    iterm: 'other',
    ghostty: 'ghostty',
    wsl: 'other',
    ssh: 'remote',
    tmuxInKitty: 'kitty',
    hosted: 'hosted',
    windows: 'other',
    bare: 'other',
  })
})

test("an editor's terminal on another host shows a picture and a page as a tab and starts nothing on that host's desktop; one started from kitty is not kitty", () => {
  const { vscodeOverSsh, vscodeInContainer, vscodeFromKitty } = SYSTEMS
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', AUTO, vscodeOverSsh)).toEqual({ argv: ['code', '--reuse-window', '/w/p.png'] })
  expect(opening({ kind: 'page', path: '/w/p.pdf' }, '/w', AUTO, vscodeInContainer)).toEqual({ argv: ['code', '--reuse-window', '/w/p.pdf'] })
  expect(opening({ kind: 'dir', path: '/w/src' }, '/w', AUTO, vscodeOverSsh)).toBe(undefined)
  expect(opening(FILE, '/w', { ...AUTO, editor: 'system' }, vscodeOverSsh)).toBe(undefined)
  expect(opening(FILE, '/w', AUTO, { ...vscodeOverSsh, found: new Set(['xdg-open']) })).toBe(undefined)
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', AUTO, vscodeFromKitty)).toEqual({ argv: ['xdg-open', '/w/p.png'] })
  expect(terminalIn('/w/src', AUTO, vscodeFromKitty)).toBe(undefined)
  expect(drawsPictures(vscodeFromKitty)).toBe(false)
  // Any other terminal started from a kitty shell keeps kitty's variable and is not kitty either.
  expect(screenOf(facts('linux', { TERM: 'alacritty', KITTY_WINDOW_ID: '1' }, ['kitty']))).toBe('other')
  expect(screenOf(facts('linux', { TERM_PROGRAM: 'WezTerm', KITTY_WINDOW_ID: '3' }, ['kitty']))).toBe('other')
  expect(screenOf(facts('linux', { TERM_PROGRAM: 'tmux', KITTY_WINDOW_ID: '3', TMUX: '/tmp/t,1,0' }, ['kitty']))).toBe('kitty')
})

test('each fallback of the rules: no line, $VISUAL before $EDITOR, WSL without wslview, VS Code asked for but missing, kitty not on PATH', () => {
  const kitty = (env: Record<string, string>, found: string[]) => facts('linux', { TERM: 'xterm-kitty', ...env }, found)
  expect(opening({ kind: 'file', path: '/w/a.ts' }, '/w', AUTO, SYSTEMS.kitty)).toEqual({ kitty: { folder: '/w', argv: ['nvim', '/w/a.ts'] } })
  expect(opening(FILE, '/w', AUTO, kitty({ VISUAL: 'hx', EDITOR: 'vim' }, ['kitty', 'hx', 'vim']))).toEqual({ kitty: { folder: '/w', argv: ['hx', '/w/src/a.ts:12'] } })
  expect(opening(FILE, '/w', AUTO, kitty({ VISUAL: '', EDITOR: 'vim' }, ['kitty', 'vim']))).toEqual({ kitty: { folder: '/w', argv: ['vim', '+12', '/w/src/a.ts'] } })
  expect(opening(FILE, '/w', AUTO, facts('wsl', {}, ['xdg-open']))).toEqual({ argv: ['xdg-open', '/w/src/a.ts'] })
  expect(opening(FILE, '/w', { ...AUTO, editor: 'vscode' }, SYSTEMS.plainLinux)).toEqual({ argv: ['xdg-open', '/w/src/a.ts'] })
  expect(opening(FILE, '/w', AUTO, kitty({ EDITOR: 'vim' }, ['vim', 'xdg-open']))).toEqual({ argv: ['xdg-open', '/w/src/a.ts'] })
  expect(terminalIn('/w', AUTO, kitty({}, []))).toBe(undefined)
  // A command that names only the folder gets no file added.
  expect(opening(FILE, '/w', { ...AUTO, editorCommand: 'ide --project {dir}' }, facts('linux', {}, ['ide']))).toEqual({ argv: ['ide', '--project', '/w/src'] })
})

test('a search of PATH that exits non-zero still counts what it printed; one that cannot run leaves no button and is made again a minute later; without setsid a program starts through nohup; Windows gets no links and no row', async ($, on) => {
  const ran: string[] = []
  let env: Record<string, string> = { TERM: 'xterm-256color', MARK: 'one' }
  let search: 'exits 1' | 'throws' | 'works' = 'exits 1'
  let platform = 'macos'
  let now = 1000
  on('clock.now', () => ({ value: now }))
  on('env.get', (_, e) => ({ value: e.name === 'TERM_PROGRAM' ? env.MARK : env[e.name] }))
  on('session.info', () => ({ value: { platform } }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 3, isLink: false } }))
  on('process.run', (_, e) => {
    ran.push(e.argv.join(' '))
    const listed = onPath(e.argv, ['open'])
    if (listed !== undefined && search === 'throws') throw new Error('timed out')

    return { value: { exitCode: listed !== undefined && search === 'exits 1' ? 1 : 0, stdout: listed ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>message</Text>
  })
  showing(on)
  const placed = placing(on)

  // TERM_PROGRAM stands for a terminal of its own in each part, so that each
  // part makes its own search.
  const mac = await listOf($, 'See src/a.md:5.', 'terminal', 'mac-1')
  expect(labels(await mac.findAll({ type: 'Button' }))).toEqual(['▶ src/a.md:5', 'open'])
  await mac.press({ key: 'open-0' })
  expect(ran.at(-1)).toBe('sh -c nohup "$@" >/dev/null 2>&1 </dev/null & sh open /w/src/a.md')
  await mac.unmount()

  env = { ...env, MARK: 'two' }
  search = 'throws'
  const failed = await listOf($, 'See src/a.md:5.', 'terminal', 'mac-2')
  expect(labels(await failed.findAll({ type: 'Button' }))).toEqual(['▶ src/a.md:5'])
  // The search is made again a minute later, not at each drawing before.
  search = 'works'
  const searches = () => ran.filter(one => one.startsWith('sh -c for one')).length
  const made = searches()
  now += 59000
  await failed.redraw({ id: 'm-mac-2', plugin: 'pathview' })
  expect(labels(await failed.findAll({ type: 'Button' }))).toEqual(['▶ src/a.md:5'])
  expect(searches()).toBe(made)
  now += 2000
  await failed.redraw({ id: 'm-mac-2', plugin: 'pathview' })
  expect(labels(await failed.findAll({ type: 'Button' }))).toEqual(['▶ src/a.md:5', 'open'])
  await failed.unmount()

  platform = 'windows'
  const before = placed.length
  await store($, 'See src/a.md:5.', 'win-1')
  expect(placed.length).toBe(before)
  expect(await shownOf($, 'See src/a.md:5.', { message_id: 'win' })).toBe('See src/a.md:5.')
})

test("the person's own commands come first, with the file, the line and the folder filled in, and a missing program falls through", () => {
  const own: Settings = {
    editor: 'auto',
    editorCommand: 'zed {file}:{line}',
    terminalCommand: 'wezterm start --cwd {dir}',
    imageCommand: 'qimgv',
    browserCommand: '"my browser" --new-window {file}',
  }
  const has = (...found: string[]) => facts('linux', { TERM: 'xterm-256color' }, [...found, 'xdg-open'])
  expect(opening(FILE, '/w', own, has('zed'))).toEqual({ argv: ['zed', '/w/src/a.ts:12'] })
  expect(opening({ kind: 'file', path: '/w/a b.ts' }, '/w', own, has('zed'))).toEqual({ argv: ['zed', '/w/a b.ts:1'] })
  expect(opening(FILE, '/w', own, has())).toEqual({ argv: ['xdg-open', '/w/src/a.ts'] })
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', own, has('qimgv'))).toEqual({ argv: ['qimgv', '/w/p.png'] })
  expect(opening({ kind: 'image', path: '/w/p.png' }, '/w', own, has())).toEqual({ argv: ['xdg-open', '/w/p.png'] })
  expect(opening({ kind: 'page', path: '/w/p.html' }, '/w', own, has('my browser'))).toEqual({ argv: ['my browser', '--new-window', '/w/p.html'] })
  expect(opening({ kind: 'dir', path: '/w/src' }, '/w', own, has('wezterm'))).toEqual({ argv: ['wezterm', 'start', '--cwd', '/w/src'] })
  expect(terminalIn('/w/src', own, has('wezterm'))).toEqual({ argv: ['wezterm', 'start', '--cwd', '/w/src'] })
  // Over ssh a command the person set still runs, as for an editor that reaches back.
  expect(opening(FILE, '/w', own, { ...SYSTEMS.ssh, found: new Set(['zed']) })).toEqual({ argv: ['zed', '/w/src/a.ts:12'] })
  // A program under the home folder is found as its full path, and a missing one goes on to the surroundings.
  expect(opening(FILE, '/w', { ...AUTO, editorCommand: '~/bin/ed {file}' }, has('/home/u/bin/ed'))).toEqual({ argv: ['/home/u/bin/ed', '/w/src/a.ts'] })
  expect(opening(FILE, '/w', own, SYSTEMS.vscode)).toEqual({ argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'] })
  expect(terminalIn('/w/src', own, SYSTEMS.kitty)).toEqual({ kitty: { folder: '/w/src', argv: [] } })
  // $EDITOR as VS Code takes the line through --goto, and a $VISUAL that is missing leaves $EDITOR.
  expect(opening(FILE, '/w', AUTO, facts('linux', { TERM: 'xterm-kitty', EDITOR: 'code --wait' }, ['kitty', 'code']))).toEqual({
    kitty: { folder: '/w', argv: ['code', '--wait', '--goto', '/w/src/a.ts:12'] },
  })
  expect(opening(FILE, '/w', AUTO, facts('linux', { TERM: 'xterm-kitty', VISUAL: 'gone', EDITOR: 'vim' }, ['kitty', 'vim']))).toEqual({
    kitty: { folder: '/w', argv: ['vim', '+12', '/w/src/a.ts'] },
  })
  // The picker alone: VS Code from any terminal, or the system's opener in kitty.
  expect(opening(FILE, '/w', { ...AUTO, editor: 'vscode' }, { ...SYSTEMS.kitty, found: new Set(['code', 'kitty', 'nvim']) })).toEqual({
    argv: ['code', '--reuse-window', '--goto', '/w/src/a.ts:12'],
  })
  expect(opening(FILE, '/w', { ...AUTO, editor: 'system' }, SYSTEMS.kitty)).toEqual({ argv: ['xdg-open', '/w/src/a.ts'] })
})

test('what a hook beneath shows is kept and linked, and a session that draws nowhere gets no links', async ($, on) => {
  let surfaces: string[] = ['terminal']
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }))
  // A hook beneath, as termaid is: it holds a batch back, or shows its own lines.
  on('classic.MessageDisplay', (_: unknown, e: { delta: string }) => (e.delta === 'held' ? { displayContent: '' } : { displayContent: `DRAWN ${e.delta}`, stopReason: 'kept' }))

  const raise = (delta: string) =>
    ($ as any).classic.MessageDisplay({ hook_event_name: 'MessageDisplay', session_id: 's', transcript_path: '/t', cwd: '/', turn_id: 't', message_id: 'm', index: 0, final: false, delta })
  expect(await raise('held')).toEqual({ displayContent: '' })
  expect(await raise('see src/a.py')).toEqual({ displayContent: 'DRAWN see [src/a.py](file:///w/src/a.py)', stopReason: 'kept' })

  // A `claude -p` run draws nowhere, and prints what is shown as its answer.
  surfaces = []
  expect(await raise('see src/a.py')).toEqual({ displayContent: 'DRAWN see src/a.py', stopReason: 'kept' })
})

test('the list holds the paths of the text as stored, and a fence left open is forgotten once 2000 are remembered', async ($, on) => {
  on('env.get', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.messages', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>nothing</Text>
  })
  showing(on)
  placing(on)
  // A hook beneath that rewrites a row before it is stored.
  on('session.append', (_: unknown, e: any, next: any) =>
    next({ ...e, message: { ...e.message, content: e.message.content.map((block: any) => (block.type === 'text' ? { ...block, text: block.text.replace('old.md', 'new.md') } : block)) } }),
  )
  const row = await listOf($, 'Wrote old.md.', 'terminal', 'rewritten')
  // This machine has no opener and no kitty, so the row has its fold alone.
  expect(labels(await row.findAll({ type: 'Button' }))).toEqual(['▶ new.md'])
  await row.unmount()

  await shownOf($, '```\ncat src/a.py', { message_id: 'first' })
  expect(await shownOf($, 'cat src/a.py', { message_id: 'first' })).toBe('cat src/a.py')
  for (let i = 0; i < 2000; i++) await shownOf($, '```', { message_id: `open-${i}` })
  expect(await shownOf($, 'See src/a.py.', { message_id: 'first' })).toBe('See [src/a.py](file:///w/src/a.py).')
})
