import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FeatureKey, Prefs, SlashCommand } from '../types'

const MENU_PANE = 'status-menu'
const COMMANDS_PANE = 'status-commands'
const SETTINGS_PANE = 'status-settings'
const STORE_KEY = 'prefs'

// 日本語の入門記事5本（WEEL・paiza・vegcale・リベシティ2本）で多く挙がったものから、非エンジニア向けを上に。
// 開発者向けの /review・/diff は外した。下の4つは同梱の mod（todo-sync はスキル。無い環境では一覧に出ない）
export const DEFAULT_COMMANDS: SlashCommand[] = [
  { name: 'clear', desc: '会話をリセット', isFavorite: false },
  { name: 'compact', desc: '会話を要約して軽く', isFavorite: true },
  { name: 'init', desc: '説明書を自動で作る', isFavorite: false },
  { name: 'help', desc: 'コマンド一覧を見る', isFavorite: false },
  { name: 'model', desc: 'AIを切り替える', isFavorite: false },
  { name: 'memory', desc: '覚えることを編集', isFavorite: false },
  { name: 'plan', desc: '先に進め方を相談', isFavorite: false },
  { name: 'usage', desc: '使用量を見る', isFavorite: false },
  { name: 'resume', desc: '前の会話を再開', isFavorite: false },
  { name: 'rewind', desc: '少し前に戻す', isFavorite: false },
  { name: 'todo', desc: 'TODO一覧を開く', isFavorite: true },
  { name: 'todo-sync', desc: 'TODOを集めて整理', isFavorite: false },
  { name: 'baton', desc: '通知の設定', isFavorite: false },
  { name: 'meter', desc: '使用率と料金', isFavorite: false },
]

// 以前のおすすめ（v1）。v2 に入れ替えるとき、使う人が自分で足したものと★だけ引き継ぐ
const V1_NAMES = ['todo', 'compact', 'clear', 'baton', 'meter', 'context', 'usage', 'model', 'todo-sync', 'code-review']
const PREFS_VERSION = 2

export const migrate = (stored: Partial<Prefs> & { version?: number }): Partial<Prefs> & { version: number } => {
  // おすすめの説明は、いつも最新の（短い）文言にそろえる
  const fresh = new Map(DEFAULT_COMMANDS.map(c => [c.name, c.desc]))
  const syncDesc = (list: SlashCommand[]) => list.map(c => (fresh.has(c.name) ? { ...c, desc: fresh.get(c.name) ?? c.desc } : c))
  if ((stored.version ?? 1) >= PREFS_VERSION || !stored.commands) return { ...stored, ...(stored.commands ? { commands: syncDesc(stored.commands) } : {}), version: PREFS_VERSION }
  const favorites = new Set(stored.commands.filter(c => c.isFavorite).map(c => c.name))
  const defaults = new Set(DEFAULT_COMMANDS.map(c => c.name))
  const mine = stored.commands.filter(c => !V1_NAMES.includes(c.name) && !defaults.has(c.name))
  const commands = [...DEFAULT_COMMANDS.map(c => ({ ...c, isFavorite: favorites.has(c.name) || (c.isFavorite && !stored.commands) })), ...mine]
  return { ...stored, commands, version: PREFS_VERSION }
}

const DEFAULT_FEATURES: Record<FeatureKey, boolean> = { todo: true, notify: true, usage: true, commands: true }

const DEFAULT_PREFS: Prefs = { isHidden: false, commands: DEFAULT_COMMANDS, features: DEFAULT_FEATURES }

// Settings で選べる機能。オフにすると、その mod 自身にも /〇〇 off を送って表示や通知ごと止める
export const FEATURES: { key: FeatureKey; label: string; desc: string; command?: string }[] = [
  { key: 'todo', label: 'TODO', desc: 'TODO の一覧・Today・右下の件数', command: 'todo' },
  { key: 'notify', label: 'Notifications', desc: '作業完了・質問・許可待ちの Mac 通知', command: 'baton' },
  { key: 'usage', label: 'Usage display', desc: '右下の 5h・7d・料金の表示', command: 'meter' },
  { key: 'commands', label: 'Slash commands', desc: 'バー右側の ★ と / のコマンド一覧' },
]

