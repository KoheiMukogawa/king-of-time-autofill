# 同僚への配布 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作者1人用の KING OF TIME 申請ヘルパーを、休憩時間を各自で設定でき、初期状態が安全で、修正を全員へ届けられる配布物にする。

**Architecture:** 単一の Tampermonkey ユーザースクリプトを維持したまま、(1) ハードコードされた休憩時間 12:00〜13:00 を `localStorage` の個人設定から解決する純粋関数へ置き換え、(2) 自動申請を既定 OFF にして起動ボタン自体を非表示にし、(3) GitHub パブリックリポジトリの raw URL を `@updateURL`/`@downloadURL` に指定して push で更新を配信する。

**Tech Stack:** 素の JavaScript（ブラウザ、`@grant none`）／ Node.js `node:vm` + `node:assert` による単一ファイルのテスト（依存パッケージなし）／ Tampermonkey ／ GitHub + `gh` CLI

**Spec:** `docs/superpowers/specs/2026-08-30-distribution-design.md`

## Global Constraints

- ユーザースクリプトは単一ファイル `KING_OF_TIME_Holiday_MVP.user.js` のまま。ビルド手順・依存パッケージを追加しない。
- `// @grant none` を維持する。`GM_info` / `GM_setValue` などの GM API を使わない。
- 変更してはならない会社共通の値: `OBSERVED_WORK_PATTERNS` の勤務パターン一覧、`@match` の `https://s2.ta.kingoftime.jp/*`、`WORK.remark` の `よろしくお願いいたします。`、`HOLIDAY.remark` / `BATCH.holidayRemark` の `全休`。
- 個人設定の保存先は `localStorage`、キーは `kot-user-settings-v1`。既存の `sessionStorage` キー（`kot-schedule-helper-plan-v1`、`kot-workday-runner-v1`、`kot-cancellation-run-v1`、`kot-cancellation-proof-v1`）は保存先もキー名も変更しない。
- テストは `node KING_OF_TIME_Holiday_MVP.test.cjs` の1コマンドで実行できる形を維持する。
- **公開物（README・docs・コミットメッセージ・コード・スクリーンショット）に会社名、部署名、個人名、社内URL、従業員番号を書かない。**
- UI 文言はすべて日本語。情報系でない同僚が読む前提で、専門用語を避ける。

---

### Task 1: バージョン表示

問い合わせを受けたときに相手がどの版を使っているか即座に分かるようにする。`@version` メタデータと画面表示がずれると用をなさないため、一致をテストで強制する。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js:2`（`@name` の `（MVP 5）` を削除）, `:12` 付近（定数追加）, `:489`, `:1203`, `:1937`, `:2215`, `:2766`, `:2959`（各パネルのタイトル）
- Test: `KING_OF_TIME_Holiday_MVP.test.cjs`

**Interfaces:**
- Consumes: なし
- Produces: `SCRIPT_VERSION`（`string`、`@version` と同じ値）。以降のタスクは参照しないが、Task 9 で `@version` とともに更新する。

- [ ] **Step 1: バージョン一致の失敗するテストを書く**

`KING_OF_TIME_Holiday_MVP.test.cjs` の `assert.match(source, /const AUTO_SUBMIT_COUNTDOWN_SECONDS = 1;/);` の直後に追加する:

```js
const versionMeta = source.match(/^\/\/ @version\s+(\S+)\s*$/m);
assert.ok(versionMeta, '@version メタデータが見つかりません。');
const versionConstant = source.match(/^ {2}const SCRIPT_VERSION = '([^']+)';$/m);
assert.ok(versionConstant, 'SCRIPT_VERSION 定数が見つかりません。');
assert.equal(
  versionConstant[1],
  versionMeta[1],
  '@version と SCRIPT_VERSION が一致しません。両方を同時に更新してください。',
);
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: FAIL — `SCRIPT_VERSION 定数が見つかりません。`

- [ ] **Step 3: `SCRIPT_VERSION` を定義する**

`KING_OF_TIME_Holiday_MVP.user.js` の `'use strict';` の次の行、`const DAILY_UI_ID = 'kot-holiday-helper';` の直前に挿入する:

```js
  const SCRIPT_VERSION = '0.5.0';
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 5: 各パネルのタイトルにバージョンを表示する**

次の6箇所を書き換える。いずれも `title.textContent = '...';` の1行置換:

| 現在の値 | 置換後 |
|---|---|
| `'KOT 日別スケジュール入力ヘルパー'` | `` `KOT 日別スケジュール入力ヘルパー v${SCRIPT_VERSION}` `` |
| `'KOT 出勤日連続申請'` | `` `KOT 出勤日連続申請 v${SCRIPT_VERSION}` `` |
| `'KOT 申請取消'` | `` `KOT 申請取消 v${SCRIPT_VERSION}` `` |
| `'KOT 月単位・申請取消'` | `` `KOT 月単位・申請取消 v${SCRIPT_VERSION}` `` |
| `'KOT 月間一括フォーム入力'` | `` `KOT 月間一括フォーム入力 v${SCRIPT_VERSION}` `` |
| `'KOT 月間スケジュール入力'` | `` `KOT 月間スケジュール入力 v${SCRIPT_VERSION}` `` |

シングルクォートをバッククォートに変えるのを忘れないこと。

- [ ] **Step 6: `@name` から開発中の名残を消す**

配布物のため `（MVP 5）` を落とす。1行置換:

```
// @name         KING OF TIME 月間スケジュール申請ヘルパー
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js KING_OF_TIME_Holiday_MVP.test.cjs
git commit -m "$(cat <<'MSG'
画面にスクリプトのバージョンを表示する

問い合わせ時に利用者がどの版を使っているかを確認できるようにする。
@version と SCRIPT_VERSION のずれはテストで検出する。
MSG
)"
```

---

### Task 2: 個人設定の保存と検証

休憩時間と自動申請の可否を利用者ごとに持つ。壊れた保存値でツールが動かなくなるのを防ぐため、読み込み時に必ず検証する。既存の `validateStoredPlan` と同じ方針。

**未設定と既定値を区別する。** `loadUserSettings()` は未設定・不正のとき `null` を返す。「まだ設定していない人」を検出して設定を促すため（Task 5）、また設定が消えた状態で 12:00〜13:00 を暗黙に使って誤申請するのを防ぐため（Task 4）。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js`（定数ブロックに追記、`validateStoredPlan` の直前に関数を追加）
- Test: `KING_OF_TIME_Holiday_MVP.test.cjs`

**Interfaces:**
- Consumes: なし
- Produces:
  - `USER_SETTINGS_STORAGE_KEY: string` = `'kot-user-settings-v1'`
  - `DEFAULT_USER_SETTINGS`: `{ version: 1, breakEnabled: boolean, breakStart: {hour, minute}, breakEnd: {hour, minute}, autoSubmitEnabled: boolean }`（凍結済み）
  - `toTotalMinutes(time: {hour: number, minute: number}) => number`
  - `validateUserSettings(settings: unknown) => Settings | null` — 正しければ正規化した新しいオブジェクトを返し、不正なら `null`
  - `saveUserSettings(settings) => Settings` — 不正なら throw
  - `loadUserSettings() => Settings | null`

