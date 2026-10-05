import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Tier, TodoItem } from '../types'

import { addTask, completeTask, moveTask, parseTodo, returnTask, uncompleteTask } from './parse'

// TODO ファイルの場所は設定（userConfig の todoPath）で変えられる。空なら ~/todo.md
let configuredPath = ''
let TODO_PATH = ''

export const resolvePath = (configured: string, home: string) => {
  const path = configured.trim()
  if (!path) return `${home}/todo.md`
  return path.startsWith('~') ? `${home}${path.slice(1)}` : path
}

// ファイルがまだ無い人には、この見出しのひな形で作る
export const TEMPLATE = ['# TODO', '', '## TODAY', '', '## 🔴 最優先でやりたい', '', '## ⏳ 相手待ち', '', '## 🟡 ちょっと後回し', '', '## ⚪ 余裕がある時', ''].join('\n')

// 場所はホームの位置が分かってから決める（最初に使うときに一度だけ）
const todoPath = async ($: EngineInterface) => {
  if (!TODO_PATH) TODO_PATH = resolvePath(configuredPath, (await $.env.get('HOME')) ?? '')
  return TODO_PATH
}

const readTodo = async ($: EngineInterface) => {
  const path = await todoPath($)
  return (await $.fs.exists(path)) ? String(await $.fs.read(path)) : TEMPLATE
}
const PANE = 'today'
const REFRESH_MS = 60_000

const board = atom({ plugin: 'today', key: 'board' } as const, { items: [], loadedAt: 0, error: null } as Board)
const tab = atom({ plugin: 'today', key: 'tab' } as const, 'today' as Tier)
const flash = atom({ plugin: 'today', key: 'flash' } as const, '')
const showBand = atom({ plugin: 'today', key: 'showBand' } as const, false)

const TIERS: { tier: Tier; mark: string; label: string; hotkey: string }[] = [
  { tier: 'today', mark: 'Today', label: 'Today', hotkey: '0' },
  { tier: 'red', mark: '◎', label: '最優先', hotkey: '1' },
  { tier: 'yellow', mark: '○', label: 'ちょっと後回し', hotkey: '2' },
  { tier: 'white', mark: '△', label: '余裕がある時', hotkey: '3' },
  { tier: 'waiting', mark: '◇', label: '相手待ち', hotkey: '4' },
  { tier: 'done', mark: '✓', label: '完了', hotkey: '5' },
]
const MOVE_TARGETS: Tier[] = ['today', 'red', 'yellow', 'white']
const markOf = (tier: Tier) => TIERS.find(t => t.tier === tier)?.mark ?? ''
const TIER_WORDS = 'today=Today（今日やる）, red=◎最優先, yellow=○ちょっと後回し, white=△余裕がある時'

const countOf = (items: TodoItem[], tier: Tier) => items.filter(item => item.tier === tier).length

const summary = (items: TodoItem[]) =>
  `${countOf(items, 'today')} ｜ ◎${countOf(items, 'red')}`

// 機能ごとオフにできる（Menu の Settings から /todo off）。設定は全セッション共通
const isEnabled = async ($: EngineInterface) => (await $.store.get('enabled')) !== false
const OFF_TEXT = 'TODO の機能はオフになっています。/todo on か、Menu → Settings で戻せます。'

const refresh = async ($: EngineInterface) => {
  if (!(await isEnabled($))) {
    $.ui.status(undefined)
    return
  }
  const loadedAt = await $.clock.now()
  try {
    const items = parseTodo(await readTodo($))
    await update($, board, () => ({ items, loadedAt, error: null }))
    $.ui.status(summary(items))
  } catch (err) {
    await update($, board, prev => ({ ...prev, loadedAt, error: String(err) }))
    $.ui.status('📋 TODO（読み込めませんでした）')
  }
}

// 書き換えの直前に読み直す（ほかのセッションが同時に編集していても、最新に対して変更する）
const edit = async ($: EngineInterface, change: (md: string) => string | null, done: string) => {
  const md = await readTodo($)
  const next = change(md)
  if (next === null) {
    await update($, flash, () => '⚠️ 変更できませんでした（タスクが見つからないか、すでにその段階です）')
    return false
  }
  await $.fs.write(await todoPath($), next)
  await update($, flash, () => done)
  await refresh($)
  return true
}

