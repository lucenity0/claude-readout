import { describe, expect, mock, test } from 'claude-code/testing'
import type { RenderNode, ToolGroupCall } from 'claude-code'

import { foldFolders, groupLines, rangeOf, shortPath, shortReason, targetOf, tintFor, wantsLinks } from './format'

const CWD = '/work/app'
const HOME = '/Users/me'
const SURFACES = ['terminal', 'desktop'] as const
const WIDE = { columns: 100, rows: 40 }

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

function item(name: string) {
  return { name, count: 1, isErrored: false, isRunning: false }
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
    expect(targetOf('Read', { file_path: 'src/a.ts' }, CWD, HOME)).toEqual({ label: 'src/a.ts', path: `${CWD}/src/a.ts` })
    expect(targetOf('Grep', { pattern: 'hatched', path: `${CWD}/hooks` }, CWD, HOME)?.label).toBe('"hatched" in hooks')
    expect(targetOf('Glob', { pattern: '**/*.ts' }, CWD, HOME)?.label).toBe('**/*.ts')
    const long = 'grep -rn "hatched" ~/claude-familiar/hooks | head -3'
    expect(targetOf('Bash', { command: long }, CWD, HOME)?.label).toBe(long)
    expect(targetOf('WebFetch', { url: 'https://example.com/a', prompt: 'x' }, CWD, HOME)?.label).toBe('example.com/a')
    expect(targetOf('Mystery', { file_path: '/x' }, CWD, HOME)).toBeUndefined()
  })

  test('a partial read shows its lines or pages', () => {
    expect(rangeOf({ file_path: '/a', offset: 40, limit: 40 })).toBe(':40-79')
    expect(rangeOf({ file_path: '/a', offset: 120 })).toBe(':120-')
    expect(rangeOf({ file_path: '/a', limit: 50 })).toBe(':1-50')
    expect(rangeOf({ file_path: '/a.pdf', pages: '3-5' })).toBe(' p.3-5')
    expect(rangeOf({ file_path: '/a' })).toBe('')
  })

  test('a failure reads as who blocked it, or the first clause of the error', () => {
    expect(shortReason('seatbelt: ~/.ssh/id_rsa holds a secret, so Read is blocked.', true)).toBe('blocked by seatbelt')
    expect(shortReason('Permission denied', true)).toBe('blocked')
    expect(shortReason('<tool_use_error>File does not exist. Current dir: /x</tool_use_error>', false)).toBe(
      'File does not exist',
    )
  })

  test('names under one folder gather into folder/{a, b}', () => {
    const entries = foldFolders([item('hooks/a.ts'), item('README.md'), item('hooks/b.ts'), item('src/c.ts')])
    expect(entries).toEqual([
      { folder: 'hooks/', items: [item('a.ts'), item('b.ts')] },
      { folder: '', items: [item('README.md')] },
      { folder: '', items: [item('src/c.ts')] },
    ])
  })

  test('a long run is cut to the room with +N more', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      tool: 'Read',
      input: { file_path: `${CWD}/file-${i}.ts` },
      isErrored: false,
      isRunning: false,
    }))
    const [line] = groupLines(many, 40, CWD, HOME) ?? []
    expect(line?.entries.flatMap(entry => entry.items.map(kept => kept.name))).toEqual(['file-0.ts', 'file-1.ts', 'file-2.ts'])
    expect(line?.more).toBe(5)
  })

  test('a group with nothing to label is left to the engine', () => {
    expect(groupLines([{ tool: 'Mystery', input: {}, isErrored: false, isRunning: false }], 80, CWD, HOME)).toBeUndefined()
  })

  test('the band suits the theme, or takes a color of your own', () => {
    expect(tintFor('auto', 'dark')).toEqual({ band: '#16191f', ink: '#a9aeb7' })
    expect(tintFor('auto', 'light-daltonized')).toEqual({ band: '#eef0f4', ink: '#5b6170' })
    expect(tintFor('#1d2128', 'dark')).toEqual({ band: '#1d2128', ink: '#a9aeb7' })
    expect(tintFor('off', 'dark')).toBeUndefined()
    expect(tintFor('nonsense', 'dark')).toEqual({ band: '#16191f', ink: '#a9aeb7' })
  })

  test('links follow the terminal unless the setting says otherwise', () => {
    expect(wantsLinks('auto', 'WarpTerminal', 'xterm-256color')).toBe(true)
    expect(wantsLinks('auto', 'Apple_Terminal', 'xterm-256color')).toBe(false)
    expect(wantsLinks('auto', undefined, 'xterm-kitty')).toBe(true)
    expect(wantsLinks('off', 'WarpTerminal', undefined)).toBe(false)
    expect(wantsLinks('on', 'Apple_Terminal', undefined)).toBe(true)
  })
})