- [ ] **Step 1: テストハーネスに localStorage スタブを追加する**

`KING_OF_TIME_Holiday_MVP.test.cjs` の `const context = {};` を次に置き換える。`loadUserSettings` は `localStorage` と `console.warn` を使うため、vm コンテキストに両方を渡す:

```js
function createStorageStub() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

const localStorageStub = createStorageStub();
const context = { localStorage: localStorageStub, console };
```

- [ ] **Step 2: 新しい関数をテスト用 API に公開する**

同ファイルの `globalThis.__KOT_TEST_API__ = {` のリストに追記する（`confirmationTextMatchesCancellationTarget,` の次の行）:

```js
    DEFAULT_USER_SETTINGS,
    validateUserSettings,
    saveUserSettings,
    loadUserSettings,
```

さらに、ファイル下部の `const { ... } = ` 分割代入にも同じ4つを追加する。

- [ ] **Step 3: 失敗するテストを書く**

`KING_OF_TIME_Holiday_MVP.test.cjs` の末尾の合格メッセージ出力の直前に追加する:

```js
// --- 個人設定 ---
const validSettings = {
  version: 1,
  breakEnabled: true,
  breakStart: { hour: 12, minute: 30 },
  breakEnd: { hour: 13, minute: 30 },
  autoSubmitEnabled: false,
};

assert.equal(DEFAULT_USER_SETTINGS.autoSubmitEnabled, false, '自動申請の既定値は false でなければなりません。');
assert.equal(DEFAULT_USER_SETTINGS.breakEnabled, true);
assert.ok(validateUserSettings(DEFAULT_USER_SETTINGS), '既定値は検証を通らなければなりません。');

assert.deepEqual(validateUserSettings(validSettings), validSettings);

// 余計なキーは落とす
assert.deepEqual(
  validateUserSettings({ ...validSettings, injected: 'x' }),
  validSettings,
);

// 不正な値は null
assert.equal(validateUserSettings(null), null);
assert.equal(validateUserSettings({}), null);
assert.equal(validateUserSettings({ ...validSettings, version: 2 }), null);
assert.equal(validateUserSettings({ ...validSettings, breakEnabled: 'true' }), null);
assert.equal(validateUserSettings({ ...validSettings, autoSubmitEnabled: 1 }), null);
assert.equal(validateUserSettings({ ...validSettings, breakStart: { hour: 24, minute: 0 } }), null);
assert.equal(validateUserSettings({ ...validSettings, breakStart: { hour: 12, minute: 60 } }), null);
assert.equal(validateUserSettings({ ...validSettings, breakStart: { hour: 12.5, minute: 0 } }), null);
assert.equal(validateUserSettings({ ...validSettings, breakEnd: null }), null);

// 休憩の開始と終了が逆転・同一なら拒否する
assert.equal(
  validateUserSettings({ ...validSettings, breakStart: { hour: 14, minute: 0 } }),
  null,
  '休憩開始が終了より後の設定は拒否しなければなりません。',
);
assert.equal(
  validateUserSettings({
    ...validSettings,
    breakStart: { hour: 12, minute: 0 },
    breakEnd: { hour: 12, minute: 0 },
  }),
  null,
  '休憩開始と終了が同じ設定は拒否しなければなりません。',
);

// 休憩なし設定でも休憩時刻自体は妥当でなければならない
assert.ok(validateUserSettings({ ...validSettings, breakEnabled: false }));

// 保存と読み込み
localStorageStub.clear();
assert.equal(loadUserSettings(), null, '未設定のときは null を返さなければなりません。');

saveUserSettings(validSettings);
assert.deepEqual(loadUserSettings(), validSettings);

assert.throws(() => saveUserSettings({ ...validSettings, breakEnd: null }), /不正/);

// 壊れた保存値は null にフォールバックする
localStorageStub.setItem('kot-user-settings-v1', 'not json');
assert.equal(loadUserSettings(), null);
localStorageStub.setItem('kot-user-settings-v1', '{"version":99}');
assert.equal(loadUserSettings(), null);
localStorageStub.clear();
```

同ファイル末尾の合格メッセージも更新する:

```js
console.log('Shift, date, plan, batch-state, runner-state, cancellation, and settings tests passed.');
```

- [ ] **Step 4: テストが失敗することを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: FAIL — `DEFAULT_USER_SETTINGS is not defined`

- [ ] **Step 5: 定数を追加する**

`KING_OF_TIME_Holiday_MVP.user.js` の `const CANCEL_PROOF_STORAGE_KEY = 'kot-cancellation-proof-v1';` の直後に挿入する:

```js
  const USER_SETTINGS_STORAGE_KEY = 'kot-user-settings-v1';
```

さらに `const WORK = Object.freeze({...});` の閉じ括弧の直後に挿入する:

```js
  // 未設定の利用者に押し付ける値ではなく、設定画面の初期表示に使う下敷き。
  // 実際に使う設定は必ず loadUserSettings() から取得する。
  const DEFAULT_USER_SETTINGS = Object.freeze({
    version: 1,
    breakEnabled: true,
    breakStart: Object.freeze({ hour: 12, minute: 0 }),
    breakEnd: Object.freeze({ hour: 13, minute: 0 }),
    autoSubmitEnabled: false,
  });
```

- [ ] **Step 6: 検証と保存の関数を実装する**

`function validateStoredPlan(plan) {` の直前に挿入する:

```js
  function toTotalMinutes(time) {
    return (time.hour * 60) + time.minute;
  }

  function isValidClockTime(time) {
    return Boolean(time)
      && Number.isInteger(time.hour)
      && time.hour >= 0
      && time.hour <= 23
      && Number.isInteger(time.minute)
      && time.minute >= 0
      && time.minute <= 59;
  }

  function validateUserSettings(settings) {
    if (!settings || settings.version !== 1) return null;
    if (typeof settings.breakEnabled !== 'boolean') return null;
    if (typeof settings.autoSubmitEnabled !== 'boolean') return null;
    if (!isValidClockTime(settings.breakStart)) return null;
    if (!isValidClockTime(settings.breakEnd)) return null;
    // 休憩なし設定でも時刻は妥当に保つ。あとで休憩ありへ戻したときに壊れないため。
    if (toTotalMinutes(settings.breakStart) >= toTotalMinutes(settings.breakEnd)) return null;

    return {
      version: 1,
      breakEnabled: settings.breakEnabled,
      breakStart: { hour: settings.breakStart.hour, minute: settings.breakStart.minute },
      breakEnd: { hour: settings.breakEnd.hour, minute: settings.breakEnd.minute },
      autoSubmitEnabled: settings.autoSubmitEnabled,
    };
  }

  function saveUserSettings(settings) {
    const validSettings = validateUserSettings(settings);
    if (!validSettings) throw new Error('保存しようとした設定が不正です。');
    localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(validSettings));
    return validSettings;
  }

  function loadUserSettings() {
    try {
      const rawValue = localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
      return rawValue ? validateUserSettings(JSON.parse(rawValue)) : null;
    } catch (error) {
      console.warn('[KOT申請ヘルパー] 保存した設定を読み込めませんでした。', error);
      return null;
    }
  }
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS — `Shift, date, plan, batch-state, runner-state, cancellation, and settings tests passed.`

- [ ] **Step 8: コミット**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js KING_OF_TIME_Holiday_MVP.test.cjs
git commit -m "$(cat <<'MSG'
休憩時間と自動申請の可否を保持する個人設定を追加する

localStorage に kot-user-settings-v1 として保存する。読み込み時に必ず
検証し、壊れた値や未設定は null を返して呼び出し側に判断させる。
自動申請の既定値は false。
MSG
)"
```

