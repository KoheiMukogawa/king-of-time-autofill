# KING OF TIME 勤怠スケジュール申請 自動化 — Codex引き継ぎ資料

## 1. 目的

KING OF TIME の「スケジュール申請」を毎月手作業で1日ずつ行う負担を減らしたい。

利用者ごとに出勤日と勤務時間が異なる。
KING OF TIME 側では初期状態として非出勤日にも勤務パターンが入っているため、
**出勤しない平日を毎回「法定外休日」に変更して申請する作業が最も面倒**。

将来的には、

- 月の出勤日だけ入力
- それ以外の日を自動で休日申請
- 出勤日は固定の勤務パターンを設定
- 最終確認後に申請

まで自動化したい。

---

## 2. 想定する最終UX

架空の例：9月の出勤日が

`2, 10, 18, 26`

の場合、

1. KING OF TIME の月間画面を開く
2. ユーザースクリプト上で出勤日を入力
3. プレビュー表示
4. 非出勤日を順番に処理
5. 出勤日は勤務パターンを設定
6. 最終確認
7. 必要なら申請まで自動化

### 非出勤日の設定内容

- パターン → `--`
- 勤務日種別 → `法定外休日`
- 休暇区分 種別 → `公休`
- 取得単位 → `全日休暇`
- 申請メッセージ → `全休`

---

## 3. 現在までに確認できたこと

### 3.1 KING OF TIME のホスト

`https://s2.ta.kingoftime.jp`

確認時の pathname 例：

`/admin/<環境固有のパス>`

pathname は固定とは限らないので、
URL文字列だけに依存せず DOM ベースでページ判定した方が安全。

---

## 4. 取得済みDOM情報

調査用 Tampermonkey スクリプトは正常動作済み。

### 4.1 パターン

```html
<select
  id="select_schedule_pattern_id"
  name="schedule_pattern_id"
>
```

現在値例：

- `9:00～18:00`
- value: `<環境固有の値>`

選択肢：

| 表示 | value |
|---|---|
| -- | `""` |
| 9:00～18:00 | `<環境固有の値>` |
| 8:00～17:00 | `<環境固有の値>` |
| 8:30～17:30 | `<環境固有の値>` |
| 9:30～18:30 | `<環境固有の値>` |
| 10:00～19:00 | `<環境固有の値>` |

非出勤日にする場合：

```js
document.getElementById("select_schedule_pattern_id").value = "";
```

ただし KING OF TIME 側の JS が change イベントを監視している可能性があるため、
`input` / `change` を bubbles:true で発火させる。

---

### 4.2 勤務日種別

```html
<select
  id="select_work_day_type_code"
  name="work_day_type_code"
>
```

選択肢：

| 表示 | value |
|---|---|
| -- | `""` |
| 平日 | `1` |
| 法定休日 | `2` |
| 法定外休日 | `3` |

非出勤日：

```js
value = "3";
```

---

### 4.3 休暇区分 種別

```html
<select
  id="leave_type_code1"
  name="leave_type_code1"
>
```

必要な選択肢：

| 表示 | value |
|---|---|
| -- | `""` |
| 有休 | `1_0_1_0` |
| 公休 | `10_0_0_0` |
| 欠勤 | `3_0_0_0` |
| 慶弔休暇 | `15_0_0_0` |
| 振替休日 | `12_0_0_0` |
| 特別休暇 | `14_0_0_0` |
| 産後パパ育休 | `22_0_0_0` |
| 子の看護等休暇 | `17_0_0_0` |
| 養育両立支援休暇 | `26_0_0_0` |
| 介護休暇 | `18_0_0_0` |
| 労災休業（業務） | `24_0_0_0` |

非出勤日：

```js
value = "10_0_0_0";
```

---

### 4.4 休暇区分 取得単位

```html
<select
  id="leave_type_mode1"
  name="leave_type_mode1"
>
```

重要：

**「公休」を選ぶ前は選択肢が `--` しか存在しない。**

したがって、

