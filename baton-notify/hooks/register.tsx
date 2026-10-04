import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Settings } from '../types'

const PANE = 'baton-notify'
const STORE_KEY = 'settings'
// 許可の確認は auto モードだと自動判定で一瞬で終わることがある。この時間内に片付いたら通知しない
const PERMISSION_GRACE_MS = 4000

export const SOUNDS = ['Glass', 'Ping', 'Hero', 'Submarine', 'Pop', 'Purr', 'Tink', 'Bottle', 'Blow', 'Frog', 'Funk', 'Morse', 'Sosumi', 'Basso']
const VOLUMES = [0.25, 0.5, 0.75, 1]

export const DEFAULTS: Settings = {
  enabled: true,
  sound: true,
  volume: 0.5,
  soundName: 'Glass',
  speak: false,
  speakDone: '終わったよ',
  speakAsk: '質問が来てるよ',
  notifyPermission: true,
}

type Kind = 'done' | 'ask' | 'plan' | 'permission' | 'error' | 'test'

const HEADLINE: Record<Kind, string> = {
  done: '✅ 作業が終わりました',
  ask: '❓ 質問が来ています',
  plan: '📝 プランの確認待ちです',
  permission: '🔐 許可を待っています',
  error: '⚠️ エラーで止まりました',
  test: '🔔 テスト通知です',
}

const settings = atom({ plugin: 'baton-notify', key: 'settings' } as const, DEFAULTS)
const lastSent = atom({ plugin: 'baton-notify', key: 'lastSent' } as const, '')

// 文字は argv で渡すので、引用符や記号が入っても AppleScript が壊れない
const NOTIFY_SCRIPT = ['on run argv', '  display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)', 'end run']

const short = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

// 設定は全セッション共通（$.store）。別のセッションで /baton off しても効くよう、使うたびに読み直す
const load = async ($: EngineInterface) => {
  const stored = (await $.store.get(STORE_KEY)) as Partial<Settings> | undefined
  const fresh = { ...DEFAULTS, ...stored }
  await update($, settings, () => fresh)
  return fresh
}

const save = async ($: EngineInterface, change: (s: Settings) => Settings) => {
  const next = change(await load($))
  await update($, settings, () => next)
  await $.store.set(STORE_KEY, next)
  return next
}

// どのセッションか：フォルダ名と、最後に頼んだこと
const sessionLabel = async ($: EngineInterface) => {
  const folder = (await $.session.cwd()).split(/[\\/]/).filter(Boolean).pop() ?? ''
  const asked = (await $.session.messages())
    .filter(m => m.role === 'user' && m.text.trim() && !m.text.trim().startsWith('<'))
    .at(-1)?.text
  return { folder, asked: asked ? `「${short(asked, 40)}」` : '' }
}

const playSound = async ($: EngineInterface, s: Settings) => {
  await $.process.run(['afplay', '-v', String(s.volume), `/System/Library/Sounds/${s.soundName}.aiff`], { timeoutMs: 10_000 })
}

const speak = async ($: EngineInterface, text: string) => {
  try {
    await $.audio.speak(text, { voice: 'Kyoko' })
  } catch {
    await $.audio.speak(text)
  }
}

export const notify = async ($: EngineInterface, kind: Kind, detail?: string) => {
  const s = await load($)
  if (!s.enabled && kind !== 'test') return
  const { folder, asked } = await sessionLabel($)
  const body = detail ? short(detail, 80) : asked || 'このセッション'
  const title = `Claude Code｜${folder}`
  await $.process.run(['osascript', ...NOTIFY_SCRIPT.flatMap(line => ['-e', line]), title, HEADLINE[kind], body], { timeoutMs: 10_000 })
  await update($, lastSent, () => `${HEADLINE[kind]}｜${body}`)
  if (s.sound) await playSound($, s)
  if (s.speak) {
    const words = kind === 'done' ? s.speakDone : kind === 'test' ? s.speakDone : s.speakAsk
    if (words.trim()) await speak($, `${folder}、${words}`)
  }
}

const placedNote = (opened: { isPlaced: boolean; reason?: string }) => (opened.isPlaced ? '' : `（まだ表示されていません：${opened.reason ?? '画面の幅が足りない可能性'}）`)

const openPane = async ($: EngineInterface) => {
  await load($)
  return $.ui.open({ id: PANE, title: 'バトン通知の設定' })
}