---

### Task 3: 設定から休憩を解決する純粋関数

「その日のシフトに対して、実際にどの休憩を入力するか」を1箇所に集める。DOM に触れないため単体でテストできる。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js`（`function verifyWorkResult` の直前）
- Test: `KING_OF_TIME_Holiday_MVP.test.cjs`

**Interfaces:**
- Consumes: `validateUserSettings` の返す設定オブジェクト（Task 2）、`toTotalMinutes`（Task 2）、既存の `formatShiftTime(time) => string`
- Produces: `resolveBreakForShift(shift, settings)`
  - `shift`: `{ start: {hour, minute, totalMinutes}, end: {hour, minute, totalMinutes}, label: string }`
  - 戻り値: `{ enabled: false }` または `{ enabled: true, start: {hour, minute, totalMinutes}, end: {hour, minute, totalMinutes} }`
  - `breakEnabled: true` で勤務時間が休憩を含まない場合は `Error` を throw する

- [ ] **Step 1: テスト用 API に公開する**

`KING_OF_TIME_Holiday_MVP.test.cjs` の `__KOT_TEST_API__` オブジェクトと、下部の分割代入の両方に `resolveBreakForShift,` を追加する。

- [ ] **Step 2: 失敗するテストを書く**

Task 2 で追加した設定テストのすぐ後ろに追加する:

```js
// --- 休憩の解決 ---
const makeShift = (startHour, endHour, label) => ({
  start: { hour: startHour, minute: 0, totalMinutes: startHour * 60 },
  end: { hour: endHour, minute: 0, totalMinutes: endHour * 60 },
  label,
});

const noonBreak = {
  version: 1,
  breakEnabled: true,
  breakStart: { hour: 12, minute: 0 },
  breakEnd: { hour: 13, minute: 0 },
  autoSubmitEnabled: false,
};

// 勤務時間が休憩を含む
assert.deepEqual(
  resolveBreakForShift(makeShift(9, 18, '9:00～18:00'), noonBreak),
  {
    enabled: true,
    start: { hour: 12, minute: 0, totalMinutes: 720 },
    end: { hour: 13, minute: 0, totalMinutes: 780 },
  },
);

// 勤務の開始・終了が休憩とちょうど接する場合は許容する
assert.equal(resolveBreakForShift(makeShift(12, 13, '12:00～13:00'), noonBreak).enabled, true);

// 勤務時間が休憩を含まない場合は止まる
assert.throws(
  () => resolveBreakForShift(makeShift(9, 13, '9:00～13:00'), {
    ...noonBreak,
    breakStart: { hour: 13, minute: 30 },
    breakEnd: { hour: 14, minute: 30 },
  }),
  /休憩13:30～14:30を設定できません/,
);
assert.throws(
  () => resolveBreakForShift(makeShift(14, 18, '14:00～18:00'), noonBreak),
  /勤務時間14:00～18:00に休憩12:00～13:00を設定できません。/,
);

// 短時間勤務でも、自分の休憩時刻を設定していれば通る
assert.deepEqual(
  resolveBreakForShift(makeShift(9, 13, '9:00～13:00'), {
    ...noonBreak,
    breakStart: { hour: 10, minute: 30 },
    breakEnd: { hour: 11, minute: 0 },
  }),
  {
    enabled: true,
    start: { hour: 10, minute: 30, totalMinutes: 630 },
    end: { hour: 11, minute: 0, totalMinutes: 660 },
  },
);

// 休憩なし設定では勤務時間に関わらず休憩を入れない
assert.deepEqual(
  resolveBreakForShift(makeShift(9, 13, '9:00～13:00'), { ...noonBreak, breakEnabled: false }),
  { enabled: false },
);
assert.deepEqual(
  resolveBreakForShift(makeShift(9, 18, '9:00～18:00'), { ...noonBreak, breakEnabled: false }),
  { enabled: false },
);
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: FAIL — `resolveBreakForShift is not defined`

- [ ] **Step 4: 実装する**

`function verifyWorkResult(shift, expectedPattern) {` の直前に挿入する:

```js
  function resolveBreakForShift(shift, settings) {
    if (!settings.breakEnabled) return { enabled: false };

    const start = {
      hour: settings.breakStart.hour,
      minute: settings.breakStart.minute,
      totalMinutes: toTotalMinutes(settings.breakStart),
    };
    const end = {
      hour: settings.breakEnd.hour,
      minute: settings.breakEnd.minute,
      totalMinutes: toTotalMinutes(settings.breakEnd),
    };

    if (shift.start.totalMinutes > start.totalMinutes || shift.end.totalMinutes < end.totalMinutes) {
      throw new Error(
        `勤務時間${shift.label}に休憩${formatShiftTime(start)}～${formatShiftTime(end)}を設定できません。`,
      );
    }

    return { enabled: true, start, end };
  }
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js KING_OF_TIME_Holiday_MVP.test.cjs
git commit -m "$(cat <<'MSG'
シフトごとの休憩を設定から解決する関数を追加する

休憩なし設定、勤務時間が休憩を含まない場合の停止をここに集約する。
DOM を触らないため単体でテストできる。
MSG
)"
```

---

### Task 4: 休憩時間 12:00〜13:00 のハードコードを除去する

配布のブロッカー。Task 3 の関数をフォーム入力・検証・確認プロンプトの3箇所に配線し、`WORK` から休憩の定数を削除する。

**休憩なし設定のときの挙動を確定する。** 仕様書 5.1 の「休憩開始・終了の入力欄には何も入力せず」を、**両方の入力欄を明示的に空文字にする**と解釈する。パターンを選択すると KING OF TIME 側が休憩欄を自動補完する場合があり、「触らない」ではパターン由来の休憩が意図せず申請されるため。休憩欄を空のまま申請できることは 2026-09-06 に実機で確認済み（仕様書7章）。検証では両欄が空であることを確かめる。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js:69-70`（`WORK` から休憩定数を削除）, `:348-403`（`verifyWorkResult`）, `:405-464`（`fillWorkForm`）, `:3243` 付近（連続申請の確認プロンプト）
- Test: `KING_OF_TIME_Holiday_MVP.test.cjs`

**Interfaces:**
- Consumes: `resolveBreakForShift`（Task 3）, `loadUserSettings`（Task 2）
- Produces: `verifyWorkResult(shift, expectedPattern, breakPlan)` — 第3引数が増える。呼び出し元は `fillWorkForm` のみ。

- [ ] **Step 1: 休憩のハードコードが残っていないことを検査する失敗テストを書く**

`fillWorkForm` は DOM を必要とするため vm では実行できない。代わりにソースを検査して、除去し忘れを検出する。Task 1 で追加したバージョン検査の直後に追加する:

```js
assert.doesNotMatch(
  source,
  /WORK\.break/,
  'WORK から休憩時間の定数を削除してください。休憩は設定から解決します。',
);
assert.doesNotMatch(
  source,
  /休憩12:00～13:00|休憩開始を12:00|休憩終了を13:00|休憩：12:00～13:00/,
  'ハードコードされた 12:00～13:00 の休憩文言が残っています。',
);
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: FAIL — `WORK から休憩時間の定数を削除してください。`

