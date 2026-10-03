const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(
  new URL('./KING_OF_TIME_Holiday_MVP.user.js', `file://${__dirname}/`),
  'utf8',
);
assert.match(source, /const AUTO_SUBMIT_COUNTDOWN_SECONDS = 1;/);
const versionMeta = source.match(/^\/\/ @version\s+(\S+)\s*$/m);
assert.ok(versionMeta, '@version メタデータが見つかりません。');
const versionConstant = source.match(/^ {2}const SCRIPT_VERSION = '([^']+)';$/m);
assert.ok(versionConstant, 'SCRIPT_VERSION 定数が見つかりません。');
assert.equal(
  versionConstant[1],
  versionMeta[1],
  '@version と SCRIPT_VERSION が一致しません。両方を同時に更新してください。',
);
assert.doesNotMatch(
  source,
  /WORK\.break/,
  'WORK から休憩時間の定数を削除してください。休憩は申請しません。',
);
assert.doesNotMatch(
  source,
  /休憩12:00～13:00|休憩開始を12:00|休憩終了を13:00|休憩：12:00～13:00/,
  'ハードコードされた 12:00～13:00 の休憩文言が残っています。',
);
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
const initMarker = '  const activeCancellationRun = loadCancellationRun();';
assert.ok(source.includes(initMarker), 'test insertion point was not found');

const instrumentedSource = source.replace(
  initMarker,
  `  globalThis.__KOT_TEST_API__ = {
    parseShiftSchedule,
    parseDayCandidate,
    parseYearMonth,
    createSchedulePlan,
    validateStoredPlan,
    planToShiftMap,
    readBatchCurrentState,
    createWorkdayRun,
    validateWorkdayRun,
    createSubmissionAttempt,
    hasRecentMatchingSubmissionAttempt,
    canManuallyConfirmPausedSubmission,
    parseCancelableScheduleRowText,
    createCancellationRun,
    validateCancellationRun,
    confirmationTextMatchesCancellationTarget,
    DEFAULT_USER_SETTINGS,
    validateUserSettings,
    saveUserSettings,
    loadUserSettings,
  };
  return;
${initMarker}`,
);
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
vm.createContext(context);
vm.runInContext(instrumentedSource, context);

const {
  parseShiftSchedule,
  parseDayCandidate,
  parseYearMonth,
  createSchedulePlan,
  validateStoredPlan,
  planToShiftMap,
  readBatchCurrentState,
  createWorkdayRun,
  validateWorkdayRun,
  createSubmissionAttempt,
  hasRecentMatchingSubmissionAttempt,
  canManuallyConfirmPausedSubmission,
  parseCancelableScheduleRowText,
  createCancellationRun,
  validateCancellationRun,
  confirmationTextMatchesCancellationTarget,
  DEFAULT_USER_SETTINGS,
  validateUserSettings,
  saveUserSettings,
  loadUserSettings,
} = context.__KOT_TEST_API__;
const entries = (value, lastDay = 31) => [...parseShiftSchedule(value, lastDay)]
  .map(([day, shift]) => [day, shift.label]);

assert.deepEqual(
  entries('１，２，３日　7時～16時'),
  [[1, '7:00～16:00'], [2, '7:00～16:00'], [3, '7:00～16:00']],
);

assert.deepEqual(
  entries('1,2,3日 7時～16時\n8,9日 9:00-18:00'),
  [
    [1, '7:00～16:00'],
    [2, '7:00～16:00'],
    [3, '7:00～16:00'],
    [8, '9:00～18:00'],
    [9, '9:00～18:00'],
  ],
);

assert.deepEqual(
  entries('10-12日 8時30分〜17時30分'),
  [[10, '8:30～17:30'], [11, '8:30～17:30'], [12, '8:30～17:30']],
);

assert.deepEqual(entries('なし'), []);

assert.throws(
  () => entries('1日 7時～16時\n1日 9時～18時'),
  /1日に異なる勤務時間が重複しています/,
);
assert.throws(() => entries('32日 7時～16時'), /対象月に存在しません/);
assert.throws(() => entries('1日 16時～7時'), /終了時刻/);

assert.deepEqual(
  JSON.parse(JSON.stringify(parseYearMonth('2026年8月'))),
  { year: 2026, month: 8, value: '2026-08' },
);
assert.equal(parseDayCandidate('2026年8月1日（土）', { year: 2026, month: 8 }), 1);
assert.equal(parseDayCandidate('8/31(月)', { year: 2026, month: 8 }), 31);
assert.equal(parseDayCandidate('15（火）', { year: 2026, month: 8 }), 15);
assert.equal(parseDayCandidate('2026年9月1日', { year: 2026, month: 8 }), null);

