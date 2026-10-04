import { expect, test } from 'claude-code/testing'

import { statusText } from '../hooks/register'

test('短い英語表記で一行にまとまる', () => {
  const usage = {
    rateLimits: [
      { kind: 'seven_day', percentUsed: 20 },
      { kind: 'seven_day_fable', percentUsed: 12.4 },
      { kind: 'five_hour', percentUsed: 82, resetsAt: '2026-10-05T10:10:00+09:00' },
    ],
    cost: { usd: 9.5289 },
    context: { percent: 41 },
  }
  expect(statusText(usage)).toBe('⚠5h 82% · 7d 20% · $9.53')
  const d = { show: true, fiveHour: true, sevenDay: false, others: false, reset: true, cost: false, context: true }
  expect(statusText(usage, d)).toBe('⚠5h 82%→10:10 · ctx 41%')
  expect(statusText(usage, { ...d, show: false })).toBeUndefined()
})

test('数字がまだ無ければ何も出さない', () => {
  expect(statusText({ rateLimits: [] })).toBeUndefined()
})
