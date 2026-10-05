import { expect, mock, test } from 'claude-code/testing'

import { addTask, completeTask, moveTask, nextNumber, parseTodo, returnTask } from '../hooks/parse'
import { resolvePath, TEMPLATE } from '../hooks/register'

const MD = [
  '# マスターTODO',
  '## 🔴 最優先でやりたい',
  '- [ ] 〔仕事〕**#52** 🔥〔新規・急ぎ〕**確定申告**（補足）',
  '  - 進捗メモ（数えない）',
  '- [ ] 〔副業〕**#73** 〔新規〕**書類を返送**（補足）',
  '',
  '## ⏳ 相手待ち',
  '- [ ] 〔仕事〕**#111** 見積もりの返事待ち',
  '## 🟡 ちょっと後回し',
  '- [ ] 〔副業〕**#68** **note 記事を公開**',
  '## ⚪ 余裕がある時',
  '- [ ] 〔習慣化〕**#47** 習慣化プロジェクトの開始（説明）',
  '## 🔁 定期タスク',
  '- [ ] 〔仕事〕**#58** 毎月の請求（数えない）',
  '## 📋 進捗ログ',
  '- [x] 終わったもの',
].join('\n')

const PANE_PROPS = { title: 'TODO', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 28 }, view: {} } as const
const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const
const tiers = (md: string) => parseTodo(md).map(i => `${i.tier}:${i.num}`)

test('段階ごとに数え、定期タスク・ログ・子項目は数えない', () => {
  expect(parseTodo(MD).filter(i => i.tier !== 'done').map(i => `${i.tier}:${i.num}:${i.title}`)).toEqual([
    'red:52:確定申告',
    'red:73:書類を返送',
    'waiting:111:見積もりの返事待ち',
    'yellow:68:note 記事を公開',
    'white:47:習慣化プロジェクトの開始',
  ])
})

test('TODO の場所：空なら ~/todo.md、~ はホームに置きかえる。ひな形は空の5段階', () => {
  expect(resolvePath('', '/Users/x')).toBe('/Users/x/todo.md')
  expect(resolvePath('~/Documents/todo.md', '/Users/x')).toBe('/Users/x/Documents/todo.md')
  expect(resolvePath('/tmp/t.md', '/Users/x')).toBe('/tmp/t.md')
  expect(parseTodo(TEMPLATE)).toEqual([])
  expect(addTask(TEMPLATE, '最初のタスク', '', 'today')?.md).toContain('## TODAY\n\n- [ ] 〔未分類〕**#1** **最初のタスク**')
})

test('番号は空いている小さいものから。本文で参照されている番号・今日完了した番号・定期タスクは使わない', () => {
  const md = [
    '# TODO',
    '> 最終更新：#1 と #2 は欠番（冒頭の説明は数えない）',
    '## 🔴 最優先でやりたい',
    '- [ ] 〔仕事〕**#3** **見積もり**（#4 の撮影準備とセットで）',
    '- [x] 〔仕事〕**#5** **請求**（10/5 完了）',
    '## ⏳ 相手待ち',
    '- [ ] 〔仕事〕**#7** 返事待ち',
    '## 🔁 定期タスク',
    '- [ ] 〔仕事〕**#6** 毎月の締め',
    '## 📋 進捗ログ',
    '- #1・#2 は空き（再利用可）',
  ].join('\n')
  expect(nextNumber(md)).toBe(1)
  const two = addTask(md, '一つ目', '', 'red')!
  expect(two.num).toBe(1)
  expect(nextNumber(two.md)).toBe(2)
  const three = addTask(addTask(two.md, '二つ目', '', 'red')!.md, '三つ目', '', 'red')!
  expect(three.num).toBe(8)
})

test('今日へ移す→元に戻す→段階を変える→完了→追加', () => {
  let md = moveTask(MD, '52', 'today')!
  expect(tiers(md)[0]).toBe('today:52')
  expect(md).toContain('  - 進捗メモ（数えない）')
  expect(parseTodo(md)[0].from).toBe('red')
  md = returnTask(md, '52')!
  expect(tiers(md)).toContain('red:52')
  md = moveTask(md, '47', 'red')!
  expect(tiers(md).filter(t => t.startsWith('red'))).toEqual(['red:73', 'red:52', 'red:47'])
  md = completeTask(md, '73', '10/5')!
  expect(tiers(md)).not.toContain('red:73')
  expect(parseTodo(md).find(i => i.num === '73')).toEqual({ tier: 'done', num: '73', project: '副業', title: '書類を返送', from: 'red' })
  const added = addTask(md, '新しいこと', '副業', 'today')!
  expect(added.num).toBe(1)
  expect(tiers(added.md)[0]).toBe('today:1')
  expect(moveTask(md, '9999', 'red')).toBeNull()
})

test('帯はふだん出さず、/todo band で出し入れ。ペインのボタンで今日へ移せる', async ($, on) => {
  let file = MD
  const store = new Map<string, unknown>()
  mock.clock(on, { now: Date.parse('2026-10-05T06:00:00Z') })
  on('fs.read', () => ({ value: file }))
  on('fs.exists', () => ({ value: true }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.write', (_, e) => ((file = (e as { text: string }).text), { value: undefined }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e as never)
    return <Text>engine</Text>
  })
  await $.command.run({ command: 'todo', args: '', ...CMD })

  const bandProps = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } as never
  let band = await $.ui.mount({ plugin: 'today', surface: 'desktop', component: 'AbovePrompt', props: bandProps, viewport: { columns: 120, rows: 30 } })
  expect(await band.find({ type: 'Button', key: 'open' })).toBeUndefined()
  await band.unmount()
  await $.command.run({ command: 'todo', args: 'band', ...CMD })
  band = await $.ui.mount({ plugin: 'today', surface: 'desktop', component: 'AbovePrompt', props: bandProps, viewport: { columns: 120, rows: 30 } })
  expect(await band.find({ type: 'Text', text: /0 ｜ ◎2$/ })).toBeDefined()
  await band.unmount()

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    file = MD
    await $.command.run({ command: 'todo', args: 'red', ...CMD })
    const pane = await $.ui.mount({ plugin: 'today', surface, component: 'Pane', requestId: 'today', props: PANE_PROPS, viewport: { columns: 90, rows: 30 } })
    expect(await pane.find({ type: 'Text', text: /確定申告/ })).toBeDefined()
    await pane.press({ key: 'mv-52-today' })
    expect(tiers(file)[0]).toBe('today:52')
    await pane.press({ key: 'tab-today' })
    await pane.press({ key: 'done-52' })
    expect(tiers(file)).not.toContain('today:52')
    expect(tiers(file)).toContain('done:52')
    await pane.press({ key: 'tab-done' })
    await pane.press({ key: 'undo-52' })
    expect(tiers(file)).toContain('today:52')
    await pane.press({ key: 'tab-red' })
    await pane.press({ key: 'done-73' })
    expect(tiers(file)).toContain('done:73')
    await pane.unmount()
  }
})
