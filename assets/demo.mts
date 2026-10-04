// Renders the README's animation with the mod's own layout code: one made-up
// turn, drawn twice, as Claude Code folds it and as readout draws it.
// Run: node --experimental-strip-types assets/demo.mts
import { groupLines } from '../hooks/format.ts'
import type { Call, Item, Line } from '../hooks/format.ts'
import { writeFileSync } from 'node:fs'

const FRAME_S = 0.5
const TICKS = 26
const COLUMNS = 92
const CWD = '/work/app'
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const ROW = 19
const WIDTH = 760

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// The turn: each call starts at `at` and lands a tick later.
const CALLS: Array<{ at: number; tool: string; input: object }> = [
  { at: 4, tool: 'Read', input: { file_path: `${CWD}/src/date.ts` } },
  { at: 6, tool: 'Read', input: { file_path: `${CWD}/src/date.test.ts`, offset: 1, limit: 60 } },
  { at: 8, tool: 'Read', input: { file_path: `${CWD}/src/tz/offsets.ts` } },
  { at: 10, tool: 'Read', input: { file_path: `${CWD}/src/tz/rules.ts` } },
  { at: 12, tool: 'Read', input: { file_path: `${CWD}/src/date.ts` } },
  { at: 14, tool: 'Bash', input: { command: 'grep -rn "toLocaleDateString" src' } },
]
const ANSWER_AT = 17

function callsAt(tick: number): Call[] {
  return CALLS.filter(call => call.at <= tick).map(call => ({
    tool: call.tool,
    input: call.input,
    isErrored: false,
    isRunning: tick === call.at,
  }))
}

function item(entry: Item): string {
  const cls = entry.isRunning ? ' class="dim"' : ''
  const count = entry.count > 1 ? `<tspan class="dim"> ×${entry.count}</tspan>` : ''
  return `<tspan${cls}>${esc(entry.name)}</tspan>${count}`
}

/** readout's rows for a tick, drawn from `groupLines` exactly as register.tsx lays them out. */
function readoutRows(calls: Call[]): string[] {
  const lines: Line[] = groupLines(calls, COLUMNS - 10, CWD, undefined) ?? []
  const nameWidth = Math.max(...calls.map(call => call.tool.length))
  const isRunning = calls.some(call => call.isRunning)
  return lines.map((line, index) => {
    const bullet = index === 0 ? `<tspan class="${isRunning ? 'dim' : 'grn'}">●</tspan> ` : '  '
    const name = `<tspan class="b">${(line.isFirstOfTool ? line.tool : '').padEnd(nameWidth)}</tspan>  `
    const entries = line.entries
      .map(entry => {
        const items = entry.items.map(item).join(', ')
        return entry.folder === '' ? items : `${esc(entry.folder)}{${items}}`
      })
      .join(', ')
    return bullet + name + entries
  })
}

/** Claude Code's own folded line for the same calls. */
function foldedRow(calls: Call[]): string {
  const reads = calls.filter(call => call.tool === 'Read').length
  const commands = calls.filter(call => call.tool === 'Bash').length
  const parts = [`Read ${reads} file${reads === 1 ? '' : 's'}`]
  if (commands > 0) parts.push(`ran ${commands} shell command${commands === 1 ? '' : 's'}`)
  const isRunning = calls.some(call => call.isRunning)
  return `<tspan class="${isRunning ? 'dim' : 'grn'}">●</tspan> ${parts.join(', ')} <tspan class="dim">(ctrl+o to expand)</tspan>`
}

/** What one panel shows at a tick, as rows of tspans. */
function panel(tick: number, rows: (calls: Call[]) => string[]): string[] {
  const out = ['<tspan class="acc">&gt;</tspan> the date test fails on CI but passes locally. why?']
  if (tick >= 2) out.push('', "● I'll read the date helpers and their test.")
  const calls = callsAt(tick)
  if (calls.length > 0) out.push('', ...rows(calls))
  if (tick >= ANSWER_AT) out.push('', '● The test builds dates in local time, and CI runs in UTC.')
  return out
}

function frames(top: number, rows: (calls: Call[]) => string[]): string {
  const still = process.env.STILL
  if (still !== undefined) {
    return panel(Number(still), rows)
      .map((row, index) => `<text x="24" y="${top + index * ROW}">${row}</text>`)
      .join('')
  }
  const rules: string[] = []
  const groups: string[] = []
  let from = 0
  let last = panel(0, rows).join('\n')
  const flush = (body: string, start: number, end: number) => {
    const id = `k${top}x${start}`
    rules.push(`@keyframes ${id} { 0% { opacity: 1 } ${(((end - start) / TICKS) * 100).toFixed(3)}% { opacity: 0 } 100% { opacity: 0 } }`)
    const delay = -((TICKS - start) % TICKS) * FRAME_S
    const text = body
      .split('\n')
      .map((row, index) => `<text x="24" y="${top + index * ROW}">${row}</text>`)
      .join('')
    groups.push(`<g style="opacity:0;animation:${id} ${TICKS * FRAME_S}s step-end ${delay.toFixed(2)}s infinite">${text}</g>`)
  }
  for (let tick = 1; tick <= TICKS; tick++) {
    const now = tick < TICKS ? panel(tick, rows).join('\n') : ''
    if (now !== last || tick === TICKS) {
      flush(last, from, tick)
      from = tick
      last = now
    }
  }
  return `<style>${rules.join('\n')}</style>\n${groups.join('\n')}`
}

const PANEL_ROWS = 8
const FIRST = 52
const SECOND = FIRST + PANEL_ROWS * ROW + 46
const HEIGHT = SECOND + PANEL_ROWS * ROW + 12

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="The same turn twice: Claude Code folds six calls into Read 5 files, ran 1 shell command, while readout names each file as it is read, with line ranges, a repeat count and the grep command">
<style>
text { font-family: ${FONT}; font-size: 12px; fill: #e6e6e6; white-space: pre; }
.dim { fill: #8b8b8b; } .acc { fill: #d97757; } .grn { fill: #57ab5a; } .b { font-weight: 700; }
.title { font-size: 11px; fill: #9a9a9a; letter-spacing: 0.04em; }
</style>
<rect width="${WIDTH}" height="${HEIGHT}" rx="10" fill="#1b1b1d"/>
<text class="title" x="24" y="${FIRST - 22}">claude code</text>
${frames(FIRST, calls => [foldedRow(calls)])}
<line x1="24" x2="${WIDTH - 24}" y1="${SECOND - 40}" y2="${SECOND - 40}" stroke="#333" />
<text class="title" x="24" y="${SECOND - 22}">with readout</text>
${frames(SECOND, readoutRows)}
</svg>
`

const out = process.env.OUT ?? new URL('./demo.svg', import.meta.url)
writeFileSync(out, svg)
console.log(`wrote ${String(out)} (${svg.length} bytes)`)
