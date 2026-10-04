import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { groupLines, shortReason } from './format'

const reasons = atom({ plugin: 'readout', key: 'reasons' } as const, {})

const DONE = '#4eba65'
const FAILED = '#ff6b80'
const KEPT_REASONS = 200

export const register: Register = (on, options) => {
  const isExpandMode = options.mode === 'expand'

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isDenied = ran.deny !== undefined
    const text = ran.deny ?? (ran.isError === true ? ran.text : undefined)
    if (text === undefined) return ran

    const reason = shortReason(text, isDenied)
    await update($, reasons, current => {
      const kept = Object.entries(current).slice(-(KEPT_REASONS - 1))
      return { ...Object.fromEntries(kept), [e.tool_use_id]: reason }
    })

    return ran
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    if (isExpandMode) return next({ ...e, props: { ...e.props, isExpanded: true } })

    const why = await read($, reasons)
    const cwd = await $.session.cwd()
    const home = await $.env.get('HOME')
    const calls = e.props.calls.map(call => {
      const reason = call.tool_use_id === undefined ? undefined : why[call.tool_use_id]
      return {
        tool: call.tool,
        input: call.input,
        isErrored: call.isErrored || call.isInterrupted,
        ...(reason === undefined ? {} : { reason }),
      }
    })

    const nameWidth = Math.max(...calls.map(call => call.tool.length))
    const room = Math.max(12, (e.viewport?.columns ?? 80) - nameWidth - 6)
    const lines = groupLines(calls, room, cwd, home)
    if (lines === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const isRunning = e.props.calls.some(call => call.isRunning)
    const isFailed = calls.length > 0 && calls.every(call => call.isErrored)
    const bullet = isRunning ? { dimColor: true } : { color: isFailed ? FAILED : DONE }

    return (
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text wrap="truncate-end">
            {index === 0 ? (
              <Text {...bullet}>{'● '}</Text>
            ) : (
              '  '
            )}
            <Text bold>{line.tool.padEnd(nameWidth)}</Text>
            {'  '}
            {line.items.map((item, at) => (
              <Text>
                {at === 0 ? '' : line.separator}
                {item.isErrored ? <Text color={FAILED}>{item.text}</Text> : item.text}
                {item.reason === undefined ? '' : <Text color={FAILED}>{`  ${item.reason}`}</Text>}
              </Text>
            ))}
            {line.more > 0 ? <Text dimColor>{` +${line.more} more`}</Text> : ''}
          </Text>
        ))}
      </Box>
    )
  })
}