export const register: Register = on => {
  const pending = new Map<string, () => void>()

  on('session.start', async ($, e, next) => {
    await load($)
    await $.command.register({ name: 'baton', description: 'バトン通知: /baton（設定）| on | off | test' })

    return next(e)
  })

  on('command.run', { command: 'baton' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      await save($, s => ({ ...s, enabled: arg === 'on' }))
      return { text: `バトン通知を${arg === 'on' ? 'オン' : 'オフ'}にしました。` }
    }
    if (arg === 'test') {
      await notify($, 'test')
      return { text: 'テスト通知を送りました。' }
    }
    const opened = await openPane($)
    return { text: `バトン通知の設定を開きました。${placedNote(opened)}` }
  })

  // メインの会話のターンが終わった＝バトンがこちらに戻った。サブエージェントのターンは数えない
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      if (e.reason === 'answer') void notify($, 'done')
      if (e.reason === 'error' || e.reason === 'refusal') void notify($, 'error')
    }
    return result
  })

  // 選択肢の質問とプランの承認は、答えるまでツールが止まるので、呼ばれた時点で知らせる
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e, next) => {
    const questions = (e.input as { questions?: { question?: string }[] })?.questions ?? []
    void notify($, 'ask', questions[0]?.question)
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, ($, e, next) => {
    void notify($, 'plan')
    return next(e)
  })

  // 許可の確認：少し待っても片付かなければ通知する
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    const id = e.tool_use_id
    if (verdict.decision === 'ask' && id && (await load($)).notifyPermission) {
      const stop = $.clock.every(PERMISSION_GRACE_MS, () => {
        stop()
        pending.delete(id)
        void notify($, 'permission', `${e.tool} を使ってよいか確認しています`)
      })
      pending.set(id, stop)
    }
    return verdict
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const id = e.tool_use_id
    if (id && pending.has(id)) {
      pending.get(id)?.()
      pending.delete(id)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const s = await read($, settings)
    const sent = await read($, lastSent)
    const toggle = (key: 'enabled' | 'sound' | 'speak' | 'notifyPermission') => () => void save($, now => ({ ...now, [key]: !now[key] }))
    const onOff = (flag: boolean) => (flag ? 'ON' : 'OFF')

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="enabled" label={`通知：${onOff(s.enabled)}`} hotkey="o" variant={s.enabled ? 'primary' : 'secondary'} onPress={toggle('enabled')} />
          <Button key="permission" label={`許可待ちも通知：${onOff(s.notifyPermission)}`} hotkey="p" variant={s.notifyPermission ? 'primary' : 'secondary'} onPress={toggle('notifyPermission')} />
          <Button key="test" label="テスト通知" hotkey="t" plain onPress={() => void notify($, 'test')} />
        </Box>

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Button key="sound" label={`音：${onOff(s.sound)}`} hotkey="s" variant={s.sound ? 'primary' : 'secondary'} onPress={toggle('sound')} />
            <Text dimColor>音量</Text>
            {VOLUMES.map(v => (
              <Button
                key={`vol-${v * 100}`}
                label={`${v * 100}%`}
                variant={s.volume === v ? 'primary' : 'secondary'}
                onPress={async () => playSound($, await save($, now => ({ ...now, volume: v })))}
              />
            ))}
          </Box>
          <Text dimColor>音の種類（押すと試聴できます）</Text>
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            {SOUNDS.map(name => (
              <Button
                key={`snd-${name}`}
                label={name}
                variant={s.soundName === name ? 'primary' : 'secondary'}
                onPress={async () => playSound($, await save($, now => ({ ...now, soundName: name })))}
              />
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          <Button key="speak" label={`読み上げ：${onOff(s.speak)}`} hotkey="v" variant={s.speak ? 'primary' : 'secondary'} onPress={toggle('speak')} />
          <Input key="speakDone" label="完了のときの一言" value={s.speakDone} submitLabel="保存" onSubmit={value => void save($, now => ({ ...now, speakDone: value }))} />
          <Input key="speakAsk" label="質問・許可待ちのときの一言" value={s.speakAsk} submitLabel="保存" onSubmit={value => void save($, now => ({ ...now, speakAsk: value }))} />
          <Text dimColor>読み上げは「フォルダ名、一言」の形でしゃべります。</Text>
        </Box>

        {sent && <Text dimColor>{`最後の通知：${sent}`}</Text>}
        <Text dimColor>/baton on・/baton off ですぐ切り替えられます。設定は全セッション共通です。</Text>
      </Box>
    )
  })
}
