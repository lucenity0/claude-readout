/** One call of a folded group, as much of it as a line needs. */
export type Call = {
  tool: string
  input: unknown
  isErrored: boolean
  reason?: string
}

/** One drawn item: a path, pattern or command, and why it failed if it did. */
export type Item = { text: string; isErrored: boolean; reason?: string }

/** One line of the readout: a tool and what it touched, cut to fit. */
export type Line = { tool: string; items: Item[]; more: number; separator: string }

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

function field(input: unknown, key: string): string | undefined {
  if (typeof input !== 'object' || input === null || !(key in input)) return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function clip(text: string, length: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > length ? `${line.slice(0, Math.max(1, length - 1))}…` : line
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

/** What a call touched, in a few words, or undefined for a tool readout does not know. */
export function labelOf(tool: string, input: unknown, cwd: string, home: string | undefined): string | undefined {
  const pathKey = PATH_TOOLS[tool]
  if (pathKey !== undefined) {
    const path = field(input, pathKey)
    return path === undefined ? undefined : shortPath(path, cwd, home)
  }

  if (tool === 'Grep' || tool === 'Glob') {
    const pattern = field(input, 'pattern')
    if (pattern === undefined) return undefined
    const where = field(input, 'path')
    const quoted = tool === 'Grep' ? `"${clip(pattern, 40)}"` : clip(pattern, 40)
    return where === undefined ? quoted : `${quoted} in ${shortPath(where, cwd, home)}`
  }

  if (tool === 'Bash') {
    const command = field(input, 'command')
    return command === undefined ? undefined : clip(command, 160)
  }

  const queryKey = QUERY_TOOLS[tool]
  if (queryKey !== undefined) {
    const query = field(input, queryKey)
    return query === undefined ? undefined : clip(query.replace(/^https?:\/\//, ''), 120)
  }

  return undefined
}

/** The short form of a failure: who blocked it, or the error's first clause. */
export function shortReason(text: string, isDenied: boolean): string {
  const owner = /^([\w@.-]+):\s/.exec(text)?.[1]
  if (isDenied) return owner === undefined ? 'blocked' : `blocked by ${owner}`

  const first = text.split('\n').find(line => line.trim() !== '') ?? ''
  return clip(first.replace(/<\/?[\w_-]+>/g, '').split(/[.;]\s/)[0] ?? '', 40)
}

function itemWidth(item: Item): number {
  return item.text.length + (item.reason === undefined ? 0 : item.reason.length + 2)
}

/**
 * Groups a run of calls into lines, one per run of the same tool, each cut to
 * `room` columns with `+N more`. Undefined when no call has a label, so the
 * engine's own count line stays.
 */
export function groupLines(calls: readonly Call[], room: number, cwd: string, home: string | undefined): Line[] | undefined {
  const lines: Array<{ tool: string; items: Item[] }> = []
  let isAnyLabelled = false

  for (const call of calls) {
    const label = labelOf(call.tool, call.input, cwd, home)
    if (label !== undefined) isAnyLabelled = true
    const item: Item = {
      text: label ?? '…',
      isErrored: call.isErrored,
      ...(call.isErrored && call.reason !== undefined ? { reason: call.reason } : {}),
    }
    const last = lines[lines.length - 1]
    if (last !== undefined && last.tool === call.tool) last.items.push(item)
    else lines.push({ tool: call.tool, items: [item] })
  }

  if (!isAnyLabelled) return undefined

  return lines.map(({ tool, items }) => {
    const separator = tool === 'Bash' ? ' · ' : ', '
    const kept: Item[] = []
    let used = 0
    for (const [index, item] of items.entries()) {
      const remaining = items.length - index - 1
      const cost = (kept.length === 0 ? 0 : separator.length) + itemWidth(item)
      const tail = remaining === 0 ? 0 : ` +${remaining} more`.length
      if (kept.length > 0 && used + cost + tail > room) break
      kept.push(item)
      used += cost
    }
    return { tool, items: kept, more: items.length - kept.length, separator }
  })
}