- [ ] **Step 3: `WORK` から休憩の定数を削除する**

次の2行を削除する:

```js
    breakStart: Object.freeze({ hour: 12, minute: 0, totalMinutes: 720 }),
    breakEnd: Object.freeze({ hour: 13, minute: 0, totalMinutes: 780 }),
```

`WORK` は `emptyPattern` / `workDayType` / `noLeave` / `dayOffset` / `remark` の5キーになる。

- [ ] **Step 4: `verifyWorkResult` を休憩プランで動かす**

シグネチャを変える:

```js
  function verifyWorkResult(shift, expectedPattern, breakPlan) {
```

`assertSelected(breakStartDay, ...)` と `assertSelected(breakEndDay, ...)` の2行を、次の1ブロックに置き換える:

```js
    if (breakPlan.enabled) {
      assertSelected(breakStartDay, WORK.dayOffset, '休憩開始日');
      assertSelected(breakEndDay, WORK.dayOffset, '休憩終了日');
    }
```

続いて、休憩時刻を検査する次の2ブロック:

```js
    if (normalizeFormTime(breakStartTime.value) !== formatFormTime(WORK.breakStart)) {
      throw new Error('休憩開始を12:00に設定できませんでした。');
    }
    if (normalizeFormTime(breakEndTime.value) !== formatFormTime(WORK.breakEnd)) {
      throw new Error('休憩終了を13:00に設定できませんでした。');
    }
```

を、次に置き換える:

```js
    if (breakPlan.enabled) {
      if (normalizeFormTime(breakStartTime.value) !== formatFormTime(breakPlan.start)) {
        throw new Error(`休憩開始を${formatShiftTime(breakPlan.start)}に設定できませんでした。`);
      }
      if (normalizeFormTime(breakEndTime.value) !== formatFormTime(breakPlan.end)) {
        throw new Error(`休憩終了を${formatShiftTime(breakPlan.end)}に設定できませんでした。`);
      }
    } else {
      if (normalizeFormTime(breakStartTime.value) !== '') {
        throw new Error('休憩なしの設定ですが、休憩開始欄を空にできませんでした。');
      }
      if (normalizeFormTime(breakEndTime.value) !== '') {
        throw new Error('休憩なしの設定ですが、休憩終了欄を空にできませんでした。');
      }
    }
```

- [ ] **Step 5: `fillWorkForm` を設定から動かす**

関数冒頭の次のブロック:

```js
  async function fillWorkForm(shift) {
    if (
      shift.start.totalMinutes > WORK.breakStart.totalMinutes
      || shift.end.totalMinutes < WORK.breakEnd.totalMinutes
    ) {
      throw new Error(`勤務時間${shift.label}に休憩12:00～13:00を設定できません。`);
    }

    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
```

を、次に置き換える:

```js
  async function fillWorkForm(shift) {
    const settings = loadUserSettings();
    if (!settings) {
      throw new Error(
        '休憩時間の設定が見つかりません。月間スケジュール画面の「設定」で休憩時間を設定してください。',
      );
    }
    const breakPlan = resolveBreakForShift(shift, settings);

    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
```

続いて、入力する側の次の4行:

```js
    setSelectOption(breakStartDay, WORK.dayOffset, '休憩開始日');
    setTextInput(breakStartTime, formatFormTime(WORK.breakStart), '休憩開始');
    setSelectOption(breakEndDay, WORK.dayOffset, '休憩終了日');
    setTextInput(breakEndTime, formatFormTime(WORK.breakEnd), '休憩終了');
```

を、次に置き換える:

```js
    if (breakPlan.enabled) {
      setSelectOption(breakStartDay, WORK.dayOffset, '休憩開始日');
      setTextInput(breakStartTime, formatFormTime(breakPlan.start), '休憩開始');
      setSelectOption(breakEndDay, WORK.dayOffset, '休憩終了日');
      setTextInput(breakEndTime, formatFormTime(breakPlan.end), '休憩終了');
    } else {
      // パターン選択で自動補完された休憩が残らないよう、明示的に空にする。
      setTextInput(breakStartTime, '', '休憩開始');
      setTextInput(breakEndTime, '', '休憩終了');
    }
```

最後に、関数末尾の呼び出しに第3引数を渡す:

```js
    verifyWorkResult(shift, expectedPattern, breakPlan);
```

- [ ] **Step 6: 連続申請の確認プロンプトを設定値にする**

`createMonthlyPreview` 内の連続申請ハンドラで、`const details = queue.map(...)` の直前に挿入する:

```js
        const runnerSettings = loadUserSettings();
        if (!runnerSettings) {
          throw new Error('先に「設定」で休憩時間を設定してください。');
        }
        const breakSummary = runnerSettings.breakEnabled
          ? `${formatShiftTime(runnerSettings.breakStart)}～${formatShiftTime(runnerSettings.breakEnd)}`
          : 'なし';
```

続いて確認プロンプトの `` `休憩：12:00～13:00\n申請メッセージ：${WORK.remark}\n\n` `` を次に置き換える:

```js
          + `休憩：${breakSummary}\n申請メッセージ：${WORK.remark}\n\n`
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 8: `WORK.break` の参照が残っていないことを確認する**

Run: `grep -n "WORK\.break" KING_OF_TIME_Holiday_MVP.user.js`
Expected: 出力なし（該当なしで終了コード1）

- [ ] **Step 9: コミット**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js KING_OF_TIME_Holiday_MVP.test.cjs
git commit -m "$(cat <<'MSG'
休憩時間のハードコードを個人設定からの解決に置き換える

12:00〜13:00 固定をやめ、フォーム入力・入力後の検証・連続申請の確認
プロンプトのすべてを設定値から組み立てる。休憩なし設定では休憩欄を
明示的に空にし、空であることを検証する。
これで 9:00〜13:00 のような短時間勤務でもツールを使える。
MSG
)"
```

---

### Task 5: 設定UI

