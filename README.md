# recent-sessions

Claude Code デスクトップアプリ用の mod です。チャット横のパネルに、他のセッションを最終活動順で一覧します（「最近の使用」）。

- 最大20件を最終活動順に取得し、パネルの高さに収まる件数だけ表示します。30秒ごとに自動更新します。
- 先頭の行は「最近の使用 · N 件」と、最後に取得できた時刻（「更新 HH:MM」）です。
- 各セッションは2行で、1行目がタイトルのボタン（パネル幅に収まらない分は「…」で省略）、2行目が薄字の「フォルダ名 · 経過時間」です。実行中のセッションは先頭に緑の `●` が付きます。
- 一覧を取得できなかったときは、前回の一覧を残したまま「一覧を更新できません（再試行中）」と理由を出し、3秒・5秒・10秒後、以後30秒ごとに取り直します。
- タイトルを押すと、そのセッションの `claude://` リンクを OS に渡して開きます（Windows の `rundll32 url.dll,FileProtocolHandler` を使用）。
- `/recent-sessions` でパネルを開き直せます。

セッション一覧はデスクトップアプリが提供する `ccd_session_mgmt` MCP サーバーの `list_sessions` から取得します。そのため、動作するのはデスクトップアプリの Code タブで開いたセッションです。

## インストール

ターミナルのセッションのプロンプトで:

```
/plugin install recent-sessions --marketplace Nunifuchisaka/recent-sessions
```

`Add marketplace?` に `y` と答え、続けてスコープ（通常は user）を選びます。

シェルから:

```
claude plugin install recent-sessions --marketplace Nunifuchisaka/recent-sessions
```

デスクトップアプリ（`/plugin` が使えない場合）: プロンプト欄の横の「+」から「Plugins」を開き、「Add marketplace」に `Nunifuchisaka/recent-sessions` を入れてから「Add plugin」で追加します。

## 開発

フォルダから直接読み込むには `claude --plugin-dir <このフォルダ>`、または `~/.claude/settings.json` の `env.CLAUDE_CODE_PLUGIN_DIRS` にこのフォルダを指定します。

```
claude plugin validate .
claude plugin test .
npx -y -p typescript@5 tsc -p .
```

型チェックは、mod が一度読み込まれて `.claude-plugin/types/` が生成された後に通ります。

## 既知の制限

- デスクトップ画面は `claude://` の `Link` を素の文字に落とすため、行はボタンにして OS 経由で開いています。
- Windows 以外の OS では、リンクを開く処理（`rundll32`）が動きません。