const parsedShifts = parseShiftSchedule('1日 7時～16時\n8日 9時～18時', 31);
const storedPlan = createSchedulePlan(
  { year: 2026, month: 8, value: '2026-08' },
  '1日 7時～16時\n8日 9時～18時',
  parsedShifts,
);
assert.ok(validateStoredPlan(storedPlan));
assert.deepEqual(
  [...planToShiftMap(storedPlan)].map(([day, shift]) => [day, shift.label]),
  [[1, '7:00～16:00'], [8, '9:00～18:00']],
);
assert.equal(validateStoredPlan({ ...storedPlan, month: '2026-13' }), null);

const enabledSelect = { disabled: false };
assert.deepEqual(
  JSON.parse(JSON.stringify(readBatchCurrentState({
    rowText: '08/05（水） 9:00～18:00 勤務日種別：平日 変更なし 9:00～18:00 変更なし平日法定休日法定外休日 変更なし 削除有休公休欠勤',
    pattern: enabledSelect,
    workDayType: enabledSelect,
    leaveType: enabledSelect,
  }))),
  {
    currentSummary: '08/05（水） 9:00～18:00 勤務日種別：平日',
    scheduleLabel: '9:00～18:00',
    workDayType: '平日',
    currentLeave: null,
    hasPunch: false,
    unavailable: false,
  },
);

const punchedHolidayState = readBatchCurrentState({
  rowText: '08/30（日） 06:53 16:11 --(公休) 勤務日種別：法定外休日 変更なし 9:00～18:00 変更なし 削除有休公休欠勤',
  pattern: enabledSelect,
  workDayType: enabledSelect,
  leaveType: enabledSelect,
});
assert.equal(punchedHolidayState.currentLeave, '公休');
assert.equal(punchedHolidayState.workDayType, '法定外休日');
assert.equal(punchedHolidayState.hasPunch, true);

const workdayRun = createWorkdayRun(storedPlan, [1, 8]);
assert.ok(validateWorkdayRun(workdayRun));
assert.equal(validateWorkdayRun({ ...workdayRun, queue: [1, 1] }), null);
assert.equal(validateWorkdayRun({ ...workdayRun, status: 'unknown' }), null);
assert.equal(validateWorkdayRun({ ...workdayRun, currentIndex: 3 }), null);

const testShift = planToShiftMap(storedPlan).get(1);
const submittingRun = {
  ...workdayRun,
  status: 'submitting',
  currentDay: 1,
  submissionAttempt: createSubmissionAttempt(1, testShift, 1_000),
};
assert.ok(validateWorkdayRun(submittingRun));
assert.equal(hasRecentMatchingSubmissionAttempt(submittingRun, 1, testShift, 10_000), true);
assert.equal(hasRecentMatchingSubmissionAttempt(submittingRun, 8, testShift, 10_000), false);
assert.equal(hasRecentMatchingSubmissionAttempt(submittingRun, 1, testShift, 130_000), false);
assert.equal(validateWorkdayRun({ ...submittingRun, submissionAttempt: { day: 1 } }), null);

const pausedAfterReturn = {
  ...workdayRun,
  status: 'paused',
  currentDay: 1,
  pauseMessage: '申請後にタイムカードへ戻りましたが、申請済み状態を確認できません。',
};
assert.equal(canManuallyConfirmPausedSubmission(pausedAfterReturn), true);
assert.equal(canManuallyConfirmPausedSubmission({ ...pausedAfterReturn, currentDay: 8 }), false);

const cancelableWork = parseCancelableScheduleRowText(
  '2026/08/30 17:55 利用者A 申請をキャンセル 9:00～18:00 '
  + 'シフト (07:00-16:00) (通常勤務) 休憩予定：12:00-13:00 '
  + '勤務日種別：平日 2026/09/04(金) 拠点A 利用者B 対応中 よろしくお願いいたします。',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(cancelableWork)),
  {
    date: '2026/09/04',
    month: '2026-09',
    year: 2026,
    monthNumber: 9,
    day: 4,
    weekday: '金',
    category: '出勤時間',
    requestedTime: '07:00～16:00',
    message: 'よろしくお願いいたします。',
  },
);