1. `leave_type_code1 = "10_0_0_0"`
2. `change` 発火
3. KING OF TIME 側が `leave_type_mode1` の option を更新するのを待つ
4. `全日休暇` を選択

という順番が必要。

固定 sleep ではなく MutationObserver または polling で
`全日休暇` が現れるまで待つのが安全。

例：

```js
async function waitForOption(select, text, timeout = 5000) {
  // polling or MutationObserver
}
```

---

### 4.5 申請メッセージ

```html
<input
  id="remark"
  name="remark"
  type="text"
>
```

非出勤日：

```text
全休
```

React/Vue 等の controlled input ではない可能性が高いが、
安全のため native setter + input/change event を使う。

---

### 4.6 スケジュール申請ボタン

確認されたボタン：

```html
<button
  id="button_01"
  type="button"
>
  スケジュール申請
</button>
```

同一画面内に `id="button_01"` が2つ存在していた。

- 上部ボタン
- 下部ボタン

つまり **ID重複がある**。

したがって、

```js
document.querySelectorAll("#button_01")
```

で取得し、
DOM位置や visible 状態、textContent で判定した方が良い。

初期開発では申請ボタンを自動クリックしないこと。

---

## 5. 月間一覧側で確認されたこと

別ページでは以下のような日別ボタンが存在。

例：

```text
button_05_schdule_<環境固有ID><日>
```

表示テキスト：

`スケジュール申請`

他にも同じ日ごとに、

- 打刻申請
- 補助項目申請
- 時間外勤務申請
- 振休申請

等が並んでいる。

月間一覧の自動化時は、
**「スケジュール申請」というテキストだけでなく、その行の日付との関連を取る必要がある。**

おすすめ：

1. 各日付の table row / container を取得
2. 行内の日付文字列を解析
3. 同じ行内の `スケジュール申請` ボタンを取得
4. 日付 → button の Map を作る

ID末尾の連番だけには依存しないこと。

---

## 6. 現在までに作ったもの

### A. DOM調査用ユーザースクリプト

ファイル名：

`KING_OF_TIME_Inspector.user.js`

これは正常に動作した。

取得内容：

- select/input/button
- id
- name
- options
- selected value
- submit button candidates

---

### B. 1日分休日入力テスト版

ファイル名：

`KING_OF_TIME_Holiday_Test.user.js`

想定処理：

```text
パターン       → --
勤務日種別     → 法定外休日
休暇区分       → 公休
取得単位       → 全日休暇
申請メッセージ → 全休
```

申請ボタンは押さない仕様。

---

## 7. 現在の問題

B のテスト版を導入後、ユーザーから

> 「サイトにアクセスできないとなる」

との報告あり。

原因は未特定。

重要：
**調査版は正常に動いていた。**
問題が発生したのは休日入力テスト版導入後。

---

## 8. まずCodexでやるべきこと

### 最優先：休日入力版を最小構成に戻して原因切り分け

いきなり月全体自動化へ進まない。

以下の順で段階的に確認する。

### Step 1

最小 userscript：

```js
// ==UserScript==
// @name KOT minimal
// @match https://s2.ta.kingoftime.jp/*
// @grant none
// ==/UserScript==

(function() {
  console.log("KOT userscript loaded");
})();
```

これだけでサイトが正常に開くか確認。

---

### Step 2

UIを追加せず、
DOM read-only のみ。

```js
console.log(
  document.getElementById("select_schedule_pattern_id")
);
```

---

### Step 3

編集ページでだけ小さなボタンを追加。

**ページ全体で常時処理を走らせない。**

DOM判定：

```js
const isScheduleEditPage =
  document.getElementById("select_schedule_pattern_id") &&
  document.getElementById("select_work_day_type_code") &&
  document.getElementById("leave_type_code1") &&
  document.getElementById("remark");
```

false なら即 return。

---

### Step 4

1項目だけ自動変更。

最初は：

```text
勤務日種別 → 法定外休日
```

のみ。

正常なら順番に追加。

