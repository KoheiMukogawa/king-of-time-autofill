# 社内シフトワーカーへの配布 設計

作成日: 2026-08-30
対象: `KING_OF_TIME_Holiday_MVP.user.js` (v0.5.0)

## 1. 目的

現在は作者1人が使っている KING OF TIME 申請ヘルパーを、同じ職場のシフトワーカー
（20人規模、情報系ではない）が自力で導入・利用できる状態にする。

自分1人用のツールと配布用のツールは別物である。配布後はバグ1件が複数人の勤怠申請に
同時に影響するため、本設計では「壊れにくさ」より**「壊れたときに修正を全員へ届けられること」**と
**「初期状態が安全であること」**を優先する。

## 2. 前提（確定済み）

| 項目 | 決定 |
|---|---|
| 利用環境 | 会社支給PC。Chrome/Edge に拡張機能を各自でインストールできる |
| 配布の位置づけ | 有志ベース。会社の公式ツール化やIT部門経由の一括配布は行わない |
| 配布経路 | GitHub パブリックリポジトリ（会社PCから閲覧可）＋ 対面サポート |
| 方式 | 既存の Tampermonkey ユーザースクリプトを維持（案A） |

### 採用しなかった案

- **専用Chrome拡張**: ストア未公開だと「開発者モードで解凍フォルダを読み込む」手順になり、
  Tampermonkey より導入が難しく、Chrome が起動のたびに警告を出す。会社の公式ツールに
  昇格できた場合の将来案として保留。
- **ブックマークレット**: 3,300行規模のツールには非現実的。

## 3. スコープ

### 含む

1. 休憩時間の個人設定化（配布のブロッカー）
2. 自動申請のデフォルトOFF
3. バージョン表示
4. GitHub公開と自動更新の設定
5. 同僚向けの導入手順書

### 含まない（別件）

- xlsx シフト表の取り込み（20人表から自分の行を抽出）
- 会社の公式ツール化に伴う手続き
- 既存の自動入力ロジック自体の改修

## 4. ブロッカー：休憩時間のハードコード

`WORK.breakStart` / `WORK.breakEnd` が 12:00〜13:00 で固定されている。

現在の挙動は「誤った休憩を黙って入れる」ではなく、`fillWorkForm` が勤務時間に
12:00〜13:00 が含まれない場合に例外を投げて停止する
（`KING_OF_TIME_Holiday_MVP.user.js:404` 付近）。`verifyWorkResult` にも
12:00/13:00 を前提とした検証がある。

したがって 9:00〜13:00 のような短時間勤務者はツールを使えない。配布の前提条件として解消する。

なお `OBSERVED_WORK_PATTERNS` の勤務パターン一覧、ホスト名、申請メッセージ
（`よろしくお願いいたします。` / `全休`）は会社共通の値であり、変更しない。

## 5. 設計

### 5.1 個人設定

`localStorage` にキー `kot-user-settings-v1` で保存する。sessionStorage ではなく
localStorage を使うのは、設定がブラウザセッションをまたいで永続する必要があるため
（既存の実行状態 `kot-workday-runner-v1` などは sessionStorage のままでよい）。

```
{
  version: 1,
  breakEnabled: boolean,
  breakStart: { hour: number, minute: number },
  breakEnd:   { hour: number, minute: number },
  autoSubmitEnabled: boolean
}
```

- 月間画面のパネル内に「設定」セクションを追加する
- 未設定の場合は、他の操作より先に設定を促す
- `WORK.breakStart` / `WORK.breakEnd` は定数参照をやめ、この設定から解決する
- エラーメッセージは設定値を埋め込んだ文言にする
  （「休憩開始を12:00に…」→「休憩開始を{設定値}に…」）
- 保存済み設定が壊れている場合は既定値へフォールバックし、設定を促す
  （既存の `validateStoredPlan` と同じ方針）

休憩に関する挙動を次のとおり確定する:

- `breakEnabled: false` のとき、休憩開始・終了の入力欄には何も入力せず、
  `verifyWorkResult` の休憩検証もスキップする
- `breakEnabled: true` で、その日の勤務時間が設定した休憩時間を含まない場合は、
  従来どおりエラーで停止する（誤った申請を送るより止まる方を選ぶ）

### 5.2 自動申請のデフォルトOFF

`autoSubmitEnabled` の既定値は `false`。false の間は連続申請ランナーの起動ボタン自体を
描画しない（無効化ではなく非表示）。設定UIで明示的にONにしたときのみ表示する。

