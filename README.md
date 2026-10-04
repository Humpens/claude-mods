# claude-mods

非エンジニアでも使いやすい、Claude Code の mod（画面に機能を足すプラグイン）集です。
デスクトップアプリの Code タブでも、ターミナル（Cursor・VS Code など）でも動きます。

| mod | できること | コマンド |
|---|---|---|
| **status** | 入力欄の上に `Status ▸` メニュー。各機能の設定、使わない機能のオフ、よく使うスラッシュコマンドの ★ と一覧（説明は日本語） | `/s` |
| **today** | TODO を Today・◎最優先・○後回し・△余裕がある時・◇相手待ちで管理。右下に今日の件数。一覧の画面からボタンで移動・完了。チャットで「TODO追加」「#12 を今日やる」とも言える | `/todo` |
| **baton-notify** | 作業が終わった・質問が来た・許可を待っているときに Mac の通知で知らせる。どのセッションかも分かる。音・音量・音の種類・読み上げを設定できる | `/baton` |
| **u** | 右下に `5h 13% · 7d 20% · $9.53`（5時間・週の使用率と API 換算の料金）。何を出すか選べる | `/meter` |

## 入れ方

Claude Code の中で次の2つを打ちます。

```
/plugin marketplace add Humpens/claude-mods
/plugin install status@claude-mods
```

ほかの mod も同じように `today@claude-mods`・`baton-notify@claude-mods`・`u@claude-mods` で入れられます。
入れたあとは、新しいセッションを始めると使えます。

## 使い方のこつ

- まずは入力欄の上の **Status ▸** を押してください。全部の機能にここから行けます。
- 使わない機能は **Status → Settings** でオフにすると、画面からも消えます。
- TODO は、朝に ◎ から3〜5個を **Today** に移して、その日のうちに右下の数字を 0 にするのがおすすめです。

## 設定

| mod | 設定 | 内容 |
|---|---|---|
| today | `todoPath` | 使う TODO ファイルの場所。空なら `~/todo.md`（無ければ最初に書き込むときに作ります） |

`/config` か、`~/.claude/settings.json` の `pluginConfigs` で変えられます。

```json
"pluginConfigs": {
  "today": { "options": { "todoPath": "~/Documents/todo.md" } }
}
```

## 注意

- **baton-notify の通知と音は macOS 専用**です（`osascript` と `afplay` を使います）。読み上げは Claude Code 本体の機能なので Windows でも動きます。
- **status** は、スラッシュコマンドの英語の説明を日本語にするとき、Claude の軽いモデル（haiku）を使います。訳は一度だけで、あとは保存して使い回します。
- **today** は、指定した TODO ファイル（Markdown）だけを読み書きします。
- どの mod も、外部のサーバーにデータを送りません。
- Claude Code の通常のチャット（claude.ai）では動きません。Claude Code の画面専用です。

## 中身を確かめる

```
claude plugin validate ./status
claude plugin test ./status
```

`validate` で、その mod が使う機能（ファイル・コマンド実行・モデル呼び出しなど）が全部一覧で出ます。

## ライセンス

MIT（Claude Code Club）