describe('the folded line', () => {
  test('names each file Read opened, on terminal and desktop', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ ...group(READS), surface, viewport: WIDE })
      expect(textOf(await ui.drawn())).toBe('● Read  hooks/{register.tsx, sprites.ts}, README.md')
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { marginTop: 1 } })
      await ui.unmount()
    }
  })

  test('partial reads show their lines, and repeats are counted', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const calls = [
      call('Read', { file_path: `${CWD}/src/server.ts`, offset: 40, limit: 40 }),
      call('Read', { file_path: `${CWD}/README.md` }),
      call('Read', { file_path: `${CWD}/README.md` }),
    ]
    const ui = await $.ui.mount({ ...group(calls), surface: 'terminal', viewport: WIDE })
    expect(textOf(await ui.drawn())).toBe('● Read  src/server.ts:40-79, README.md ×2')
    await ui.unmount()
  })

  test('a mixed group gets one row per run of a tool, and one per command', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const calls = [
      ...READS.slice(0, 2),
      call('Grep', { pattern: 'hatched', path: `${CWD}/hooks` }),
      call('Bash', { command: 'git status' }),
      call('Bash', { command: 'npm test' }),
    ]
    const ui = await $.ui.mount({ ...group(calls), surface: 'terminal', viewport: WIDE })
    expect(textOf(await ui.drawn())).toBe(
      '● Read  hooks/{register.tsx, sprites.ts}  Grep  "hatched" in hooks  Bash  git status        npm test',
    )
    const wrapping = (await ui.findAll({ type: 'Text' })).filter(found => found.props.wrap === 'wrap')
    expect(wrapping).toHaveLength(2)
    await ui.unmount()
  })

  test('the call still running is dim until it lands', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const calls = [READS[0]!, call('Read', { file_path: `${CWD}/README.md` }, { isRunning: true })]
    const ui = await $.ui.mount({ ...group(calls), surface: 'terminal', viewport: WIDE })
    const dim = (await ui.findAll({ type: 'Text' })).filter(found => found.props.dimColor === true)
    expect(dim.map(found => found.text)).toEqual(['● ', 'README.md'])
    const soft = (await ui.findAll({ type: 'Text' })).filter(found => found.props.color === '#a9aeb7')
    expect(soft.map(found => found.text)).toEqual(['Read', 'hooks/register.tsx'])
    await ui.unmount()
  })

  test('paths are links in a terminal that draws them, and plain on desktop', async ($, on) => {
    mock.env(on, { HOME, TERM_PROGRAM: 'WarpTerminal' })
    on('session.cwd', () => ({ value: CWD }))

    const terminal = await $.ui.mount({ ...group(READS), surface: 'terminal', viewport: WIDE })
    expect((await terminal.find({ type: 'Link' }))?.props.href).toBe(`file://${CWD}/hooks/register.tsx`)
    expect(await terminal.findAll({ type: 'Link' })).toHaveLength(3)
    await terminal.unmount()

    const desktop = await $.ui.mount({ ...group(READS), surface: 'desktop', viewport: WIDE })
    expect(await desktop.find({ type: 'Link' })).toBeUndefined()
    await desktop.unmount()
  })

  test('links off keeps paths plain', { options: { links: 'off' } }, async ($, on) => {
    mock.env(on, { HOME, TERM_PROGRAM: 'WarpTerminal' })
    on('session.cwd', () => ({ value: CWD }))

    const ui = await $.ui.mount({ ...group(READS), surface: 'terminal', viewport: WIDE })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
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
    const ui = await $.ui.mount({ ...group([blocked]), surface: 'terminal', viewport: WIDE })
    expect(textOf(await ui.drawn())).toBe('● Read  ~/.ssh/id_rsa  blocked by seatbelt')
    const red = (await ui.findAll({ type: 'Text' })).filter(found => found.props.color === '#ff6b80')
    expect(red.map(found => found.text)).toEqual(['● ', '~/.ssh/id_rsa  blocked by seatbelt'])
    await ui.unmount()
  })

  test('a narrow window cuts the list with +N more', async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const ui = await $.ui.mount({ ...group(READS), surface: 'terminal', viewport: { columns: 50, rows: 40 } })
    expect(textOf(await ui.drawn())).toBe('● Read  hooks/{register.tsx, sprites.ts} +1 more')
    await ui.unmount()
  })

  test('a single tool row sits on the band in the terminal, and is left alone elsewhere', async ($, on) => {
    on('ui.render', { component: 'ToolUse' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.tool}</Text>
    })
    const row = {
      plugin: 'readout',
      component: 'ToolUse',
      props: { tool_use_id: 't1', tool: 'Edit', input: { file_path: `${CWD}/a.ts` }, isRunning: false, isErrored: false, isInterrupted: false },
    } as const

    const terminal = await $.ui.mount({ ...row, surface: 'terminal' })
    expect(await terminal.drawn()).toMatchObject({ type: 'Box', props: { backgroundColor: '#16191f' } })
    expect(textOf(await terminal.drawn())).toBe('Edit')
    await terminal.unmount()

    const desktop = await $.ui.mount({ ...row, surface: 'desktop' })
    expect(await desktop.drawn()).toMatchObject({ type: 'Text' })
    await desktop.unmount()
  })

  test('tint off leaves tool rows as Claude Code draws them', { options: { tint: 'off' } }, async ($, on) => {
    mock.env(on, { HOME })
    on('session.cwd', () => ({ value: CWD }))

    const ui = await $.ui.mount({ ...group(READS), surface: 'terminal', viewport: WIDE })
    expect(await ui.drawn()).not.toMatchObject({ props: { backgroundColor: expect.anything() } })
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