const cancelableHoliday = parseCancelableScheduleRowText(
  '2026/08/30 17:55 利用者A 申請をキャンセル 9:00～18:00 '
  + '9:00～18:00 (休暇 公休) 勤務日種別：法定外休日 2026/09/30(水) '
  + '拠点A 利用者B 対応中 全休',
);
assert.equal(cancelableHoliday.category, '全休');
assert.equal(cancelableHoliday.month, '2026-09');
assert.equal(
  parseCancelableScheduleRowText(
    '2026/08/30 17:35 申請をキャンセル 2026/08/29(土) 07:00 (出勤) 対応中',
  ),
  null,
);

const cancellationRecord = {
  ...cancelableWork,
  applicationId: '12345',
};
const cancellationRun = createCancellationRun('2026-09', [cancellationRecord], true);
assert.ok(validateCancellationRun(cancellationRun));
assert.equal(validateCancellationRun({ ...cancellationRun, status: 'unknown' }), null);
assert.equal(validateCancellationRun({
  ...cancellationRun,
  queue: [...cancellationRun.queue, cancellationRun.queue[0]],
}), null);
assert.equal(
  confirmationTextMatchesCancellationTarget(
    '2026/09/04(金) 勤務日種別：平日 シフト 07:00-16:00 休憩予定 12:00-13:00 '
    + 'よろしくお願いいたします。',
    cancellationRun.queue[0],
  ),
  true,
);
assert.equal(
  confirmationTextMatchesCancellationTarget(
    '2026/09/05(土) 勤務日種別：平日 よろしくお願いいたします。',
    cancellationRun.queue[0],
  ),
  false,
);

// --- 個人設定 ---
// vm realm 内のオブジェクトはホストと別のプロトタイプを持つため、
// deepEqual の前に JSON へ通して素のオブジェクトへ正規化する。
// localStorage が実際に行う往復と同じ経路なので、検証したい性質は変わらない。
const plain = (value) => JSON.parse(JSON.stringify(value));

const validSettings = {
  version: 2,
  autoSubmitEnabled: true,
};

assert.equal(DEFAULT_USER_SETTINGS.autoSubmitEnabled, false, '自動申請の既定値は false でなければなりません。');
assert.ok(validateUserSettings(DEFAULT_USER_SETTINGS), '既定値は検証を通らなければなりません。');
assert.doesNotMatch(source, /breakEnabled|resolveBreakForShift/, '休憩の設定は廃止しました。');

assert.deepEqual(plain(validateUserSettings(validSettings)), validSettings);

// 余計なキーは落とす
assert.deepEqual(
  plain(validateUserSettings({ ...validSettings, injected: 'x' })),
  validSettings,
);

// 休憩時間を持っていた旧形式（version 1）は、自動申請の選択だけ引き継ぐ
assert.deepEqual(
  plain(validateUserSettings({
    version: 1,
    breakEnabled: true,
    breakStart: { hour: 12, minute: 0 },
    breakEnd: { hour: 13, minute: 0 },
    autoSubmitEnabled: true,
  })),
  { version: 2, autoSubmitEnabled: true },
);

// 不正な値は拒否する
assert.equal(validateUserSettings(null), null);
assert.equal(validateUserSettings({}), null);
assert.equal(validateUserSettings({ ...validSettings, version: 3 }), null);
assert.equal(validateUserSettings({ ...validSettings, autoSubmitEnabled: 1 }), null);

// 保存と読み込み
localStorageStub.clear();
assert.deepEqual(
  plain(loadUserSettings()),
  { version: 2, autoSubmitEnabled: false },
  '未設定のときは既定値（自動申請OFF）を返さなければなりません。',
);

saveUserSettings(validSettings);
assert.deepEqual(plain(loadUserSettings()), validSettings);

assert.throws(() => saveUserSettings({ ...validSettings, autoSubmitEnabled: null }), /不正/);

// 壊れた保存値は既定値（自動申請OFF）にフォールバックする
// vm 内の loadUserSettings が意図どおり console.warn を呼ぶことを確認する。
// 成功時の出力を汚さないよう、この区間だけ warn を差し替える。
const originalWarn = console.warn;
console.warn = () => {};
try {
  localStorageStub.setItem('kot-user-settings-v1', 'not json');
  assert.equal(loadUserSettings().autoSubmitEnabled, false);
  localStorageStub.setItem('kot-user-settings-v1', '{"version":99,"autoSubmitEnabled":true}');
  assert.equal(loadUserSettings().autoSubmitEnabled, false);
} finally {
  console.warn = originalWarn;
}
localStorageStub.clear();

console.log('Shift, date, plan, batch-state, runner-state, cancellation, and settings tests passed.');