月間スケジュール画面のパネルに「設定」セクションを置く。情報系でない同僚が最初に触る画面なので、未設定であることが一目で分かるようにする。休憩時刻は自由入力（`<input type="time">`）とする。20人の休憩時刻が数パターンに収まるかは未確認のため、プリセットを列挙できない。自由入力ならどの勤務形態でも設定でき、後からプリセットを足せる。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js`（`createPreviewSection` の直後に `createSettingsSection` を追加、`createMonthlyPreview` に組み込む）

**Interfaces:**
- Consumes: `DEFAULT_USER_SETTINGS`, `loadUserSettings`, `saveUserSettings`（Task 2）
- Produces: `createSettingsSection(onSaved)` — `{ section: HTMLElement }` を返す。保存成功時に `onSaved(settings)` を呼ぶ。

- [ ] **Step 1: `createSettingsSection` を実装する**

`function createPreviewSection(label) {` の直前に挿入する:

```js
  function formatTimeInputValue(time) {
    return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  }

  function parseTimeInputValue(value) {
    const matched = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!matched) return null;
    return { hour: Number(matched[1]), minute: Number(matched[2]) };
  }

  function createSettingsSection(onSaved) {
    const storedSettings = loadUserSettings();
    const initialSettings = storedSettings ?? DEFAULT_USER_SETTINGS;

    const section = document.createElement('div');
    Object.assign(section.style, {
      marginTop: '12px',
      padding: '10px',
      border: '1px solid #c8d0d9',
      borderRadius: '8px',
      background: '#f7f9fb',
    });

    const heading = document.createElement('div');
    heading.textContent = '設定';
    Object.assign(heading.style, { fontSize: '13px', fontWeight: '700', marginBottom: '6px' });

    const guidance = document.createElement('div');
    Object.assign(guidance.style, { fontSize: '12px', lineHeight: '1.45', marginBottom: '8px' });
    if (storedSettings) {
      guidance.style.color = '#17212b';
      guidance.textContent = '自分の休憩時間を設定しています。変更したらそのつど保存してください。';
    } else {
      guidance.style.color = '#9a5700';
      guidance.textContent = 'まず自分の休憩時間を設定して保存してください。設定するまで申請の処理はできません。';
    }

    const breakEnabled = document.createElement('input');
    breakEnabled.type = 'checkbox';
    breakEnabled.checked = initialSettings.breakEnabled;
    breakEnabled.id = 'kot-settings-break-enabled';

    const breakEnabledLabel = document.createElement('label');
    breakEnabledLabel.htmlFor = breakEnabled.id;
    breakEnabledLabel.textContent = ' 休憩をとる';
    Object.assign(breakEnabledLabel.style, { fontSize: '12px' });

    const breakEnabledRow = document.createElement('div');
    breakEnabledRow.append(breakEnabled, breakEnabledLabel);

    const timesRow = document.createElement('div');
    Object.assign(timesRow.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'flex-end',
      marginTop: '8px',
    });

    const createTimeField = (fieldId, labelText, time) => {
      const wrapper = document.createElement('div');
      Object.assign(wrapper.style, { flex: '1' });
      const label = document.createElement('label');
      label.htmlFor = fieldId;
      label.textContent = labelText;
      Object.assign(label.style, {
        display: 'block',
        marginBottom: '4px',
        fontSize: '12px',
        fontWeight: '700',
      });
      const input = document.createElement('input');
      input.id = fieldId;
      input.type = 'time';
      input.value = formatTimeInputValue(time);
      Object.assign(input.style, {
        width: '100%',
        padding: '6px',
        border: '1px solid #aeb8c2',
        borderRadius: '6px',
        boxSizing: 'border-box',
      });
      wrapper.append(label, input);
      return { wrapper, input };
    };

    const breakStartField = createTimeField('kot-settings-break-start', '休憩開始', initialSettings.breakStart);
    const breakEndField = createTimeField('kot-settings-break-end', '休憩終了', initialSettings.breakEnd);
    timesRow.append(breakStartField.wrapper, breakEndField.wrapper);

    const autoSubmit = document.createElement('input');
    autoSubmit.type = 'checkbox';
    autoSubmit.checked = initialSettings.autoSubmitEnabled;
    autoSubmit.id = 'kot-settings-auto-submit';

    const autoSubmitLabel = document.createElement('label');
    autoSubmitLabel.htmlFor = autoSubmit.id;
    autoSubmitLabel.textContent = ' 連続申請（自動で実際に申請する）を使う';
    Object.assign(autoSubmitLabel.style, { fontSize: '12px' });

    const autoSubmitRow = document.createElement('div');
    Object.assign(autoSubmitRow.style, { marginTop: '10px' });
    autoSubmitRow.append(autoSubmit, autoSubmitLabel);

    const autoSubmitNote = document.createElement('div');
    autoSubmitNote.textContent = 'ONにすると「出勤日の時間を連続申請」ボタンが出ます。内容を自分で確認できるまではOFFのままにしてください。';
    Object.assign(autoSubmitNote.style, {
      marginTop: '4px',
      fontSize: '11px',
      lineHeight: '1.4',
      color: '#5b6770',
    });

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = '設定を保存';
    Object.assign(saveButton.style, {
      width: '100%',
      marginTop: '10px',
      padding: '8px 12px',
      border: '0',
      borderRadius: '7px',
      background: '#1668c1',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });

    const settingsStatus = document.createElement('div');
    settingsStatus.setAttribute('role', 'status');
    Object.assign(settingsStatus.style, {
      marginTop: '6px',
      fontSize: '12px',
      lineHeight: '1.45',
    });

    const syncTimeFieldState = () => {
      const disabled = !breakEnabled.checked;
      breakStartField.input.disabled = disabled;
      breakEndField.input.disabled = disabled;
      timesRow.style.opacity = disabled ? '0.5' : '1';
    };
    syncTimeFieldState();
    breakEnabled.addEventListener('change', syncTimeFieldState);

    saveButton.addEventListener('click', () => {
      const start = parseTimeInputValue(breakStartField.input.value);
      const end = parseTimeInputValue(breakEndField.input.value);
      if (!start || !end) {
        settingsStatus.style.color = '#b3261e';
        settingsStatus.textContent = '休憩開始と休憩終了の両方を入力してください。';
        return;
      }

      const saved = (() => {
        try {
          return saveUserSettings({
            version: 1,
            breakEnabled: breakEnabled.checked,
            breakStart: start,
            breakEnd: end,
            autoSubmitEnabled: autoSubmit.checked,
          });
        } catch (error) {
          console.error('[KOT申請ヘルパー設定]', error);
          return null;
        }
      })();

      if (!saved) {
        settingsStatus.style.color = '#b3261e';
        settingsStatus.textContent = '休憩終了は休憩開始より後の時刻にしてください。';
        return;
      }

      guidance.style.color = '#17212b';
      guidance.textContent = '自分の休憩時間を設定しています。変更したらそのつど保存してください。';
      settingsStatus.style.color = '#137333';
      settingsStatus.textContent = saved.breakEnabled
        ? `保存しました。休憩：${formatShiftTime(saved.breakStart)}～${formatShiftTime(saved.breakEnd)}`
        : '保存しました。休憩：なし';
      onSaved(saved);
    });

    section.append(
      heading,
      guidance,
      breakEnabledRow,
      timesRow,
      autoSubmitRow,
      autoSubmitNote,
      saveButton,
      settingsStatus,
    );
    return { section };
  }
