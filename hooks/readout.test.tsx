import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderNode, ToolGroupCall } from 'claude-code'

import { groupLines, labelOf, shortPath, shortReason } from './format'

const CWD = '/work/app'
const HOME = '/Users/me'
const SURFACES = ['terminal', 'desktop'] as const

function call(tool: string, input: object, extra: Partial<ToolGroupCall> = {}): ToolGroupCall {
  return { tool, input, isRunning: false, isErrored: false, isInterrupted: false, ...extra }
}

function group(calls: ToolGroupCall[], isExpanded = false) {
  return { plugin: 'readout', component: 'ToolGroup', props: { calls, isActive: false, isExpanded } } as const
}

function textOf(node: RenderNode | undefined): string {
  if (node === undefined) return ''
  if (typeof node === 'string') return node
  const children = 'children' in node && Array.isArray(node.children) ? (node.children as RenderNode[]) : []
  return children.map(textOf).join('')
}

const READS = [
  call('Read', { file_path: `${CWD}/hooks/register.tsx` }),
  call('Read', { file_path: `${CWD}/hooks/sprites.ts` }),
  call('Read', { file_path: `${CWD}/README.md` }),
]

describe('format', () => {
  test('paths read relative to the working directory, or under ~', () => {
    expect(shortPath(`${CWD}/src/a.ts`, CWD, HOME)).toBe('src/a.ts')
    expect(shortPath(`${HOME}/.ssh/id_rsa`, CWD, HOME)).toBe('~/.ssh/id_rsa')
    expect(shortPath('/etc/hosts', CWD, HOME)).toBe('/etc/hosts')
    expect(shortPath(CWD, CWD, HOME)).toBe('.')
  })

  test('each tool is labelled by what it touched', () => {
    expect(labelOf('Grep', { pattern: 'hatched', path: `${CWD}/hooks` }, CWD, HOME)).toBe('"hatched" in hooks')
    expect(labelOf('Glob', { pattern: '**/*.ts' }, CWD, HOME)).toBe('**/*.ts')
    expect(labelOf('Bash', { command: 'git   status' }, CWD, HOME)).toBe('git status')
    const long = 'grep -rn "hatched" ~/claude-familiar/hooks | head -3'
    expect(labelOf('Bash', { command: long }, CWD, HOME)).toBe(long)
    expect(labelOf('WebFetch', { url: 'https://example.com/a', prompt: 'x' }, CWD, HOME)).toBe('example.com/a')
    expect(labelOf('Mystery', { file_path: '/x' }, CWD, HOME)).toBeUndefined()
  })

  test('a failure reads as who blocked it, or the first clause of the error', () => {
    expect(shortReason('seatbelt: ~/.ssh/id_rsa holds a secret, so Read is blocked.', true)).toBe('blocked by seatbelt')
    expect(shortReason('Permission denied', true)).toBe('blocked')
    expect(shortReason('<tool_use_error>File does not exist. Current dir: /x</tool_use_error>', false)).toBe(
      'File does not exist',
    )
  })

  test('a long run is cut to the room with +N more', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ tool: 'Read', input: { file_path: `${CWD}/file-${i}.ts` }, isErrored: false }))
    const [line] = groupLines(many, 40, CWD, HOME) ?? []
    expect(line?.items.map(item => item.text)).toEqual(['file-0.ts', 'file-1.ts', 'file-2.ts'])
    expect(line?.more).toBe(5)
  })

  test('a group with nothing to label is left to the engine', () => {
    expect(groupLines([{ tool: 'Mystery', input: {}, isErrored: false }], 80, CWD, HOME)).toBeUndefined()
  })
})

describe('the folded line', () => {
  test('names each file Read opened, on terminal and desktop', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...group(READS), surface, viewport: { columns: 100, rows: 40 } })
      expect(textOf(await ui.drawn())).toBe('● Read  hooks/register.tsx, hooks/sprites.ts, README.md')
      await ui.unmount()
    }
  })

  test('a mixed group gets one line per run of a tool', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const calls = [...READS.slice(0, 2), call('Grep', { pattern: 'hatched', path: `${CWD}/hooks` })]
    const ui = await $.ui.mount({ ...group(calls), surface: 'terminal', viewport: { columns: 100, rows: 40 } })
    expect(textOf(await ui.drawn())).toBe('● Read  hooks/register.tsx, hooks/sprites.ts  Grep  "hatched" in hooks')
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
    await ui.unmount()
  })

  test('a blocked read shows who blocked it, in red', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))
    let id = ''
    on('tool.call', (_, e) => {
      id = e.tool_use_id
      return { deny: 'seatbelt: ~/.ssh/id_rsa holds a secret, so Read is blocked.' }
    })

    await $.tool.call({ tool: 'Read', file_path: `${HOME}/.ssh/id_rsa` })
    const blocked = call('Read', { file_path: `${HOME}/.ssh/id_rsa` }, { tool_use_id: id, isErrored: true })
    const ui = await $.ui.mount({ ...group([blocked]), surface: 'terminal', viewport: { columns: 100, rows: 40 } })
    expect(textOf(await ui.drawn())).toBe('● Read  ~/.ssh/id_rsa  blocked by seatbelt')
    const red = (await ui.findAll({ type: 'Text' })).filter(found => found.props.color === '#ff6b80')
    expect(red.map(found => found.text)).toEqual(['● ', '~/.ssh/id_rsa', '  blocked by seatbelt'])
    await ui.unmount()
  })

  test('a narrow window cuts the list with +N more', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const ui = await $.ui.mount({ ...group(READS), surface: 'terminal', viewport: { columns: 54, rows: 40 } })
    expect(textOf(await ui.drawn())).toBe('● Read  hooks/register.tsx, hooks/sprites.ts +1 more')
    await ui.unmount()
  })

  test('verbose and ctrl+o draw the engine’s own rows', async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'expanded' : 'folded'}</Text>
    })

    const ui = await $.ui.mount({ ...group(READS, true), surface: 'terminal' })
    expect(textOf(await ui.drawn())).toBe('expanded')
    await ui.unmount()
  })

  test('expand mode unfolds the group', { options: { mode: 'expand' } }, async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'expanded' : 'folded'}</Text>
    })

    const ui = await $.ui.mount({ ...group(READS), surface: 'terminal' })
    expect(textOf(await ui.drawn())).toBe('expanded')
    await ui.unmount()
  })
})