const today = async ($: EngineInterface) => {
  const d = new Date(await $.clock.now())
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const move = ($: EngineInterface, item: TodoItem, to: Tier) =>
  edit($, md => moveTask(md, item.num, to), `#${item.num} を ${markOf(to)} に移しました`)

const openPane = async ($: EngineInterface, tier?: Tier) => {
  if (tier) await update($, tab, () => tier)
  await refresh($)
  return $.ui.open({ id: PANE, title: 'TODO' })
}

const placedNote = (opened: { isPlaced: boolean; reason?: string }) => (opened.isPlaced ? '' : `（まだ表示されていません：${opened.reason ?? '画面の幅が足りない可能性'}）`)

const isTier = (value: unknown): value is Tier => TIERS.some(t => t.tier === value)

export const register: Register = (on, options) => {
  configuredPath = String(options?.todoPath ?? '')
  TODO_PATH = ''

  on('session.start', async ($, e, next) => {
    await todoPath($)
    const stored = await $.store.get('showBand')
    await $.command.register({ name: 'todo', description: 'TODOの一覧ペインを開く: /todo [today|red|yellow|white|waiting] | on | off | band（入力欄の上の帯を出す/消す）' })
    // 帯を出すかどうかは全セッション共通で覚えておく（既定は出さない）
    await update($, showBand, () => Boolean(stored))
    await $.tool.register({
      name: 'add_task',
      description: `ユーザーの TODO（${TODO_PATH}）に新しいタスクを追加する。「TODO追加」「TodayのTODOに追加」「今日やることに追加」などと言われたら、Edit で todo.md を直接書き換えずにこれを使う。tier: ${TIER_WORDS}。段階の指定が無ければ yellow（新規は🟡に〔未分類〕が既定のルール）。「今日」「Today」と言われたら today。`,
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'タスク名（短く）' },
          project: { type: 'string', description: 'プロジェクト名（仕事・プライベートなど）。分からなければ空' },
          tier: { type: 'string', enum: ['today', 'red', 'yellow', 'white'] },
        },
        required: ['title'],
      },
    })
    await $.tool.register({
      name: 'move_task',
      description: `マスターTODOのタスクを番号（#52 なら "52"）で別の段階に移す。「#52 を今日やる」「#30 を最優先に」「#12 を後回しに」などと言われたら使う。tier: ${TIER_WORDS}。done にすると完了（[x]）にする。back にすると TODAY から元の段階に戻す。`,
      inputSchema: {
        type: 'object',
        properties: {
          num: { type: 'string', description: 'タスク番号（# は付けない）' },
          tier: { type: 'string', enum: ['today', 'red', 'yellow', 'white', 'done', 'back'] },
        },
        required: ['num', 'tier'],
      },
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('tool.call', { tool: 'mcp__today__add_task' }, async ($, e) => {
    if (!(await isEnabled($))) return { text: OFF_TEXT }
    const input = e.input as { title?: string; project?: string; tier?: string }
    const tier: Tier = isTier(input.tier) ? input.tier : 'yellow'
    if (!input.title?.trim()) return { text: 'タスク名が空です。' }
    let added = 0
    const ok = await edit(
      $,
      md => {
        const result = addTask(md, input.title ?? '', input.project ?? '', tier)
        added = result?.num ?? 0
        return result?.md ?? null
      },
      `新しいタスクを ${markOf(tier)} に追加しました`,
    )
    return { text: ok ? `#${added}「${input.title}」を ${markOf(tier)} に追加しました。` : '追加できませんでした。' }
  })

  on('tool.call', { tool: 'mcp__today__move_task' }, async ($, e) => {
    if (!(await isEnabled($))) return { text: OFF_TEXT }
    const { num = '', tier = '' } = e.input as { num?: string; tier?: string }
    const n = num.replace(/^#/, '')
    if (tier === 'done') {
      const date = await today($)
      const ok = await edit($, md => completeTask(md, n, date), `#${n} を完了にしました`)
      return { text: ok ? `#${n} を完了にしました。` : `#${n} が見つかりませんでした。` }
    }
    if (tier === 'back') {
      const ok = await edit($, md => returnTask(md, n), `#${n} を元の段階に戻しました`)
      return { text: ok ? `#${n} を元の段階に戻しました。` : `#${n} は TODAY にありません。` }
    }
    if (!isTier(tier)) return { text: `段階 ${tier} が分かりません。` }
    const ok = await edit($, md => moveTask(md, n, tier), `#${n} を ${markOf(tier)} に移しました`)
    return { text: ok ? `#${n} を ${markOf(tier)} に移しました。` : `#${n} が見つからないか、すでに ${markOf(tier)} にあります。` }
  })

  // 各プロジェクトで作業した後は todo.md が変わっていることがあるので、ターンの終わりにも読み直す
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($)

    return done
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await $.store.set('enabled', arg === 'on')
      await refresh($)
      return { text: arg === 'on' ? 'TODO の機能をオンにしました。' : 'TODO の機能をオフにしました。' }
    }
    if (!(await isEnabled($))) return { text: OFF_TEXT }
    if (arg === 'band') {
      const shown = !(await read($, showBand))
      await update($, showBand, () => shown)
      await $.store.set('showBand', shown)
      return { text: shown ? '入力欄の上に TODO の帯を出しました。' : 'TODO の帯を消しました。' }
    }
    const opened = await openPane($, isTier(arg) ? arg : undefined)

    return { text: `TODOのペインを開きました。${placedNote(opened)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { items, error } = await read($, board)
    if (e.props.hasSurvey || !(await read($, showBand)) || !(await isEnabled($)) || (items.length === 0 && !error)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{error ? '📋 TODO（読み込めませんでした）' : `📋 ${summary(items)}`}</Text>
        <Button key="open" label="一覧を見る" hotkey="t" plain onPress={() => void openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { items, error } = await read($, board)
    const current = await read($, tab)
    const message = await read($, flash)
    const shown = items.filter(item => item.tier === current)
    const info = TIERS.find(t => t.tier === current)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {TIERS.map(t => (
            <Button
              key={`tab-${t.tier}`}
              label={`${t.mark} ${countOf(items, t.tier)}`}
              hotkey={t.hotkey}
              variant={t.tier === current ? 'primary' : 'secondary'}
              onPress={() => void update($, tab, () => t.tier)}
            />
          ))}
          <Button key="reload" label="再読込" hotkey="r" plain onPress={() => void refresh($)} />
        </Box>
        <Text bold>{`${current === 'today' ? 'Today' : `${info?.mark} ${info?.label}`}（${shown.length}件）`}</Text>
        <Text dimColor>
          {current === 'done'
            ? '完了したタスクです。↺ で未完了に戻せます（毎晩の整理で元のプロジェクトにも反映されて消えます）'
            : current === 'today'
              ? '✓ で完了、↩ で元の段階へ。◎ ○ △ でその段階へ移します'
              : '✓ で完了。Today を押すと今日やるへ。◎ ○ △ で段階を変えられます'}
        </Text>
        {message && <Text color="green">{message}</Text>}
        {error && <Text color="red">{`読み込めませんでした: ${error}`}</Text>}
        {shown.length === 0 && !error && (
          <Text dimColor>{current === 'today' ? 'まだありません。ほかのタブで Today を押すと、ここに入ります。' : current === 'done' ? 'まだ完了したタスクはありません。' : 'この段階のタスクはありません。'}</Text>
        )}
        {shown.map(item => (
          <Box key={`row-${item.tier}-${item.num}-${item.title}`} flexDirection="row" gap={1}>
            {item.num && current === 'done' && (
              <Button key={`undo-${item.num}`} label="↺ 戻す" plain onPress={() => void edit($, md => uncompleteTask(md, item.num), `#${item.num} を未完了に戻しました`)} />
            )}
            {item.num && current !== 'done' && (
              <Button key={`done-${item.num}`} label="✓" plain onPress={async () => {
                  const date = await today($)
                  await edit($, md => completeTask(md, item.num, date), `#${item.num} を完了にしました 🎉`)
                }} />
            )}
            {item.num && current === 'today' && (
              <Button key={`back-${item.num}`} label="↩" plain onPress={() => void edit($, md => returnTask(md, item.num), `#${item.num} を元の段階に戻しました`)} />
            )}
            {item.num &&
              current !== 'done' &&
              MOVE_TARGETS.filter(to => to !== current).map(to => (
                <Button key={`mv-${item.num}-${to}`} label={markOf(to)} plain onPress={() => void move($, item, to)} />
              ))}
            <Text wrap="truncate-end">
              <Text color="cyan">{item.num ? `#${item.num} ` : ''}</Text>
              <Text dimColor>{item.project ? `〔${item.project}〕` : ''}</Text>
              {item.title}
              <Text dimColor>{(current === 'today' || current === 'done') && item.from ? ` ←${markOf(item.from)}` : ''}</Text>
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}