---

### Step 5

`公休` 選択後の `leave_type_mode1` 更新挙動を確認。

MutationObserver を推奨。

---

## 9. 重要な安全要件

勤怠申請なので以下は必須。

### 自動申請は初期版では禁止

フォーム入力だけ行い、
ユーザー本人が内容を確認して
KING OF TIME 純正ボタンを押す。

---

### 月全体処理前にプレビュー

例：

```text
2026年9月

出勤
  9/2
  9/10
  9/18
  9/26

休日化
  9/1
  9/3
  9/4
  ...
```

「休日化：XX日」
「出勤：XX日」

を表示してから開始。

---

### 既存申請の上書きを避ける

可能なら以下はスキップ：

- 申請済み
- 承認済み
- すでに法定外休日
- 有休等の別休暇が設定済み
- 打刻済み

---

### セレクタは value より表示名フォールバックも持つ

会社設定で value が変わる可能性を考慮。

例：

```js
selectOption({
  selector: "#select_work_day_type_code",
  preferredValue: "3",
  text: "法定外休日"
});
```

---

## 10. 推奨アーキテクチャ

Tampermonkey + JavaScript。

理由：

- KING OF TIME に普通にログインした状態で使える
- ID/password を保存不要
- API権限不要
- Selenium/Playwright より導入が軽い
- DOM直接操作なので座標クリックより安定

---

## 11. ページ遷移が必要な場合の状態管理

もし

月間一覧
→ 日別申請画面
→ 申請後一覧へ戻る
→ 次の日

の構造なら、

`sessionStorage`

に状態を持たせる。

例：

```js
{
  month: "2026-09",
  workDays: [2,10,18,26],
  targetDays: [1,2,3,4,5,...],
  currentIndex: 3,
  mode: "preview|running|paused"
}
```

ただし、
**フォーム入力だけで月間画面へ戻らないと次日に進めない設計なら、
自動申請なしでは完全自動巡回できない可能性がある。**

この点はKING OF TIMEの画面遷移を再確認する。

---

## 12. PDFシフト読み取りについて

現段階では不要。

入力件数が多くない場合は、

```text
2,10,18,26
```

のような手入力で十分。

MVP完成後に、

PDF
→ 日付抽出
→ 出勤日入力欄へ反映

を追加する。

---

## 13. MVPの完成条件

まず以下を達成する。

### MVP 1

日別申請ページでボタン1つ押すと、

- パターン：--
- 勤務日種別：法定外休日
- 休暇区分：公休
- 取得単位：全日休暇
- 申請メッセージ：全休

が正しく入る。

**申請ボタンは押さない。**

---

### MVP 2

月間一覧ページで、

- 対象月
- 出勤日
- 非出勤日

を解析しプレビューできる。

---

### MVP 3

出勤日を除外しながら
非出勤日を順番に処理。

---

### MVP 4

必要ならユーザーが明示的にONにした場合のみ
申請ボタンまで自動化。

---

## 14. Codexに最初にお願いしたいこと

> 添付の既存 Tampermonkey スクリプトをレビューし、
> 「休日入力テスト版をONにするとサイトにアクセスできない」という現象の原因候補を特定してください。
>
> まず副作用のない最小 userscript から段階的に機能を戻し、
> KING OF TIME の日別スケジュール申請画面で、
>
> - パターン → --
> - 勤務日種別 → 法定外休日
> - 休暇区分 → 公休
> - 取得単位 → 全日休暇
> - 申請メッセージ → 全休
>
> を自動入力する安全なMVPを作ってください。
>
> 申請ボタンはまだ自動クリックしないでください。
>
> DOM情報はこの引き継ぎ資料に記載済みです。

---

## 15. 補足

この作業は「クリック座標を覚えて押すRPA」より
DOMベースで実装した方が安定する。

特に、

- `leave_type_mode1` の動的 option 更新
- 同一 id `button_01` の重複
- 月間一覧の日付と申請ボタンの紐付け

が実装上の重要ポイント。