```

- [ ] **Step 2: 月間パネルに組み込む**

`createMonthlyPreview` 内の `let latestPlan = null;` の直前に挿入する:

```js
    const settingsSection = createSettingsSection((savedSettings) => {
      applyAutoSubmitVisibility(savedSettings);
    });
```

`applyAutoSubmitVisibility` は Task 6 で定義する。**Task 5 だけを適用した時点では未定義参照になるため、Task 5 と Task 6 は続けて実施し、両方が終わってから動作確認する。**

`container.append(` のリストで、`title,` の直後に `settingsSection.section,` を追加する:

```js
    container.append(
      title,
      settingsSection.section,
      monthLabel,
      monthInput,
      workDaysLabel,
      workDaysInput,
      previewButton,
      saveAndOpenButton,
      runWorkdaysButton,
      status,
      summary.section,
      workDays.section,
      holidayDays.section,
      mapping.section,
    );
```

- [ ] **Step 3: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS（このタスクは DOM のみで、テスト対象の純粋関数を変えない）

- [ ] **Step 4: Task 6 に進む**

このタスク単独ではコミットしない。Task 6 の完了時にまとめてコミットする。

---

### Task 6: 自動申請の既定OFF

新規インストール直後に、実際に申請を送るボタンが押せないようにする。無効化ではなく非表示にする（仕様書 5.2）。既存の安全策（「申請する」の手入力確認、申請済み行のスキップ、進行表示からの停止）は変更しない。

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js`（`createMonthlyPreview` 内）
- Test: `KING_OF_TIME_Holiday_MVP.test.cjs`

**Interfaces:**
- Consumes: `loadUserSettings`（Task 2）、`createSettingsSection` の `onSaved` コールバック（Task 5）
- Produces: `applyAutoSubmitVisibility(currentSettings)` — `createMonthlyPreview` 内のローカル関数

- [ ] **Step 1: 失敗するテストを書く**

Task 4 のソース検査の直後に追加する:

```js
assert.match(
  source,
  /function applyAutoSubmitVisibility\(currentSettings\) \{/,
  '自動申請ボタンの表示制御が見つかりません。',
);
assert.doesNotMatch(
  source,
  /runWorkdaysButton\.hidden = false;/,
  'プレビュー作成だけで連続申請ボタンを表示してはいけません。表示は applyAutoSubmitVisibility の1箇所に集めてください。',
);
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: FAIL — `自動申請ボタンの表示制御が見つかりません。`

- [ ] **Step 3: 表示制御を実装する**

`createMonthlyPreview` 内、Task 5 で追加した `const settingsSection = createSettingsSection(...)` の**直前**に挿入する:

```js
    let previewReady = false;

    // 自動申請は既定 OFF。設定で明示的に ON にするまでボタン自体を出さない。
    function applyAutoSubmitVisibility(currentSettings) {
      const enabled = Boolean(currentSettings?.autoSubmitEnabled);
      runWorkdaysButton.hidden = !(enabled && previewReady);
    }
```

- [ ] **Step 4: プレビュー作成時の表示を設定経由にする**

プレビュー作成ハンドラ内で `saveAndOpenButton.hidden = false;` に続く `runWorkdaysButton.hidden = false;` の行を、次に置き換える:

```js
        previewReady = true;
        applyAutoSubmitVisibility(loadUserSettings());
```

（`runWorkdaysButton.hidden = false;` という代入がハンドラ内から消え、表示は `applyAutoSubmitVisibility` の1箇所だけになる。）

- [ ] **Step 5: 初期表示に設定を反映する**

`container.append(` の直前に挿入する:

```js
    applyAutoSubmitVisibility(loadUserSettings());
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 7: 構文を確認する**

Run: `node --check KING_OF_TIME_Holiday_MVP.user.js`
Expected: 出力なし（終了コード0）

- [ ] **Step 8: 実機で確認する**

KING OF TIME の月間スケジュール画面を開き、次を確かめる。ブラウザの DevTools で `localStorage.removeItem('kot-user-settings-v1')` を実行してから再読み込みすると未設定状態を再現できる。

1. 未設定の状態でパネルに「設定」があり、「まず自分の休憩時間を設定して保存してください。」と橙色で表示される
2. プレビューを作成しても「出勤日の時間を連続申請」ボタンが出ない
3. 「連続申請（自動で実際に申請する）を使う」をONにして保存すると、ボタンが出る
4. 「休憩をとる」をOFFにすると休憩時刻の入力欄が薄く無効になる
5. 休憩終了を休憩開始より前にして保存すると赤字で拒否される
6. パネルのタイトルに `v0.5.0` が表示されている

- [ ] **Step 9: コミット**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js KING_OF_TIME_Holiday_MVP.test.cjs
git commit -m "$(cat <<'MSG'
設定UIを追加し、自動申請を既定OFFにする

月間スケジュール画面のパネルに休憩時間と自動申請の設定を置く。
未設定のときは設定を促し、自動申請は明示的にONにするまで起動ボタン
自体を描画しない。既存の確認プロンプトや停止手段は変更していない。
MSG
)"
```

---

### Task 7: 公開前の内容チェック

パブリック化は取り消せない。リポジトリを作る前に、追跡対象のファイルとコミットメッセージに会社・部署・個人を特定する情報が含まれていないことを確かめる。

**Files:**
- Modify: `KING_OF_TIME_Codex_Handoff.md`, `KING_OF_TIME_Batch_Inspector.user.js`, `.gitignore`（チェック結果次第）
- Delete: `KING_OF_TIME_Inspector.zip`（作業用の中間生成物。配布物ではない）

- [ ] **Step 1: 追跡対象ファイルの一覧を確認する**

```bash
git ls-files
```

配布に不要なものがないか確認する。`KING_OF_TIME_Inspector.zip` は `KING_OF_TIME_Batch_Inspector.user.js` を配るための作業用アーカイブであり、公開リポジトリには不要。

- [ ] **Step 2: 特定情報を機械的に走査する**

```bash
git grep -nEi '株式会社|有限会社|(名前|氏名|担当者)[：:]|従業員番号|社員番号|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|claude\.ai/code/session|github\.com/[[:alnum:]_.-]+|raw\.githubusercontent\.com/[[:alnum:]_.-]+|/admin/[[:alnum:]_-]{8,}|[0-9]{10,}' -- . ':!*.zip'
```

検索式を説明する計画書自身も一致するため、各一致を目視で分類する。`@match` の
`s2.ta.kingoftime.jp` と Tampermonkey の配布元は許容し、それ以外の個人メール、
セッション URL、個人アカウント、環境固有パス、長い内部 ID は除去対象とする。

- [ ] **Step 3: 社内URL・部署名らしき固有名詞を目視で確認する**

```bash
sed -n '1,80p' KING_OF_TIME_Codex_Handoff.md
git log --all --format='%H%n%an <%ae>%n%cn <%ce>%n%s%n%b'
git log --all --format=fuller -p -- . ':!*.zip'
```

`KING_OF_TIME_Codex_Handoff.md` は作者用の作業メモ由来のため、勤務実態・シフト表の実データ・同僚の名前が残っていないか通読する。コミット作者名とメールも公開されるため、個人を特定できる値は検出対象とする。
現在のファイルだけでなく、全 reachable commit の作者・コミッター・本文・過去の差分を確認する。
特に日本語の実名・拠点名は正規表現だけで確実に検出できないため、過去差分を目視でも確認する。

- [ ] **Step 4: 見つかった情報を除去する**

見つかった場合の対応:
- **配布に不要なファイル** → `git rm` で削除する（履歴には残るが、Step 6 で履歴ごと作り直すか判断する）
- **必要なファイル内の記述** → 一般名詞に書き換える（例: 実在の部署名 → 「職場」）
- 何も見つからなければ Step 5 へ

- [ ] **Step 5: 作業用アーカイブを削除する**

```bash
git rm KING_OF_TIME_Inspector.zip
rm -f 'KING_OF_TIME_Inspector.zip:Zone.Identifier'
```

- [ ] **Step 6: 履歴を作り直すかを判断する（実行は Task 8 完了後）**

Step 2〜3 で**特定情報が1件も見つからなかった場合**は既存の履歴のまま公開してよい。

**1件でも見つかった場合**は、ファイルを直すだけでは過去のコミットに残るため、
Task 8 完了後・Task 9 の公開前に履歴を作り直す。履歴の置換は取り消しにくいため、
実行直前に承認を取る。`main` をチェックアウトしている主 worktree で、Task 8 までの
完成スナップショットを非個人の作者・コミッターによる trailer なしの単一 root commit にする:

```bash
git switch --orphan clean-main
git checkout worktree-distribution -- .
git add -A
GIT_AUTHOR_NAME='KOT Helper Contributors' \
GIT_AUTHOR_EMAIL='noreply@users.noreply.github.com' \
GIT_COMMITTER_NAME='KOT Helper Contributors' \
GIT_COMMITTER_EMAIL='noreply@users.noreply.github.com' \
git commit -m 'KING OF TIME 申請ヘルパー'
git branch -D main
git branch -m main
```

作成した root commit は公開対象の `main` に限定し、`git log main` と
`git log main -p` で再走査する。旧履歴を保持するローカル作業ブランチは公開せず、
Task 9 では `main` だけを明示して push する。Task 9 で追加するコミットも同じ非個人
identity を明示し、セッション URL などの trailer を付けない。

- [ ] **Step 7: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "$(cat <<'MSG'
公開前チェックを実施し、配布に不要な作業用アーカイブを削除する

追跡対象のファイルとコミットメッセージを走査し、勤怠システムの
ホスト名以外に所属を特定する情報がないことを確認した。
MSG
)"
```

---

### Task 8: 同僚向けの手順書

導入の入口。読む相手は情報系ではない。「何をしないか」を先に書いて安心させ、手順は3ステップに収める。

**Files:**
- Create: `README.md`, `docs/INSTALL.md`

- [ ] **Step 1: `README.md` を書く**

`<INSTALL_URL>` は Task 9 でリポジトリ URL を確定してから埋める。この段階では文字列のまま置く。

```markdown
# KING OF TIME 月間スケジュール申請ヘルパー

勤務予定の月間申請を、ブラウザ上で半自動的に入力するツールです。有志で作って共有しているもので、
会社の公式ツールではありません。

## これは何をするか

- 月のシフトを1回入力すると、出勤日と休日をまとめてプレビューできます
- 休日の一括フォーム入力を補助します
- 出勤日の勤務時間を、日別フォームへ自動で入力します
- 申請済みの内容を月単位で取り消す作業を補助します

## これは何をしないか

- **初期状態では、申請を自動で送信しません。** 自動で申請する機能は設定でONにするまでボタンすら出ません
- 会社のシステムに何かをインストールしたり、設定を変更したりしません
- 入力した内容は自分のブラウザの中だけに保存されます。どこにも送信しません

## 導入（3ステップ）

1. Chrome ウェブストアで **Tampermonkey** をインストールする
   → https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
2. 次のリンクを開く
   → <INSTALL_URL>
3. 表示された画面で「インストール」を押す

うまくいかないときは [docs/INSTALL.md](docs/INSTALL.md) に詳しい手順があります。

## 最初にすること：休憩時間の設定

インストールしたら、KING OF TIME の月間スケジュール画面を開いてください。
右下にパネルが出ます。パネルの上部に「設定」があります。

1. 自分の休憩時間を「休憩開始」「休憩終了」に入れる
2. 休憩をとらない働き方なら「休憩をとる」のチェックを外す
3. 「設定を保存」を押す

**設定を保存するまで、勤務時間の入力はできません。** 人によって休憩時間が違うため、
共通の初期値を勝手に使わない作りにしています。

「連続申請（自動で実際に申請する）を使う」は、最初はOFFのままにしてください。
手動での入力を何度か試して、内容が正しいことを自分の目で確認してから
ONにすることをおすすめします。

## うまく動かないとき

パネルのタイトルに表示されているバージョン（例: `v0.5.0`）と、
画面に出ているメッセージを添えて連絡してください。

## 更新について

修正すると Tampermonkey が自動で新しい版を取ってきます。手動で更新したいときは、
Tampermonkey のダッシュボードで「更新を確認」を押してください。

## 開発者向け：リリース手順

1. `KING_OF_TIME_Holiday_MVP.user.js` を修正する
2. **`// @version` と `const SCRIPT_VERSION` の両方を上げる**（片方だけだとテストが落ちます）
3. `node KING_OF_TIME_Holiday_MVP.test.cjs` が通ることを確認する
4. `main` に push する

**`@version` を上げないと、修正は誰にも届きません。** Tampermonkey は
バージョン番号が上がったときだけ更新します。
```

- [ ] **Step 2: `docs/INSTALL.md` を書く**

```markdown
# 詳しい導入手順

## 1. Tampermonkey を入れる

Tampermonkey は、ブラウザに小さなツールを追加するための拡張機能です。

1. Chrome または Edge を開く
2. https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo を開く
3. 「Chrome に追加」を押す
4. 確認のダイアログで「拡張機能を追加」を押す

ブラウザの右上に黒っぽい四角のアイコンが増えれば成功です。
アイコンが見当たらないときは、右上のパズルピースのアイコンを押すと一覧に入っています。

## 2. スクリプトを入れる

1. <INSTALL_URL> を開く
2. Tampermonkey のインストール画面が開く
3. 「インストール」を押す

**この画面が開かず、文字だけがずらっと表示された場合**は Tampermonkey が
入っていないか、有効になっていません。手順1に戻ってください。

## 3. 動いているか確かめる

1. KING OF TIME にログインする
2. 月間スケジュールの画面を開く
3. 画面の**右下**にパネルが出れば成功です

パネルが出ないとき:

- ページを再読み込みする（F5）
- Tampermonkey のアイコンを押して、スクリプトが「有効」になっているか確認する
- 別の画面（打刻画面など）を開いていないか確認する。パネルは画面ごとに出るものが違います

## 4. 休憩時間を設定する

パネルの上部の「設定」で、自分の休憩時間を入れて「設定を保存」を押します。
これをしないと勤務時間の入力はできません。

## よくある質問

**Q. 勝手に申請されませんか？**
初期状態では申請を送るボタン自体が表示されません。「設定」で
「連続申請（自動で実際に申請する）を使う」をONにしたときだけ表示されます。
ONにした場合も、実行前に「申請する」と手で入力する確認があります。

**Q. 入力した内容はどこかに送られますか？**
いいえ。自分のブラウザの中だけに保存されます。

**Q. 会社のパソコンに入れて大丈夫ですか？**
拡張機能をインストールできるかどうかは各自で確認してください。
このツールは会社の公式ツールではありません。

**Q. アンインストールしたい**
Tampermonkey のダッシュボードでスクリプトを削除してください。
KING OF TIME 側には何も残りません。
```

- [ ] **Step 3: 特定情報が入っていないことを確認する**

```bash
grep -nEi '株式会社|有限会社|従業員番号|社員番号' README.md docs/INSTALL.md
```

Expected: 出力なし

- [ ] **Step 4: コミット**

```bash
git add README.md docs/INSTALL.md
git commit -m "$(cat <<'MSG'
同僚向けの導入手順書を追加する

先に「何をしないか」を書き、導入を3ステップに収めた。休憩時間の
初期設定が必須であること、自動申請が既定OFFであることを明記した。
リリース手順として @version と SCRIPT_VERSION の同時更新を残した。
MSG
)"
```

---

### Task 9: 公開と自動更新の設定

リポジトリを公開し、raw URL が実際に配信されることを確認してから `@updateURL`/`@downloadURL` を入れる。**誤った URL を指したスクリプトを配ると、更新が二度と届かなくなる。**

**Files:**
- Modify: `KING_OF_TIME_Holiday_MVP.user.js:2-9`（メタデータブロック）, `README.md`, `docs/INSTALL.md`（`<INSTALL_URL>` の置換）

- [ ] **Step 1: 公開してよいか利用者に確認する**

パブリックリポジトリの作成は取り消せない。Task 7 のチェック結果を示したうえで、
`<公開用GitHubアカウント>/king-of-time-autofill` をパブリックで作成してよいか確認を取る。**承認を得るまで次に進まない。**

- [ ] **Step 2: リポジトリを作成して push する**

```bash
gh repo create <公開用GitHubアカウント>/king-of-time-autofill \
  --public \
  --source=. \
  --remote=origin \
  --description="KING OF TIME の月間スケジュール申請を補助する Tampermonkey ユーザースクリプト"
