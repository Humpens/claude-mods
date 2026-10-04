import { expect, test } from 'claude-code/testing'

import { DEFAULT_COMMANDS, migrate, parseTranslations } from '../hooks/register'

test('前のおすすめを保存していた人も、新しいおすすめに入れ替わり、自分で足したものと★は残る', () => {
  const old = { isHidden: false, commands: [{ name: 'todo', desc: 'x', isFavorite: true }, { name: 'code-review', desc: 'x', isFavorite: false }, { name: 'mine', desc: '自分の', isFavorite: true }] }
  const next = migrate(old)
  expect(next.commands?.map(c => c.name)).toEqual([...DEFAULT_COMMANDS.map(c => c.name), 'mine'])
  expect(next.commands?.filter(c => c.isFavorite).map(c => c.name)).toEqual(['todo', 'mine'])
  expect(migrate(next)).toEqual(next)
})

test('Settings で TODO をオフにすると、メニューから消えて /todo off が送られる', async ($, on) => {
  const ran: string[] = []
  const store = new Map<string, unknown>()
  on('command.run', (_, e) => (ran.push(`${(e as { command: string }).command} ${(e as { args?: string }).args ?? ''}`.trim()), { value: { text: 'ok' } }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e as never)
    return <Text>engine</Text>
  })
  const props = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } as never
  const paneProps = { title: 'Settings', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const
  let band = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'AbovePrompt', props, viewport: { columns: 120, rows: 30 } })
  await band.press({ key: 'status' })
  await band.press({ key: 'settings' })
  const pane = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'Pane', requestId: 'status-settings', props: paneProps, viewport: { columns: 90, rows: 40 } })
  await pane.press({ key: 'feature-todo' })
  await pane.press({ key: 'feature-commands' })
  expect(ran).toEqual(['todo off'])
  await pane.unmount()
  await band.unmount()
  band = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'AbovePrompt', props, viewport: { columns: 120, rows: 30 } })
  await band.press({ key: 'status' })
  expect(await band.find({ type: 'Button', key: 'todo' })).toBeUndefined()
  expect(await band.find({ type: 'Button', key: 'notify' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'commands' })).toBeUndefined()
  await band.unmount()
})

test('打ったコマンドは「最近使ったコマンド」に出る', async ($, on) => {
  const store = new Map<string, unknown>()
  on('command.run', () => ({ value: { text: 'ok' } }))
  on('command.list', () => ({ value: [{ name: 'compact', description: 'Compact', source: 'builtin', isFullscreen: false }] }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'compact\t会話を要約する', usage: {} } }))
  await $.command.run({ command: 'compact', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  expect(store.get('recent')).toEqual(['compact'])
  await $.command.run({ command: 's', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)
  const band = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } as never, viewport: { columns: 120, rows: 30 } })
  await band.press({ key: 'commands' })
  const pane = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'Pane', requestId: 'status-commands', props: { title: 'x', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const, viewport: { columns: 90, rows: 40 } })
  expect(await pane.find({ type: 'Button', key: 'recent-use-compact' })).toBeDefined()
  await pane.unmount()
  await band.unmount()
})

test('v2 の一覧を持っている人には、goal・background・codex:review が rewind の後ろに足される', () => {
  const v2 = { version: 2, isHidden: false, commands: [{ name: 'rewind', desc: 'x', isFavorite: false }, { name: 'mine', desc: '自分の', isFavorite: true }] }
  expect(migrate(v2).commands?.map(c => c.name)).toEqual(['rewind', 'goal', 'background', 'codex:review', 'mine'])
})

test('翻訳の返事を読み取る（日本語の行だけ）', () => {
  expect(parseTranslations('init\tCLAUDE.md を作る\n/review｜レビューする\nfoo\tbar')).toEqual({ init: 'CLAUDE.md を作る', review: 'レビューする' })
})

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120 } as never
const PANE_PROPS = { title: 'Slash commands', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

const setup = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  const ran: string[] = []
  const filled: string[] = []
  const store = new Map<string, unknown>()
  on('command.run', (_, e) => (ran.push((e as { command: string }).command), { value: { text: 'ok' } }))
  // ほかの人の環境を想定：組み込みのコマンドだけで、使う人のスキル（todo-sync など）は無い
  const builtin = ['clear', 'compact', 'init', 'help', 'model', 'memory', 'plan', 'usage', 'resume', 'rewind', 'todo', 'baton', 'meter']
  on('command.list', () => ({
    value: [...builtin.map(name => ({ name, description: name, source: 'builtin', isFullscreen: false })), { name: 'doctor', description: 'Diagnose your installation', source: 'builtin', isFullscreen: false }],
  }))
  on('prompt.fill', (_, e) => (filled.push((e as { text: string }).text), { isFilled: true }))
  on('store.get', (_, e) => ({ value: store.get((e as { key: string }).key) }))
  on('store.set', (_, e) => (store.set((e as { key: string }).key, (e as { value: unknown }).value), { value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: 'doctor\t環境を診断する\nreview\tコードを見てもらう', usage: {} } }))
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e as never)
    return <Text>engine</Text>
  })
  return { ran, filled, store }
}

test('Status メニューと、お気に入りのコマンドがチャット欄に入る（全サーフェス）', async ($, on) => {
  const { ran, filled } = setup(on)
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    ran.length = 0
    filled.length = 0
    const band = await $.ui.mount({ plugin: 'status', surface, component: 'AbovePrompt', props: PROPS, viewport: { columns: 120, rows: 30 } })
    expect(await band.find({ type: 'Button', key: 'todo' })).toBeUndefined()
    await band.press({ key: 'status' })
    await band.press({ key: 'notify' })
    expect(ran).toEqual(['baton'])
    await band.press({ key: 'fav-compact' })
    expect(filled).toEqual(['/compact '])
    await band.unmount()
  }
})

test('一覧で ★ を付けるとバーに出て、＋で追加でき、Hide bar で消える', async ($, on) => {
  const { store } = setup(on)
  let band = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'AbovePrompt', props: PROPS, viewport: { columns: 120, rows: 30 } })
  await band.press({ key: 'commands' })
  const pane = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'Pane', requestId: 'status-commands', props: PANE_PROPS, viewport: { columns: 90, rows: 40 } })
  expect(await pane.find({ type: 'Button', key: 'use-todo-sync' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'use-compact' })).toBeDefined()
  await pane.press({ key: 'star-model' })
  await pane.press({ key: 'add-doctor' })
  await pane.input({ key: 'add', text: '/review 変更を見てもらう' })
  const saved = store.get('prefs') as { commands: { name: string; isFavorite: boolean }[] }
  expect(saved.commands.find(c => c.name === 'model')?.isFavorite).toBe(true)
  expect(saved.commands.find(c => c.name === 'doctor')).toMatchObject({ desc: '環境を診断する' })
  expect(saved.commands.map(c => c.name)).toContain('review')
  await pane.unmount()
  await band.unmount()
  band = await $.ui.mount({ plugin: 'status', surface: 'desktop', component: 'AbovePrompt', props: PROPS, viewport: { columns: 120, rows: 30 } })
  expect(await band.find({ type: 'Button', key: 'fav-model' })).toBeDefined()
  await band.press({ key: 'status' })
  await band.press({ key: 'hide' })
  expect((store.get('prefs') as { isHidden: boolean }).isHidden).toBe(true)
  await band.unmount()
})
