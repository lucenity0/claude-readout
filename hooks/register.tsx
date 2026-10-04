import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { groupLines, shortReason, tintFor, wantsLinks } from './format'
import type { Item } from './format'

const reasons = atom({ plugin: 'readout', key: 'reasons' } as const, {})

const DONE = '#4eba65'
const FAILED = '#ff6b80'
const KEPT_REASONS = 200

export const register: Register = (on, options) => {
  const isExpandMode = options.mode === 'expand'
  let theme = 'dark'

  on('session.start', async ($, e, next) => {
    const row = (await $.config.list()).find(each => each.key === 'theme')
    if (typeof row?.value === 'string') theme = row.value
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    const tint = e.surface === 'terminal' ? tintFor(options.tint, theme) : undefined
    if (tint === undefined) return drawn
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column" backgroundColor={tint.band}>{drawn}</Box>
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const drawn = await next(e)
    const tint = e.surface === 'terminal' ? tintFor(options.tint, theme) : undefined
    if (tint === undefined) return drawn
    const { Box } = $.ui.resolve(e)
    return <Box flexDirection="column" backgroundColor={tint.band}>{drawn}</Box>
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isDenied = ran.deny !== undefined
    const message = ran.deny ?? (ran.isError === true ? ran.text : undefined)
    if (message === undefined) return ran

    const reason = shortReason(message, isDenied)
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
        isRunning: call.isRunning,
        ...(reason === undefined ? {} : { reason }),
      }
    })

    const nameWidth = Math.max(...calls.map(call => call.tool.length))
    const gutter = nameWidth + 4
    const room = Math.max(12, (e.viewport?.columns ?? 80) - gutter - 2)
    const lines = groupLines(calls, room, cwd, home)
    if (lines === undefined) return next(e)

    const { Box, Text, Link } = $.ui.resolve(e)
    const hasLinks =
      e.surface === 'terminal' &&
      wantsLinks(options.links, await $.env.get('TERM_PROGRAM'), await $.env.get('TERM'))
    const isRunning = calls.some(call => call.isRunning)
    const isFailed = calls.length > 0 && calls.every(call => call.isErrored)
    const bullet = isRunning ? { dimColor: true } : { color: isFailed ? FAILED : DONE }
    const tint = e.surface === 'terminal' ? tintFor(options.tint, theme) : undefined
    const band = tint === undefined ? {} : { backgroundColor: tint.band }
    const ink = tint === undefined ? {} : { color: tint.ink }

    const drawItem = (item: Item) => {
      const name =
        hasLinks && item.path !== undefined ? <Link href={`file://${encodeURI(item.path)}`}>{item.name}</Link> : item.name
      const style = item.isErrored ? { color: FAILED } : item.isRunning ? { dimColor: true } : ink
      return (
        <Text {...style}>
          {name}
          {item.count > 1 ? <Text dimColor>{` ×${item.count}`}</Text> : ''}
          {item.reason === undefined ? '' : `  ${item.reason}`}
        </Text>
      )
    }

    return (
      <Box flexDirection="column" marginTop={1} {...band}>
        {lines.map((line, index) => (
          <Box flexDirection="row">
            <Box width={gutter} flexShrink={0}>
              <Text>
                {index === 0 ? <Text {...bullet}>{'● '}</Text> : '  '}
                <Text bold {...ink}>{(line.isFirstOfTool ? line.tool : '').padEnd(nameWidth)}</Text>
                {'  '}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap={line.wraps ? 'wrap' : 'truncate-end'}>
                {line.entries.map((entry, at) => (
                  <Text>
                    {at === 0 ? '' : ', '}
                    {entry.folder === '' ? '' : `${entry.folder}{`}
                    {entry.items.map((item, i) => (
                      <Text>
                        {i === 0 ? '' : ', '}
                        {drawItem(item)}
                      </Text>
                    ))}
                    {entry.folder === '' ? '' : '}'}
                  </Text>
                ))}
                {line.more > 0 ? <Text dimColor>{` +${line.more} more`}</Text> : ''}
              </Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
