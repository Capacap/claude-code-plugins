import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// The row above the prompt that holds the user's reminders to themselves: what a request to a session
// should cover. Closed it is one button; open it shows USER.md under it. The file is read at each
// drawing while the row is open, so an edit shows without a restart.
const isOpen = atom({ plugin: 'usermd', key: 'isOpen' } as const, false)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usermd',
      description: 'Open or close your reminders for writing a request (USER.md) above the prompt',
    })

    return next(e)
  })

  on('command.run', { command: 'usermd' }, async $ => {
    const now = !(await read($, isOpen))
    await update($, isOpen, () => now)

    return { text: now ? 'USER.md is open above the prompt.' : 'USER.md is closed.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const open = await read($, isOpen)
    const toggle = (
      <Button
        key="toggle"
        label={open ? '▾ USER.md' : '▸ USER.md'}
        onPress={() => update($, isOpen, now => !now)}
      />
    )

    if (!open) {
      return <Box>{toggle}</Box>
    }

    // The session's own config root comes first, then ~/.claude, so that one file there serves every
    // root that has none of its own.
    const home = `${(await $.env.get('HOME')) ?? ''}/.claude/USER.md`
    const root = await $.env.get('CLAUDE_CONFIG_DIR')
    const paths = root === undefined || `${root}/USER.md` === home ? [home] : [`${root}/USER.md`, home]
    let text: string | undefined

    for (const path of paths) {
      text = await $.fs.read(path).then(
        body => body.trim(),
        () => undefined,
      )

      if (text !== undefined) {
        break
      }
    }

    // Every line is drawn dim, the heading bold as well, so the reminders stand apart from the reply
    // over them. The user reads them in passing and asked for them to stay in the background.
    const lines = (text ?? `No file at ${home}. Write your own reminders there, one to a line.`).split('\n')

    return (
      <Box flexDirection="column">
        {toggle}
        {lines.map(line =>
          line.startsWith('#') ? (
            <Text bold dimColor>
              {line.replace(/^#+\s*/, '')}
            </Text>
          ) : (
            <Text dimColor>{line === '' ? ' ' : line}</Text>
          ),
        )}
      </Box>
    )
  })
}