const isOpen = atom({ plugin: 'status', key: 'isOpen' } as const, false)
const prefs = atom({ plugin: 'status', key: 'prefs' } as const, DEFAULT_PREFS)
const candidates = atom({ plugin: 'status', key: 'candidates' } as const, [] as { name: string; desc: string }[])
// その人の環境に実際にあるコマンド名。空のあいだ（読み込み前）は絞り込まない
const available = atom({ plugin: 'status', key: 'available' } as const, [] as string[])
const recent = atom({ plugin: 'status', key: 'recent' } as const, [] as string[])
const RECENT_KEY = 'recent'

// おすすめやお気に入りでも、その人の環境に無いコマンドは出さない（配った先で押して事故らないように）
export const isAvailable = (names: readonly string[], name: string) => names.length === 0 || names.includes(name)

const refreshAvailable = async ($: EngineInterface) => {
  const listed = await $.command.list()
  await update($, available, () => listed.map(c => c.name))
  return listed
}

// 各設定画面は、それぞれの mod のコマンドを呼んで開く（today=/todo・baton-notify=/baton・u=/meter）
const MENU: { key: FeatureKey; label: string; command: string; hotkey: string }[] = [
  { key: 'todo', label: 'TODO', command: 'todo', hotkey: '1' },
  { key: 'notify', label: 'Notifications', command: 'baton', hotkey: '2' },
  { key: 'usage', label: 'Usage display', command: 'meter', hotkey: '3' },
]

// 設定は全セッション共通（$.store）。別のセッションで変えても効くよう、開くたびに読み直す
const load = async ($: EngineInterface) => {
  const stored = (await $.store.get(STORE_KEY)) as (Partial<Prefs> & { version?: number }) | undefined
  const merged = { ...DEFAULT_PREFS, ...(stored ? migrate(stored) : {}) }
  const fresh = { ...merged, features: { ...DEFAULT_FEATURES, ...merged.features } }
  await update($, prefs, () => fresh)
  return fresh
}

const save = async ($: EngineInterface, change: (p: Prefs) => Prefs) => {
  const next = change(await load($))
  await $.store.set(STORE_KEY, next)
  await update($, prefs, () => next)
}

// チャット欄に「/コマンド 」を入れるだけ。送信は本人が Enter で
const fillPrompt = async ($: EngineInterface, name: string) => {
  try {
    await $.prompt.fill({ text: `/${name} `, mode: 'replace' })
  } catch (err) {
    $.ui.toast(`チャット欄に入れられませんでした：${String(err).slice(0, 80)}`)
  }
}

// ほかの mod の画面をコマンドで開く。開けなかったときは理由をトーストで出し、チャット欄にコマンドを入れておく
const runCommand = async ($: EngineInterface, command: string) => {
  await update($, isOpen, () => false)
  try {
    const result = await $.command.run({ command })
    const text = (result as { text?: string } | undefined)?.text
    if (text) $.ui.toast(text)
  } catch (err) {
    $.ui.toast(`/${command} を開けませんでした：${String(err).slice(0, 80)}。チャット欄に入れたので Enter で開いてください`)
    await fillPrompt($, command)
  }
}

// 説明は日本語で出す。英語の説明は haiku でまとめて訳し、$.store に貯めて次からは使い回す
// v2：説明を短く（12文字以内）にしたので、前の長い訳は使わず訳し直す
const JA_KEY = 'ja2'
const hasJapanese = (text: string) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(text)

export const parseTranslations = (text: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^\/?([\w:.-]+)\s*[\t|｜:：]\s*(.+)$/)
    if (match && hasJapanese(match[2])) out[match[1]] = match[2].trim().slice(0, 16)
  }
  return out
}

