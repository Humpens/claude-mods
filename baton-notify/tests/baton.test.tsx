import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = { title: 'バトン通知の設定', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
const CMD = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const setup = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const runs: string[][] = []
  const store = new Map<string, unknown>()
  mock.clock(on, { now: Date.parse('2026-10-05T06:00:00Z') })
  on('process.run', (_, e) => (runs.push([...(e as { argv: string[] }).argv]), { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false } }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }))
  on('session.cwd', () => ({ value: '/Users/x/Desktop/my-project' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'TODOを確認して', toolUses: [] }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { runs, store }
}

test('/baton test で Mac の通知と音が出る', async ($, on) => {
  const { runs } = setup(on)
  await $.command.run({ command: 'baton', args: 'test', ...CMD })
  expect(runs.some(argv => argv[0] === 'osascript' && argv.includes('🔔 テスト通知です'))).toBe(true)
  expect(runs.some(argv => argv[0] === 'afplay' && argv.includes('0.5'))).toBe(true)
})

test('/baton off で止まり、on で戻る', async ($, on) => {
  const { runs, store } = setup(on)
  await $.command.run({ command: 'baton', args: 'off', ...CMD })
  expect((store.get('settings') as { enabled: boolean }).enabled).toBe(false)
  await $.command.run({ command: 'baton', args: 'on', ...CMD })
  expect((store.get('settings') as { enabled: boolean }).enabled).toBe(true)
  expect(runs.length).toBe(0)
})

test('設定ペインが描け、ボタンで音の種類・音量・オンオフが変わる', async ($, on) => {
  const { runs, store } = setup(on)
  await $.command.run({ command: 'baton', args: '', ...CMD })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const pane = await $.ui.mount({ plugin: 'baton-notify', surface, component: 'Pane', requestId: 'baton-notify', props: PANE_PROPS, viewport: { columns: 90, rows: 40 } })
    expect(await pane.find({ type: 'Button', key: 'snd-Hero' })).toBeDefined()
    await pane.unmount()
  }
  const pane = await $.ui.mount({ plugin: 'baton-notify', surface: 'desktop', component: 'Pane', requestId: 'baton-notify', props: PANE_PROPS, viewport: { columns: 90, rows: 40 } })
  await pane.press({ key: 'snd-Hero' })
  await pane.press({ key: 'vol-75' })
  await pane.press({ key: 'speak' })
  await pane.input({ key: 'speakDone', text: 'おわったー' })
  const saved = store.get('settings') as { soundName: string; volume: number; speak: boolean; speakDone: string }
  expect(saved.soundName).toBe('Hero')
  expect(saved.volume).toBe(0.75)
  expect(saved.speak).toBe(true)
  expect(saved.speakDone).toBe('おわったー')
  expect(runs.filter(argv => argv[0] === 'afplay').at(-1)).toContain('/System/Library/Sounds/Hero.aiff')
  await pane.unmount()
})