ONにした後の既存の安全策は変更せず維持する:

- 「`申請する`」と手入力させる確認プロンプト
- 申請済み・打刻済みの行のスキップ
- 進行表示からの停止

### 5.3 バージョン表示

`SCRIPT_VERSION` 定数を定義し、各パネルのタイトルに表示する。`GM_info` には依存しない
（`@grant none` 構成を維持するため）。`@version` メタデータと `SCRIPT_VERSION` が
一致することをテストで強制する。

問い合わせを受けたときに、相手がどの版を使っているかを即座に確認できるようにするのが目的。

### 5.4 GitHub公開と自動更新

`.user.js` に以下を追加する:

```
// @updateURL   https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js
// @downloadURL https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js
```

Tampermonkey は `.user.js` で終わるURLを開くとインストール確認画面を表示するため、
同僚の作業は次の3ステップになる:

1. Chrome ウェブストアで Tampermonkey をインストール
2. README のインストールリンクを開く
3. 「インストール」を押す

配布先リポジトリは `<公開用GitHubアカウント>/king-of-time-autofill`（パブリック）とする。
この2行はリポジトリを作成し、URL が実際に 200 を返すことを確認してから追加する
（誤った URL を指したスクリプトを配ると更新が二度と届かなくなるため）。

更新は main への push で配信される。**`@version` を上げないと配信されない**ため、
リリース手順として README に明記する。

公開範囲の方針: `@match` に `s2.ta.kingoftime.jp` が必要なため勤怠システムの利用は隠せないが、
**README・コミットメッセージ・コード内に会社名、部署名、個人名を書かない**。

**公開前チェック（パブリック化は取り消せないため、リポジトリ作成の前に行う）**:
追跡対象の全ファイルと既存のコミットメッセージを走査し、会社名・部署名・個人名・
社内URL・従業員番号が含まれないことを確認する。`KING_OF_TIME_Codex_Handoff.md` と
`KING_OF_TIME_Batch_Inspector.user.js` は作者用の作業メモ由来のため特に確認する。
見つかった場合は、公開前に該当ファイルを除外するか履歴ごと作り直す。

### 5.5 リポジトリ構成

```
README.md                        同僚向けの入口
  - これは何か / 何をしないか（自動申請は初期状態でOFF）
  - インストールリンクと3ステップ手順
  - 初回設定（休憩時間）の説明
  - 不具合時の連絡先
  - リリース手順（@version を上げる）
docs/INSTALL.md                  スクリーンショット付きの詳細手順
docs/superpowers/specs/          設計文書
KING_OF_TIME_Holiday_MVP.user.js
KING_OF_TIME_Holiday_MVP.test.cjs
KING_OF_TIME_Batch_Inspector.user.js
KING_OF_TIME_Codex_Handoff.md
```

## 6. テスト

純粋関数として切り出し、既存の `__KOT_TEST_API__` 経由で検証する:

- `validateUserSettings` — 不正な時刻・逆転した休憩時刻・壊れた保存値を拒否する
- `resolveBreakForShift` — 設定に基づく休憩の解決。休憩なし設定での挙動を含む
- `SCRIPT_VERSION` と `@version` の一致（既存テストと同様にソースを正規表現で検査する）
- `autoSubmitEnabled` の既定値が `false` であること

既存の `node KING_OF_TIME_Holiday_MVP.test.cjs` で実行できる形を維持する。

## 7. 未確認事項（2026-09-06 実機確認で解消）

1. **KING OF TIME で休憩欄を空のまま申請できるか** → **できる**。
   よって 5.1 の `breakEnabled: false`（休憩なし）を設計どおり実装する。
2. **会社PCから `raw.githubusercontent.com` に到達できるか** → **到達できる**。
   よって 5.4 の自動更新（案A）を設計どおり採用する。

## 8. 完了条件

- 休憩時間を各自が設定でき、12:00〜13:00 に勤務しない人もツールを使える
- 新規インストール直後の状態で自動申請が実行されない
- 画面上でバージョンが確認できる
- 同僚が README のリンクから3ステップで導入できる
- 修正を push すると各自の Tampermonkey に自動で届く
- `node KING_OF_TIME_Holiday_MVP.test.cjs` が通る
- 公開前チェック（5.4）を実施し、公開物に会社名・部署名・個人名が含まれない