const translate = async ($: EngineInterface, list: { name: string; desc: string }[]) => {
  const cache = ((await $.store.get(JA_KEY)) as Record<string, string> | undefined) ?? {}
  const todo = list.filter(c => !cache[c.name] && !hasJapanese(c.desc))
  // 40個ずつ、全部終わるまで続けて訳す（1回に詰め込みすぎると返事が途中で切れるため）
  for (let i = 0; i < todo.length && i < 400; i += 40) {
    const batch = todo.slice(i, i + 40)
    const reply = await $.model.complete({
      model: 'haiku',
      system: 'Claude Code のスラッシュコマンドの説明を、初心者向けのやさしい日本語で、ひと目で分かるように短く言いかえる。1行に「コマンド名<TAB>説明」。説明は12文字以内で「〜する」「〜を見る」の形。専門用語・英語・カッコ書きは使わない。前置きは書かない。',
      prompt: batch.map(c => `${c.name}\t${c.desc}`).join('\n'),
      maxTokens: 3000,
    })
    if (!reply.isAnswered) break
    Object.assign(cache, parseTranslations(reply.text))
    await $.store.set(JA_KEY, cache)
  }
  return cache
}

const withJapanese = (list: { name: string; desc: string }[], cache: Record<string, string>) =>
  list.map(c => (hasJapanese(c.desc) ? c : { ...c, desc: cache[c.name] ?? `${c.desc}（翻訳中…）` }))

const openSettings = async ($: EngineInterface) => {
  await update($, isOpen, () => false)
  await load($)
  await $.ui.open({ id: SETTINGS_PANE, title: 'Settings' })
}

const setFeature = async ($: EngineInterface, key: FeatureKey, isOn: boolean) => {
  await save($, now => ({ ...now, features: { ...now.features, [key]: isOn } }))
  const command = FEATURES.find(f => f.key === key)?.command
  if (!command) return
  try {
    await $.command.run({ command, args: isOn ? 'on' : 'off' })
  } catch {
    $.ui.toast(`/${command} が見つかりませんでした（その mod が読み込まれていません）`)
  }
}

const openCommands = async ($: EngineInterface) => {
  await update($, isOpen, () => false)
  const p = await load($)
  const listed = (await refreshAvailable($)).map(c => ({ name: c.name, desc: c.description }))
  await update($, recent, () => [])
  const savedRecent = ((await $.store.get(RECENT_KEY)) as string[] | undefined) ?? []
  await update($, recent, () => savedRecent)
  const cached = ((await $.store.get(JA_KEY)) as Record<string, string> | undefined) ?? {}
  await update($, candidates, () => withJapanese(listed, cached))
  await $.ui.open({ id: COMMANDS_PANE, title: 'Slash commands' })
  // 訳は裏で進め、届いたら一覧と、英語のまま登録されていたコマンドの説明を書き換える
  void translate($, [...listed, ...p.commands]).then(async cache => {
    await update($, candidates, () => withJapanese(listed, cache))
    if (p.commands.some(c => !hasJapanese(c.desc) && cache[c.name])) {
      await save($, now => ({ ...now, commands: now.commands.map(c => (!hasJapanese(c.desc) && cache[c.name] ? { ...c, desc: cache[c.name] } : c)) }))
    }
  }).catch(() => undefined)
}

export const parseAdd = (text: string): SlashCommand | null => {
  const match = text.trim().match(/^\/?([\w:.-]+)\s*(.*)$/)
  return match ? { name: match[1], desc: match[2].trim() || '（説明なし）', isFavorite: false } : null
}

