import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Display } from '../types'

const PANE = 'u'
const STORE_KEY = 'display'

export const DEFAULT_DISPLAY: Display = { show: true, fiveHour: true, sevenDay: true, others: true, reset: false, cost: true, context: false }

const display = atom({ plugin: 'u', key: 'display' } as const, DEFAULT_DISPLAY)

// 表示の設定は全セッション共通（$.store）。別のセッションで変えても効くよう、描くたびに読み直す
const loadDisplay = async ($: EngineInterface) => {
  const fresh = { ...DEFAULT_DISPLAY, ...((await $.store.get(STORE_KEY)) as Partial<Display> | undefined) }
  await update($, display, () => fresh)
  return fresh
}

type Usage = { rateLimits: readonly Window[]; cost?: { usd: number }; context?: { percent?: number } }

type Window = { kind: string; percentUsed: number; resetsAt?: string }

// 使用率で色の丸を付ける（ステータス行は文字だけなので絵文字で色を出す）
const dot = (pct: number) => (pct >= 80 ? '🔴' : pct >= 50 ? '🟡' : '🟢')

export const labelOf = (kind: string) => {
  if (kind === 'five_hour') return '5時間'
  if (kind === 'seven_day') return '週'
  if (/fable/i.test(kind)) return /seven|week/i.test(kind) ? 'Fable週' : 'Fable'
  if (/opus/i.test(kind)) return 'Opus'
  if (kind === 'spend_limit') return '利用上限'
  return kind
}

const ORDER = ['five_hour', 'seven_day']
const sortWindows = (list: readonly Window[]) =>
  [...list].sort((a, b) => (ORDER.indexOf(a.kind) + 1 || 99) - (ORDER.indexOf(b.kind) + 1 || 99))

const pad = (n: number) => String(n).padStart(2, '0')

// 5時間枠は「何時にリセット」、週の枠は「何日にリセット」が分かれば十分
export const resetText = (kind: string, iso: string | undefined, now: number) => {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const hours = (at.getTime() - now) / 3_600_000
  if (kind === 'five_hour' || hours < 24) return `${at.getHours()}:${pad(at.getMinutes())}まで`
  return `${at.getMonth() + 1}/${at.getDate()}まで`
}

// 右下は狭いので、ターミナルのステータスラインと同じ短い英語表記にする（80%以上だけ ⚠ を付ける）
export const shortLabel = (kind: string) => {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return '7d'
  if (/fable/i.test(kind)) return 'fable'
  if (/opus/i.test(kind)) return 'opus'
  if (kind === 'spend_limit') return 'limit'
  return kind
}

const hhmm = (iso: string | undefined) => {
  const at = iso ? new Date(iso) : null
  return at && !Number.isNaN(at.getTime()) ? `${at.getHours()}:${pad(at.getMinutes())}` : ''
}

// Fable などほかの枠は本体から届かないので、5h と 7d だけを扱う
const wanted = (d: Display, kind: string) => (kind === 'five_hour' ? d.fiveHour : kind === 'seven_day' ? d.sevenDay : false)

export const statusText = (usage: Usage, d: Display = DEFAULT_DISPLAY) => {
  if (!d.show) return undefined
  const parts = sortWindows(usage.rateLimits)
    .filter(w => wanted(d, w.kind))
    .map(w => {
      const reset = d.reset && w.kind === 'five_hour' && hhmm(w.resetsAt) ? `→${hhmm(w.resetsAt)}` : ''
      return `${w.percentUsed >= 80 ? '⚠' : ''}${shortLabel(w.kind)} ${Math.round(w.percentUsed)}%${reset}`
    })
  if (d.context && usage.context?.percent !== undefined) parts.push(`ctx ${Math.round(usage.context.percent)}%`)
  if (d.cost && usage.cost) parts.push(`$${usage.cost.usd.toFixed(2)}`)
  return parts.length ? parts.join(' · ') : undefined
}

const refresh = async ($: EngineInterface, usage?: Usage) => {
  $.ui.status(statusText(usage ?? (await $.session.usage()), await loadDisplay($)))
}

const placedNote = (opened: { isPlaced: boolean; reason?: string }) => (opened.isPlaced ? '' : `（まだ表示されていません：${opened.reason ?? '画面の幅が足りない可能性'}）`)

const OPTIONS: { key: keyof Display; label: string }[] = [
  { key: 'show', label: '右下に表示する' },
  { key: 'fiveHour', label: '5h（5時間の制限）' },
  { key: 'sevenDay', label: '7d（週の制限）' },
  { key: 'reset', label: '5h のリセット時刻（→10:10）' },
  { key: 'cost', label: '$（API 換算の料金）' },
  { key: 'context', label: 'ctx（文脈の使用率）' },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'meter', description: '使用率（5時間・週・Fable）と API 換算の料金をくわしく見る' })
    await loadDisplay($)
    void refresh($)
    // リセット時刻をまたいでも表示が古いままにならないよう、1分ごとにも描き直す
    $.clock.every(60_000, () => void refresh($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, e)

    return next(e)
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    const arg = e.args.trim()
    // Status の Settings から /meter off で右下の表示ごと止める
    if (arg === 'on' || arg === 'off') {
      const next = { ...(await loadDisplay($)), show: arg === 'on' }
      await $.store.set(STORE_KEY, next)
      await update($, display, () => next)
      await refresh($)
      return { text: arg === 'on' ? '使用率の表示をオンにしました。' : '使用率の表示をオフにしました。' }
    }
    await loadDisplay($)
    const opened = await $.ui.open({ id: PANE, title: '使用率と料金' })

    return { text: `使用率のペインを開きました。${placedNote(opened)}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const d = await read($, display)
    const toggle = (key: keyof Display) => async () => {
      const next = { ...(await loadDisplay($)), [key]: !d[key] }
      await $.store.set(STORE_KEY, next)
      await update($, display, () => next)
      await refresh($)
    }
    const usage = await $.session.usage()
    const now = await $.clock.now()
    const windows = sortWindows(usage.rateLimits).filter(w => w.kind === 'five_hour' || w.kind === 'seven_day')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>右下に出すもの</Text>
          <Text dimColor>{`いまの表示：${statusText(usage, d) ?? '（なし）'}`}</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {OPTIONS.map(o => (
              <Button key={`opt-${o.key}`} label={`${d[o.key] ? '✓' : '　'} ${o.label}`} variant={d[o.key] ? 'primary' : 'secondary'} onPress={toggle(o.key)} />
            ))}
          </Box>
        </Box>
        {windows.length === 0 && <Text dimColor>まだ使用率の数字が届いていません（最初の返答のあとに出ます）。</Text>}
        {windows.map(w => (
          <Box key={`w-${w.kind}`} flexDirection="column">
            <Text bold>{`${dot(w.percentUsed)} ${labelOf(w.kind)}の制限：${w.percentUsed}% 使用`}</Text>
            <Text dimColor>{`リセット：${resetText(w.kind, w.resetsAt, now) || '不明'}（${w.resetsAt ?? '-'}）  種類名：${w.kind}`}</Text>
          </Box>
        ))}
        <Box flexDirection="column">
          <Text bold>{`💵 このセッションの API 換算：$${(usage.cost?.usd ?? 0).toFixed(4)}`}</Text>
          <Text dimColor>サブスクなので実際の請求ではありません。API 従量課金だった場合のおおよその金額です。</Text>
        </Box>
        <Text dimColor>{`文脈の使用：${usage.context.percent ?? '-'}%`}</Text>
      </Box>
    )
  })
}
