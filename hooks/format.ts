/** One call of a folded group, as much of it as a line needs. */
export type Call = {
  tool: string
  input: unknown
  isErrored: boolean
  isRunning: boolean
  reason?: string
}

/** One drawn name: a file, pattern or command, how often it came up, and its state. */
export type Item = {
  name: string
  path?: string
  count: number
  isErrored: boolean
  isRunning: boolean
  reason?: string
}

/** Names that share a folder, drawn `folder/{a, b}`; `folder` is empty for one drawn whole. */
export type Entry = { folder: string; items: Item[] }

/** One row of the readout: a tool and what it touched, cut to fit or left to wrap. */
export type Line = { tool: string; isFirstOfTool: boolean; entries: Entry[]; more: number; wraps: boolean }

/** What a call touched: the words to show, and the file behind them when there is one. */
export type Target = { label: string; path?: string; range?: string }

const PATH_TOOLS: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  LS: 'path',
}

const QUERY_TOOLS: Record<string, string> = {
  WebFetch: 'url',
  WebSearch: 'query',
  ToolSearch: 'query',
}

/** Terminals that draw OSC 8 hyperlinks; elsewhere a link prints its URL beside the name. */
const LINKING_TERMINALS = ['iTerm.app', 'WezTerm', 'ghostty', 'vscode', 'WarpTerminal', 'Hyper', 'Tabby', 'rio']

function field(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null || !(key in input)) return undefined
  return (input as Record<string, unknown>)[key]
}