const toggleFavorite = (name: string) => (p: Prefs): Prefs => ({
  ...p,
  commands: p.commands.map(c => (c.name === name ? { ...c, isFavorite: !c.isFavorite } : c)),
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 's', description: 'Status メニューを開く（TODO・通知・使用率・コマンド一覧）' })
    await load($)
    // 一覧を開く前に、裏で説明の翻訳を済ませておく（ほかの mod やスキルが読み込み終わるのを少し待ってから一度だけ）
    const stop = $.clock.every(20_000, () => {
      stop()
      void refreshAvailable($)
        .then(listed => translate($, listed.map(c => ({ name: c.name, desc: c.description }))))
        .catch(() => undefined)
    })

    return next(e)
  })

  // 最近使ったコマンドを覚えておく（その人がよく使うものを一覧の上に出すため）
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    if (e.origin?.kind === 'composer' && e.command !== 's') {
      const list = ((await $.store.get(RECENT_KEY)) as string[] | undefined) ?? []
      const nextList = [e.command, ...list.filter(name => name !== e.command)].slice(0, 8)
      await $.store.set(RECENT_KEY, nextList)
      await update($, recent, () => nextList)
    }
    return result
  })

  on('command.run', { command: 's' }, async $ => {
    await load($)
    await $.ui.open({ id: MENU_PANE, title: 'Status' })

    return { text: 'Status メニューを開きました。' }
  })

  // 入力欄の上の帯：左に Status、右にお気に入りのコマンドと「/」
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const p = await read($, prefs)
    if (p.isHidden) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const open = await read($, isOpen)
    const names = await read($, available)
    const favorites = p.features.commands ? p.commands.filter(c => c.isFavorite && isAvailable(names, c.name)) : []
    const menu = MENU.filter(item => p.features[item.key])

    return (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Button key="status" label={open ? 'Status ▾' : 'Status ▸'} plain dimColor={!open} onPress={() => void update($, isOpen, now => !now)} />
          {open &&
            menu.map(item => (
              <Button key={item.key} label={item.label} hotkey={item.hotkey} variant="secondary" onPress={() => void runCommand($, item.command)} />
            ))}
          {open && <Button key="settings" label="Settings" hotkey="9" variant="secondary" onPress={() => void openSettings($)} />}
          {open && (
            <Button
              key="hide"
              label="Hide bar"
              plain
              dimColor
              onPress={async () => {
                await save($, now => ({ ...now, isHidden: true }))
                await update($, isOpen, () => false)
                $.ui.toast('バーを消しました。メニューは /s で開けます')
              }}
            />
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          {favorites.map(c => (
            <Button key={`fav-${c.name}`} label={`/${c.name}`} plain dimColor onPress={() => void fillPrompt($, c.name)} />
          ))}
          {p.features.commands && <Button key="commands" label="/" variant="secondary" onPress={() => void openCommands($)} />}
        </Box>
      </Box>
    )
  })

  // /s で開くメニュー（バーを消しているとき用）
  on('ui.render', { component: 'Pane', requestId: MENU_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const p = await read($, prefs)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {MENU.filter(item => p.features[item.key]).map(item => (
            <Button key={`m-${item.key}`} label={item.label} hotkey={item.hotkey} variant="secondary" onPress={() => void runCommand($, item.command)} />
          ))}
          {p.features.commands && <Button key="m-commands" label="Slash commands" hotkey="4" variant="secondary" onPress={() => void openCommands($)} />}
          <Button key="m-settings" label="Settings" hotkey="9" variant="secondary" onPress={() => void openSettings($)} />
        </Box>
        <Button
          key="m-bar"
          label={p.isHidden ? '入力欄の上のバーを表示する' : '入力欄の上のバーを消す（/s で開く）'}
          hotkey="b"
          variant={p.isHidden ? 'primary' : 'secondary'}
          onPress={() => void save($, now => ({ ...now, isHidden: !now.isHidden }))}
        />
        <Text dimColor>{p.isHidden ? 'いまはバーを消しています。このメニューは /s で開けます。' : 'いまはバーを表示しています。'}</Text>
      </Box>
    )
  })

  // Settings：使わない機能をまるごとオフにする（人に配ったとき、要らないものを消せるように）
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const p = await read($, prefs)

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>使わない機能はオフにすると、メニューからも画面からも消えます。</Text>
        {FEATURES.map(f => (
          <Box key={`f-${f.key}`} flexDirection="row" gap={1}>
            <Button
              key={`feature-${f.key}`}
              label={p.features[f.key] ? 'ON ' : 'OFF'}
              variant={p.features[f.key] ? 'primary' : 'secondary'}
              onPress={() => void setFeature($, f.key, !p.features[f.key])}
            />
            <Text bold>{f.label}</Text>
            <Text dimColor wrap="truncate-end">{f.desc}</Text>
          </Box>
        ))}
        <Button
          key="s-bar"
          label={p.isHidden ? '入力欄の上のバーを表示する' : '入力欄の上のバーを消す（/s で開く）'}
          variant="secondary"
          onPress={() => void save($, now => ({ ...now, isHidden: !now.isHidden }))}
        />
      </Box>
    )
  })

  // コマンド一覧：名前を押すとチャット欄に入る。★でお気に入り（バーの右側にいつも出る）
  on('ui.render', { component: 'Pane', requestId: COMMANDS_PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const p = await read($, prefs)
    const names = await read($, available)
    const shownCommands = p.commands.filter(c => isAvailable(names, c.name))
    const registered = new Set(p.commands.map(c => c.name))
    const all = await read($, candidates)
    const others = all.filter(c => !registered.has(c.name))
    const recentShown = (await read($, recent))
      .filter(name => isAvailable(names, name))
      .map(name => p.commands.find(c => c.name === name) ?? all.find(c => c.name === name) ?? { name, desc: '' })

    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>名前を押すとチャット欄に入ります。★ を付けると入力欄の上にいつも出ます。</Text>
        {recentShown.length > 0 && (
          <Box flexDirection="column">
            <Text bold>最近使ったコマンド</Text>
            {recentShown.map(c => (
              <Box key={`recent-${c.name}`} flexDirection="row" gap={1}>
                <Button key={`recent-use-${c.name}`} label={`/${c.name}`} plain onPress={() => void fillPrompt($, c.name)} />
                <Text dimColor wrap="truncate-end">{c.desc}</Text>
              </Box>
            ))}
          </Box>
        )}
        <Text bold>おすすめ・登録したコマンド</Text>
        <Box flexDirection="column">
          {shownCommands.map(c => (
            <Box key={`row-${c.name}`} flexDirection="row" gap={1}>
              <Button key={`star-${c.name}`} label={c.isFavorite ? '★' : '☆'} plain onPress={() => void save($, toggleFavorite(c.name))} />
              <Button key={`use-${c.name}`} label={`/${c.name}`} plain onPress={() => void fillPrompt($, c.name)} />
              <Text dimColor wrap="truncate-end">{c.desc}</Text>
              <Button key={`del-${c.name}`} label="✕" plain dimColor onPress={() => void save($, now => ({ ...now, commands: now.commands.filter(x => x.name !== c.name) }))} />
            </Box>
          ))}
        </Box>
        <Input
          key="add"
          label="追加する"
          placeholder="/コマンド名 かんたんな説明（例：/init CLAUDE.md を作る）"
          submitLabel="追加"
          onSubmit={value => {
            const added = parseAdd(value)
            if (added) void save($, now => ({ ...now, commands: [...now.commands.filter(x => x.name !== added.name), added] }))
          }}
        />
        {others.length > 0 && (
          <Box flexDirection="column">
            <Text bold>ほかに使えるコマンド（＋で一覧に追加）</Text>
            {others.slice(0, 40).map(c => (
              <Box key={`cand-${c.name}`} flexDirection="row" gap={1}>
                <Button
                  key={`add-${c.name}`}
                  label="＋"
                  plain
                  onPress={() => void save($, now => ({ ...now, commands: [...now.commands, { name: c.name, desc: c.desc.replace('（翻訳中…）', '').slice(0, 40), isFavorite: false }] }))}
                />
                <Text wrap="truncate-end">
                  {`/${c.name} `}
                  <Text dimColor>{c.desc}</Text>
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
