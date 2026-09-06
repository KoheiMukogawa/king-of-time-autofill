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
  'WORK から休憩時間の定数を削除してください。休憩は設定から解決します。',
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
    resolveBreakForShift,
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
  resolveBreakForShift,
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
  version: 1,
  breakEnabled: true,
  breakStart: { hour: 12, minute: 30 },
  breakEnd: { hour: 13, minute: 30 },
  autoSubmitEnabled: false,
};

assert.equal(DEFAULT_USER_SETTINGS.autoSubmitEnabled, false, '自動申請の既定値は false でなければなりません。');
assert.equal(DEFAULT_USER_SETTINGS.breakEnabled, true);
assert.ok(validateUserSettings(DEFAULT_USER_SETTINGS), '既定値は検証を通らなければなりません。');

assert.deepEqual(plain(validateUserSettings(validSettings)), validSettings);

// 余計なキーは落とす
assert.deepEqual(
  plain(validateUserSettings({ ...validSettings, injected: 'x' })),
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
assert.deepEqual(plain(loadUserSettings()), validSettings);

assert.throws(() => saveUserSettings({ ...validSettings, breakEnd: null }), /不正/);

// 壊れた保存値は null にフォールバックする
// vm 内の loadUserSettings が意図どおり console.warn を呼ぶことを確認する。
// 成功時の出力を汚さないよう、この区間だけ warn を差し替える。
const originalWarn = console.warn;
console.warn = () => {};
try {
  localStorageStub.setItem('kot-user-settings-v1', 'not json');
  assert.equal(loadUserSettings(), null);
  localStorageStub.setItem('kot-user-settings-v1', '{"version":99}');
  assert.equal(loadUserSettings(), null);
} finally {
  console.warn = originalWarn;
}
localStorageStub.clear();

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
  plain(resolveBreakForShift(makeShift(9, 18, '9:00～18:00'), noonBreak)),
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
  plain(resolveBreakForShift(makeShift(9, 13, '9:00～13:00'), {
    ...noonBreak,
    breakStart: { hour: 10, minute: 30 },
    breakEnd: { hour: 11, minute: 0 },
  })),
  {
    enabled: true,
    start: { hour: 10, minute: 30, totalMinutes: 630 },
    end: { hour: 11, minute: 0, totalMinutes: 660 },
  },
);

// 休憩なし設定では勤務時間に関わらず休憩を入れない
assert.deepEqual(
  plain(resolveBreakForShift(makeShift(9, 13, '9:00～13:00'), { ...noonBreak, breakEnabled: false })),
  { enabled: false },
);
assert.deepEqual(
  plain(resolveBreakForShift(makeShift(9, 18, '9:00～18:00'), { ...noonBreak, breakEnabled: false })),
  { enabled: false },
);

console.log('Shift, date, plan, batch-state, runner-state, cancellation, and settings tests passed.');