function text(input: unknown, key: string): string | undefined {
  const value = field(input, key)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function count(input: unknown, key: string): number | undefined {
  const value = field(input, key)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

export function clip(line: string, length: number): string {
  const flat = line.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, Math.max(1, length - 1))}…` : flat
}

/** A path relative to the working directory, or under `~`, whichever reads shorter. */
export function shortPath(path: string, cwd: string, home: string | undefined): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  if (path === cwd) return '.'
  if (path.startsWith(base)) return path.slice(base.length)
  if (home !== undefined && home !== '' && (path === home || path.startsWith(`${home}/`))) {
    return `~${path.slice(home.length)}`
  }
  return path
}

/** The part of a file a Read took: `:40-79`, `:120-` or ` p.3-5`; empty for the whole file. */
export function rangeOf(input: unknown): string {
  const pages = text(input, 'pages')
  if (pages !== undefined) return ` p.${pages}`

  const offset = count(input, 'offset')
  const limit = count(input, 'limit')
  if (offset === undefined && limit === undefined) return ''
  const start = offset ?? 1
  return limit === undefined ? `:${start}-` : `:${start}-${start + limit - 1}`
}

/** What a call touched, or undefined for a tool readout does not know. */
export function targetOf(tool: string, input: unknown, cwd: string, home: string | undefined): Target | undefined {
  const pathKey = PATH_TOOLS[tool]
  if (pathKey !== undefined) {
    const path = text(input, pathKey)
    if (path === undefined) return undefined
    const absolute = path.startsWith('/') ? path : `${cwd.replace(/\/$/, '')}/${path}`
    const range = tool === 'Read' ? rangeOf(input) : ''
    return { label: shortPath(absolute, cwd, home), path: absolute, ...(range === '' ? {} : { range }) }
  }

  if (tool === 'Grep' || tool === 'Glob') {
    const pattern = text(input, 'pattern')
    if (pattern === undefined) return undefined
    const where = text(input, 'path')
    const quoted = tool === 'Grep' ? `"${clip(pattern, 40)}"` : clip(pattern, 40)
    return { label: where === undefined ? quoted : `${quoted} in ${shortPath(where, cwd, home)}` }
  }

  if (tool === 'Bash') {
    const command = text(input, 'command')
    return command === undefined ? undefined : { label: command.replace(/\s+/g, ' ').trim() }
  }

  const queryKey = QUERY_TOOLS[tool]
  if (queryKey !== undefined) {
    const query = text(input, queryKey)
    return query === undefined ? undefined : { label: clip(query.replace(/^https?:\/\//, ''), 120) }
  }

  return undefined
}

/** The short form of a failure: who blocked it, or the error's first clause. */
export function shortReason(message: string, isDenied: boolean): string {
  const owner = /^([\w@.-]+):\s/.exec(message)?.[1]
  if (isDenied) return owner === undefined ? 'blocked' : `blocked by ${owner}`

  const first = message.split('\n').find(line => line.trim() !== '') ?? ''
  return clip(first.replace(/<\/?[\w_-]+>/g, '').split(/[.;]\s/)[0] ?? '', 40)
}

/** Whether to draw paths as links: `on`, `off`, or `auto` for terminals known to draw them. */
export function wantsLinks(setting: unknown, termProgram: string | undefined, term: string | undefined): boolean {
  if (setting === 'on') return true
  if (setting === 'off') return false
  if (termProgram !== undefined && LINKING_TERMINALS.includes(termProgram)) return true
  return term !== undefined && /kitty|ghostty|wezterm/.test(term)
}

/** The look of tool rows: a quiet band behind them and softer text, or nothing when off. */
export type Tint = { band: string; ink: string }

/** `off`, a band color of the person's own, or a quiet band and soft ink for the theme. */
export function tintFor(setting: unknown, theme: string): Tint | undefined {
  if (setting === 'off') return undefined
  const isLight = theme.includes('light')
  const ink = isLight ? '#5b6170' : '#a9aeb7'
  if (typeof setting === 'string' && /^#[0-9a-f]{6}$/i.test(setting)) return { band: setting, ink }
  return { band: isLight ? '#eef0f4' : '#16191f', ink }
}

export function itemWidth(item: Item): number {
  return (
    item.name.length +
    (item.count > 1 ? ` ×${item.count}`.length : 0) +
    (item.reason === undefined ? 0 : item.reason.length + 2)
  )
}

/** Same name, same outcome: one item with a count. */
function merge(items: Item[]): Item[] {
  const merged: Item[] = []
  for (const item of items) {
    const same = merged.find(seen => seen.name === item.name && seen.isErrored === item.isErrored)
    if (same === undefined) merged.push({ ...item })
    else {
      same.count += item.count
      same.isRunning ||= item.isRunning
    }
  }
  return merged
}

/** Names under one folder gather into `folder/{a, b}`, in the order each folder first came up. */
export function foldFolders(items: Item[]): Entry[] {
  const byFolder = new Map<string, Item[]>()
  for (const item of items) {
    const cut = item.name.lastIndexOf('/')
    const folder = cut < 0 ? '' : item.name.slice(0, cut + 1)
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), item])
  }

  const entries: Entry[] = []
  for (const [folder, members] of byFolder) {
    if (folder === '' || members.length === 1) {
      for (const member of members) entries.push({ folder: '', items: [member] })
    } else {
      entries.push({ folder, items: members.map(member => ({ ...member, name: member.name.slice(folder.length) })) })
    }
  }
  return entries
}

/** Keeps what fits in `room` columns, by item, leaving space for `+N more`. */
function fit(entries: Entry[], room: number): { entries: Entry[]; more: number } {
  const total = entries.reduce((sum, entry) => sum + entry.items.length, 0)
  const kept: Entry[] = []
  let used = 0
  let placed = 0

  for (const entry of entries) {
    const isFolded = entry.folder !== ''
    const keptItems: Item[] = []
    for (const item of entry.items) {
      const opening = keptItems.length === 0 ? (kept.length === 0 ? 0 : 2) + entry.folder.length + (isFolded ? 2 : 0) : 2
      const cost = opening + itemWidth(item)
      const remaining = total - placed - 1
      const tail = remaining === 0 ? 0 : ` +${remaining} more`.length
      if (placed > 0 && used + cost + tail > room) {
        if (keptItems.length > 0) kept.push({ ...entry, items: keptItems })
        return { entries: kept, more: total - placed }
      }
      keptItems.push(item)
      used += cost
      placed += 1
    }
    kept.push({ ...entry, items: keptItems })
  }

  return { entries: kept, more: 0 }
}

/**
 * Lays a run of calls out as rows: one per run of the same tool, its names
 * merged, folded by folder and cut to `room` with `+N more`; one per Bash
 * command, left to wrap. Undefined when no call has a label, so the engine's
 * own count line stays.
 */
export function groupLines(calls: readonly Call[], room: number, cwd: string, home: string | undefined): Line[] | undefined {
  const runs: Array<{ tool: string; items: Item[] }> = []
  let isAnyLabelled = false

  for (const call of calls) {
    const target = targetOf(call.tool, call.input, cwd, home)
    if (target !== undefined) isAnyLabelled = true
    const item: Item = {
      name: target === undefined ? '…' : `${target.label}${target.range ?? ''}`,
      ...(target?.path === undefined ? {} : { path: target.path }),
      count: 1,
      isErrored: call.isErrored,
      isRunning: call.isRunning,
      ...(call.isErrored && call.reason !== undefined ? { reason: call.reason } : {}),
    }
    const last = runs[runs.length - 1]
    if (last !== undefined && last.tool === call.tool) last.items.push(item)
    else runs.push({ tool: call.tool, items: [item] })
  }

  if (!isAnyLabelled) return undefined

  return runs.flatMap(({ tool, items }): Line[] => {
    if (tool === 'Bash') {
      return merge(items).map((item, index) => ({
        tool,
        isFirstOfTool: index === 0,
        entries: [{ folder: '', items: [{ ...item, name: clip(item.name, room * 3) }] }],
        more: 0,
        wraps: true,
      }))
    }

    const merged = merge(items)
    const entries = PATH_TOOLS[tool] === undefined ? merged.map(item => ({ folder: '', items: [item] })) : foldFolders(merged)
    return [{ tool, isFirstOfTool: true, ...fit(entries, room), wraps: false }]
  })
}
