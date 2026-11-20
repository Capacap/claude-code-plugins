import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usermd',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  surface: 'terminal',
} as const

test('the row is one button until it is pressed, then shows the file', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  const asked: string[] = []
  on('fs.read', (_, e) => {
    asked.push(e.path)

    return { value: '# When I write a request\n- Say what done looks like.\n' }
  })

  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /done looks like/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▸ USER.md')

  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Button', key: 'toggle' }))?.text).toBe('▾ USER.md')
  expect((await ui.find({ type: 'Text', text: /done looks like/ }))?.text).toBe('- Say what done looks like.')
  expect((await ui.find({ type: 'Text', text: /When I write/ }))?.text).toBe('When I write a request')
  expect(asked).toEqual(['/home/u/.claude/USER.md'])
  await ui.unmount()
})

test('a second config root reads its own file first, then the one in ~/.claude, and a missing file is said', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CONFIG_DIR' ? '/roots/two' : '/home/u' }))
  const asked: string[] = []
  let held: string[] = []
  on('fs.read', (_, e) => {
    asked.push(e.path)

    if (!held.includes(e.path)) {
      throw new Error('ENOENT')
    }

    return { value: `- from ${e.path}\n` }
  })
  on('state.get', () => ({ value: { value: true, version: 1 } }))

  let ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /No file/ }))?.text).toBe(
    'No file at /home/u/.claude/USER.md. Write your own reminders there, one to a line.',
  )
  expect(asked).toEqual(['/roots/two/USER.md', '/home/u/.claude/USER.md'])
  await ui.unmount()

  held = ['/home/u/.claude/USER.md']
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /from/ }))?.text).toBe('- from /home/u/.claude/USER.md')
  await ui.unmount()

  held = ['/roots/two/USER.md', '/home/u/.claude/USER.md']
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /from/ }))?.text).toBe('- from /roots/two/USER.md')
  await ui.unmount()
})

test('a survey keeps the band', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  await ui.unmount()
})