git push -u origin main
```

- [ ] **Step 3: raw URL が配信されていることを確認する**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js
```

Expected: `200`

`404` の場合は URL のオーナー名・リポジトリ名・ブランチ名・ファイル名を確認する。**200 になるまで Step 4 に進まない。**

- [ ] **Step 4: バージョンを 0.6.0 に上げ、更新URLを追加する**

`KING_OF_TIME_Holiday_MVP.user.js` のメタデータブロックを次にする:

```
// ==UserScript==
// @name         KING OF TIME 月間スケジュール申請ヘルパー
// @namespace    local.kot.helper
// @version      0.6.0
// @description  月間計画の申請と、申請履歴からの安全な月単位取消を支援します。
// @match        https://s2.ta.kingoftime.jp/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js
// @downloadURL  https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js
// ==/UserScript==
```

あわせて `SCRIPT_VERSION` も上げる:

```js
  const SCRIPT_VERSION = '0.6.0';
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `node KING_OF_TIME_Holiday_MVP.test.cjs`
Expected: PASS（Task 1 のテストが `@version` と `SCRIPT_VERSION` の一致を確認する）

- [ ] **Step 6: 手順書の `<INSTALL_URL>` を差し替える**

```bash
sed -i 's|<INSTALL_URL>|https://raw.githubusercontent.com/<公開用GitHubアカウント>/king-of-time-autofill/main/KING_OF_TIME_Holiday_MVP.user.js|g' README.md docs/INSTALL.md
grep -n 'INSTALL_URL' README.md docs/INSTALL.md
```

Expected: 最後の `grep` は出力なし（置換漏れがない）

`README.md` のバージョン例も `v0.6.0` に直す。

- [ ] **Step 7: コミットして push する**

```bash
git add KING_OF_TIME_Holiday_MVP.user.js README.md docs/INSTALL.md
GIT_AUTHOR_NAME='KOT Helper Contributors' \
GIT_AUTHOR_EMAIL='noreply@users.noreply.github.com' \
GIT_COMMITTER_NAME='KOT Helper Contributors' \
GIT_COMMITTER_EMAIL='noreply@users.noreply.github.com' \
git commit -m "$(cat <<'MSG'
配布用に v0.6.0 を公開し、自動更新を有効にする

