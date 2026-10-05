import type { Tier, TodoItem } from '../types'

export const TIER_HEADINGS: Record<Exclude<Tier, 'done'>, string> = {
  today: '## TODAY',
  red: '## 🔴 最優先でやりたい',
  waiting: '## ⏳ 相手待ち',
  yellow: '## 🟡 ちょっと後回し',
  white: '## ⚪ 余裕がある時',
}

// 見出し「## 🔴 …」で段階が切り替わる。定期タスク・ログなどの見出しでは数えない
const tierOfHeading = (line: string): Tier | null => {
  if (line.startsWith('## ☀') || line.startsWith('## TODAY')) return 'today'
  if (line.startsWith('## 🔴')) return 'red'
  if (line.startsWith('## 🟡')) return 'yellow'
  if (line.startsWith('## ⚪')) return 'white'
  if (line.startsWith('## ⏳')) return 'waiting'
  return null
}

const DONE_MARK = /（\d+\/\d+ 完了）\s*$/

const FROM_MARK = /\s*<!-- from:(red|yellow|white|waiting) -->/

const clean = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '').replace(FROM_MARK, '').trim()

const numOf = (line: string) => line.match(/#(\d+)/)?.[1] ?? ''

export const parseTodo = (md: string): TodoItem[] => {
  const items: TodoItem[] = []
  let tier: Tier | null = null
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      tier = tierOfHeading(line)
      continue
    }
    const isDone = line.startsWith('- [x]')
    if (!tier || !(isDone || line.startsWith('- [ ]'))) continue
    const body = line.slice(5).replace(DONE_MARK, '')
    const project = body.match(/〔([^〕]+)〕/)?.[1] ?? ''
    const num = numOf(body)
    const afterNum = (num ? body.slice(body.indexOf(`#${num}`) + num.length + 1) : body).replace(/^\*\*/, '')
    // タスク名は番号の後の最初の太字。無ければ本文の頭（補足の「（」より前）を使う
    const bold = afterNum.match(/\*\*([^*]+)\*\*/)?.[1]
    const title = clean(bold ?? afterNum.split('（')[0]).replace(/^(〔[^〕]*〕|[🔥\s])+/u, '').trim()
    const from = (line.match(FROM_MARK)?.[1] as Tier | undefined) ?? null
    // 完了したもの（[x]）は「完了」タブだけに出す。元の段階は from に残す
    items.push(isDone ? { tier: 'done', num, project, title: title || clean(body), from: tier } : { tier, num, project, title: title || clean(body), from })
  }
  return items
}

// ---- 書き換え（todo.md の文字列 → 新しい文字列。見つからなければ null） ----

type Block = { start: number; end: number; tier: Tier }

// タスク1件＝「- [ ] … #N …」の行と、その下の字下げされた補足行
const findBlock = (lines: string[], num: string): Block | null => {
  let tier: Tier | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) tier = tierOfHeading(lines[i])
    if (!tier || !lines[i].startsWith('- [ ]') || numOf(lines[i]) !== num) continue
    let end = i + 1
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++
    return { start: i, end, tier }
  }
  return null
}

const ensureToday = (lines: string[]) => {
  if (lines.some(line => tierOfHeading(line) === 'today')) return lines
  const red = lines.findIndex(line => line.startsWith('## 🔴'))
  const at = red === -1 ? lines.length : red
  return [...lines.slice(0, at), TIER_HEADINGS.today, '', ...lines.slice(at)]
}

// 段階の最後のタスクの後ろ（次の見出しの前の空行・コメントより前）に差し込む
const insertAt = (lines: string[], tier: Tier) => {
  const head = lines.findIndex(line => tierOfHeading(line) === tier && line.startsWith('## '))
  if (head === -1) return -1
  let next = lines.findIndex((line, i) => i > head && line.startsWith('## '))
  if (next === -1) next = lines.length
  let at = head + 1
  for (let i = head + 1; i < next; i++) if (/^(- \[|\s+\S)/.test(lines[i])) at = i + 1
  if (at === head + 1 && lines[at] === '') at++
  return at
}

const place = (lines: string[], block: string[], tier: Tier) => {
  const at = insertAt(lines, tier)
  if (at === -1) return null
  return [...lines.slice(0, at), ...block, ...lines.slice(at)]
}

export const moveTask = (md: string, num: string, to: Tier): string | null => {
  let lines = ensureToday(md.split('\n'))
  const found = findBlock(lines, num)
  if (!found || found.tier === to) return null
  const block = lines.slice(found.start, found.end)
  const first = block[0].replace(FROM_MARK, '')
  // Today へ入れるときだけ元の段階を覚えておく（↩ で戻せるように）
  const from = to === 'today' ? (found.tier === 'today' ? null : found.tier) : null
  block[0] = from ? `${first} <!-- from:${from} -->` : first
  lines = [...lines.slice(0, found.start), ...lines.slice(found.end)]
  return place(lines, block, to)?.join('\n') ?? null
}

export const returnTask = (md: string, num: string): string | null => {
  const item = parseTodo(md).find(one => one.num === num && one.tier === 'today')
  return item ? moveTask(md, num, item.from ?? 'yellow') : null
}

export const completeTask = (md: string, num: string, date: string): string | null => {
  const lines = md.split('\n')
  const found = findBlock(lines, num)
  if (!found) return null
  lines[found.start] = `${lines[found.start].replace('- [ ]', '- [x]').replace(FROM_MARK, '')}（${date} 完了）`
  return lines.join('\n')
}

// 完了を取り消す：[x] を [ ] に戻し、「（10/5 完了）」を外す
export const uncompleteTask = (md: string, num: string): string | null => {
  const lines = md.split('\n')
  const at = lines.findIndex(line => line.startsWith('- [x]') && numOf(line) === num)
  if (at === -1) return null
  lines[at] = lines[at].replace('- [x]', '- [ ]').replace(DONE_MARK, '')
  return lines.join('\n')
}

// 新しいタスクの番号：空いている番号のうち、いちばん小さいもの（2026-10-05 あずささんのルール）
// 「使用中」＝TODAY・🔴・⏳・🟡・⚪・🔁 の見出しの下に出てくる #番号すべて。
// - タスク自身の番号だけでなく、ほかのタスクの本文で参照されている番号も使用中（参照が残っている番号は後回し）
// - 今日 ✓ を付けた完了タスクも、夜の整理で消えるまでは行が残るので使用中（同じ日に1つの番号が2つの意味を持たない）
// - 進捗ログ・冒頭の説明など、それ以外の見出しの下の番号は昔の記録なので数えない
const isTaskHeading = (line: string) => tierOfHeading(line) !== null || line.startsWith('## 🔁')

export const usedNumbers = (md: string) => {
  const used = new Set<number>()
  let inTasks = false
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      inTasks = isTaskHeading(line)
      continue
    }
    if (!inTasks) continue
    for (const m of line.matchAll(/#(\d+)/g)) used.add(Number(m[1]))
  }
  return used
}

export const nextNumber = (md: string) => {
  const used = usedNumbers(md)
  let n = 1
  while (used.has(n)) n++
  return n
}

export const addTask = (md: string, title: string, project: string, tier: Tier): { md: string; num: number } | null => {
  const lines = ensureToday(md.split('\n'))
  const num = nextNumber(md)
  const tag = project.trim() || '未分類'
  const mark = tier === 'today' ? ' <!-- from:yellow -->' : ''
  const placed = place(lines, [`- [ ] 〔${tag}〕**#${num}** **${title.trim()}**${mark}`], tier)
  return placed ? { md: placed.join('\n'), num } : null
}