raw URL が配信されていることを確認したうえで @updateURL と
@downloadURL を追加した。以後は main への push で更新が配信される。
MSG
)"
git push
```

- [ ] **Step 8: 配布物としてインストールできることを確認する**

1. Tampermonkey のダッシュボードで既存のスクリプトを**いったん削除する**
2. README のインストールリンクを開き、インストール画面が出ることを確認する
3. 「インストール」を押す
4. KING OF TIME の月間スケジュール画面でパネルが出て、タイトルに `v0.6.0` と表示されることを確認する
5. 未設定のため「まず自分の休憩時間を設定して保存してください。」が出ることを確認する
6. 「出勤日の時間を連続申請」ボタンが出ていないことを確認する

- [ ] **Step 9: 自動更新が届くことを確認する**

`@version` を `0.6.1` に、`SCRIPT_VERSION` も `0.6.1` に上げて push し、
Tampermonkey のダッシュボードで「更新を確認」を押して 0.6.1 になることを確認する。

これが動かなければ、修正を同僚へ届ける手段がない。**配布前に必ず確認する。**

```bash
node KING_OF_TIME_Holiday_MVP.test.cjs
git add KING_OF_TIME_Holiday_MVP.user.js
GIT_AUTHOR_NAME='KOT Helper Contributors' \
GIT_AUTHOR_EMAIL='noreply@users.noreply.github.com' \
GIT_COMMITTER_NAME='KOT Helper Contributors' \
GIT_COMMITTER_EMAIL='noreply@users.noreply.github.com' \
git commit -m "$(cat <<'MSG'
自動更新の疎通確認のため v0.6.1 を発行する
MSG
)"
git push
```

---

## 完了条件（仕様書 8章）

- [ ] 休憩時間を各自が設定でき、12:00〜13:00 に勤務しない人もツールを使える（Task 4, 5）
- [ ] 新規インストール直後の状態で自動申請が実行されない（Task 6）
- [ ] 画面上でバージョンが確認できる（Task 1）
- [ ] 同僚が README のリンクから3ステップで導入できる（Task 8, 9）
- [ ] 修正を push すると各自の Tampermonkey に自動で届く（Task 9 Step 9 で実証）
- [ ] `node KING_OF_TIME_Holiday_MVP.test.cjs` が通る
- [ ] 公開前チェックを実施し、公開物に会社名・部署名・個人名が含まれない（Task 7）
