// ==UserScript==
// @name         KING OF TIME 月間スケジュール申請ヘルパー
// @namespace    local.kot.helper
// @version      0.5.0
// @description  月間計画の申請と、申請履歴からの安全な月単位取消を支援します。
// @match        https://s2.ta.kingoftime.jp/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_VERSION = '0.5.0';
  const DAILY_UI_ID = 'kot-holiday-helper';
  const MONTHLY_UI_ID = 'kot-monthly-preview-helper';
  const BATCH_UI_ID = 'kot-batch-application-helper';
  const RUNNER_UI_ID = 'kot-workday-runner-helper';
  const CANCEL_UI_ID = 'kot-cancellation-helper';
  const CANCEL_RUNNER_UI_ID = 'kot-cancellation-runner';
  const PLAN_STORAGE_KEY = 'kot-schedule-helper-plan-v1';
  const RUN_STORAGE_KEY = 'kot-workday-runner-v1';
  const CANCEL_RUN_STORAGE_KEY = 'kot-cancellation-run-v1';
  const CANCEL_PROOF_STORAGE_KEY = 'kot-cancellation-proof-v1';
  const USER_SETTINGS_STORAGE_KEY = 'kot-user-settings-v1';
  const OPTION_WAIT_TIMEOUT_MS = 10_000;
  const FORM_UPDATE_WAIT_MS = 350;
  const AUTO_SUBMIT_COUNTDOWN_SECONDS = 1;
  const SUCCESS_WAIT_TIMEOUT_MS = 30_000;
  const DIRECT_RETURN_SUCCESS_WINDOW_MS = 120_000;
  const CANCEL_CONFIRMATION_WINDOW_MS = 120_000;
  const SCHEDULE_APPLICATION_TEXT = 'スケジュール申請';
  const UNCONFIRMED_RETURN_PAUSE_MESSAGE = '申請後にタイムカードへ戻りましたが、申請済み状態を確認できません。';
  const OBSERVED_WORK_PATTERNS = new Set([
    '8:00～17:00',
    '8:30～17:30',
    '9:00～18:00',
    '9:30～18:30',
    '10:00～19:00',
  ]);

  const FIELD = Object.freeze({
    pattern: '#select_schedule_pattern_id',
    startDay: '#day_border_time_day',
    startTime: '#schedule_start_time',
    endDay: '#schedule_end_time_day',
    endTime: '#schedule_end_time',
    breakStartDay: '#break_start_time_day1',
    breakStartTime: '#break_start_time_1',
    breakEndDay: '#break_end_time_day1',
    breakEndTime: '#break_end_time_1',
    workDayType: '#select_work_day_type_code',
    leaveType: '#leave_type_code1',
    leaveMode: '#leave_type_mode1',
    remark: '#remark',
  });

  const HOLIDAY = Object.freeze({
    pattern: { preferredValue: '', text: '--' },
    workDayType: { preferredValue: '3', text: '法定外休日' },
    leaveType: { preferredValue: '10_0_0_0', text: '公休' },
    leaveMode: { text: '全日休暇' },
    remark: '全休',
  });

  const WORK = Object.freeze({
    emptyPattern: { preferredValue: '', text: '--' },
    workDayType: { preferredValue: '1', text: '平日' },
    noLeave: { preferredValue: '', text: '--' },
    dayOffset: { preferredValue: '0', text: '当日' },
    remark: 'よろしくお願いいたします。',
  });

  // 未設定の利用者に押し付ける値ではなく、設定画面の初期表示に使う下敷き。
  // 実際に使う設定は必ず loadUserSettings() から取得する。
  const DEFAULT_USER_SETTINGS = Object.freeze({
    version: 1,
    breakEnabled: true,
    breakStart: Object.freeze({ hour: 12, minute: 0 }),
    breakEnd: Object.freeze({ hour: 13, minute: 0 }),
    autoSubmitEnabled: false,
  });

  const BATCH = Object.freeze({
    patternPrefix: 'requestedSchedulePatternList_',
    workDayTypePrefix: 'requested_working_day_type_list_',
    leaveTypePrefix: 'leave_type_code1',
    leaveModePrefix: 'leave_type_mode1',
    holidayWorkDayType: { preferredValue: '3', text: '法定外休日' },
    workWorkDayType: { preferredValue: '1', text: '平日' },
    holidayLeave: { preferredValue: '10_0_0_0_2', text: '公休' },
    unchangedLeave: { preferredValue: '-1', text: '変更なし' },
    deleteLeave: { preferredValue: '', text: '削除' },
    fullDayLeave: { text: '全日休暇' },
    holidayRemark: '全休',
  });

  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  function getElement(selector, Type) {
    const element = document.querySelector(selector);
    return element instanceof Type ? element : null;
  }

  function isScheduleEditPage() {
    return Boolean(
      getElement(FIELD.pattern, HTMLSelectElement)
      && getElement(FIELD.workDayType, HTMLSelectElement)
      && getElement(FIELD.leaveType, HTMLSelectElement)
      && getElement(FIELD.remark, HTMLInputElement)
    );
  }

  function dispatchEditEvents(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findOption(select, { preferredValue, text }) {
    const options = [...select.options];

    if (preferredValue !== undefined) {
      const byValue = options.find((option) => option.value === preferredValue);
      if (byValue) return byValue;
    }

    const expectedText = normalize(text);
    return options.find((option) => normalize(option.textContent) === expectedText) ?? null;
  }

  function setSelectOption(select, target, fieldLabel, { forceEvents = false } = {}) {
    if (select.disabled) {
      throw new Error(`${fieldLabel}が編集できない状態です。`);
    }

    const option = findOption(select, target);
    if (!option) {
      throw new Error(`${fieldLabel}に「${target.text}」が見つかりません。`);
    }

    const changed = select.value !== option.value;
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;

    if (valueSetter) {
      valueSetter.call(select, option.value);
    } else {
      select.value = option.value;
    }

    if (changed || forceEvents) {
      dispatchEditEvents(select);
    }
    return option;
  }

  function setTextInput(input, value, fieldLabel = '入力欄') {
    if (input.disabled || input.readOnly) {
      throw new Error(`${fieldLabel}が編集できない状態です。`);
    }

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    if (valueSetter) {
      valueSetter.call(input, value);
    } else {
      input.value = value;
    }

    dispatchEditEvents(input);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function waitForSelectOption(selector, target, timeoutMs = OPTION_WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearInterval(intervalId);
        clearTimeout(timeoutId);
        observer.disconnect();
        callback(value);
      };

      const inspect = () => {
        const select = getElement(selector, HTMLSelectElement);
        if (select && !select.disabled && findOption(select, target)) {
          finish(resolve, select);
        }
      };

      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true });

      const intervalId = window.setInterval(inspect, 100);
      const timeoutId = window.setTimeout(() => {
        finish(
          reject,
          new Error(`取得単位の「${target.text}」が${timeoutMs / 1000}秒以内に選択可能になりませんでした。`),
        );
      }, timeoutMs);

      inspect();
    });
  }

  function assertSelected(select, target, fieldLabel) {
    const expected = findOption(select, target);
    if (!expected || select.value !== expected.value) {
      throw new Error(`${fieldLabel}を「${target.text}」に設定できませんでした。`);
    }
  }

  function verifyResult() {
    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
    const workDayType = getElement(FIELD.workDayType, HTMLSelectElement);
    const leaveType = getElement(FIELD.leaveType, HTMLSelectElement);
    const leaveMode = getElement(FIELD.leaveMode, HTMLSelectElement);
    const remark = getElement(FIELD.remark, HTMLInputElement);

    if (!pattern || !workDayType || !leaveType || !leaveMode || !remark) {
      throw new Error('入力後の確認中にフォーム項目が見つからなくなりました。');
    }

    assertSelected(pattern, HOLIDAY.pattern, 'パターン');
    assertSelected(workDayType, HOLIDAY.workDayType, '勤務日種別');
    assertSelected(leaveType, HOLIDAY.leaveType, '休暇区分');
    assertSelected(leaveMode, HOLIDAY.leaveMode, '取得単位');

    if (remark.value !== HOLIDAY.remark) {
      throw new Error('申請メッセージを「全休」に設定できませんでした。');
    }
  }

  function validateBeforeEditing(pattern, workDayType, leaveType, remark) {
    const selectFields = [
      [pattern, HOLIDAY.pattern, 'パターン'],
      [workDayType, HOLIDAY.workDayType, '勤務日種別'],
      [leaveType, HOLIDAY.leaveType, '休暇区分'],
    ];

    for (const [select, target, fieldLabel] of selectFields) {
      if (select.disabled) {
        throw new Error(`${fieldLabel}が編集できない状態です。`);
      }
      if (!findOption(select, target)) {
        throw new Error(`${fieldLabel}に「${target.text}」が見つかりません。`);
      }
    }

    if (remark.disabled || remark.readOnly) {
      throw new Error('申請メッセージが編集できない状態です。');
    }
  }

  async function fillHolidayForm() {
    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
    const workDayType = getElement(FIELD.workDayType, HTMLSelectElement);
    const leaveType = getElement(FIELD.leaveType, HTMLSelectElement);
    const remark = getElement(FIELD.remark, HTMLInputElement);

    if (!pattern || !workDayType || !leaveType || !remark) {
      throw new Error('日別のスケジュール申請フォームを確認できません。');
    }

    validateBeforeEditing(pattern, workDayType, leaveType, remark);

    setSelectOption(pattern, HOLIDAY.pattern, 'パターン');
    setSelectOption(workDayType, HOLIDAY.workDayType, '勤務日種別');

    // 「公休」のchange後にKING OF TIME側が取得単位の選択肢を生成する。
    // すでに公休・全日休暇が選択可能なら、不要な再読込を起こさない。
    const currentLeaveMode = getElement(FIELD.leaveMode, HTMLSelectElement);
    const leaveModeIsReady = Boolean(
      currentLeaveMode
      && !currentLeaveMode.disabled
      && findOption(currentLeaveMode, HOLIDAY.leaveMode)
    );
    setSelectOption(
      leaveType,
      HOLIDAY.leaveType,
      '休暇区分',
      { forceEvents: !leaveModeIsReady },
    );
    const leaveMode = await waitForSelectOption(FIELD.leaveMode, HOLIDAY.leaveMode);
    setSelectOption(leaveMode, HOLIDAY.leaveMode, '取得単位');

    setTextInput(remark, HOLIDAY.remark);
    verifyResult();
  }

  function collectDailyDateCandidates(plan) {
    const candidates = new Set();
    const texts = [
      ...[...document.querySelectorAll('h1, h2, h3, h4, caption, time')]
        .map((element) => element.textContent),
      ...[...document.querySelectorAll('#working_edit_form input[type="hidden"]')]
        .flatMap((input) => [input.value, input.name, input.id]),
      document.body.innerText.slice(0, 12_000),
    ];

    const addMatch = (month, day) => {
      const numericMonth = Number(month);
      const numericDay = Number(day);
      if (numericMonth === plan.monthNumber && numericDay >= 1 && numericDay <= 31) {
        candidates.add(numericDay);
      }
    };

    for (const text of texts) {
      const source = String(text ?? '');
      for (const match of source.matchAll(/20\d{2}\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
        addMatch(match[1], match[2]);
      }
      for (const match of source.matchAll(/20\d{2}[/.-](\d{1,2})[/.-](\d{1,2})(?:\D|$)/g)) {
        addMatch(match[1], match[2]);
      }
      for (const match of source.matchAll(/(?:^|\s)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
        addMatch(match[1], match[2]);
      }
      for (const match of source.matchAll(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\D|$)/g)) {
        addMatch(match[1], match[2]);
      }
    }
    return candidates;
  }

  function getPlannedDailyShift() {
    const plan = loadSchedulePlan();
    if (!plan) return null;

    const shiftsByDay = planToShiftMap(plan);
    const detectedDays = [...collectDailyDateCandidates(plan)]
      .filter((day) => shiftsByDay.has(day));
    let day = detectedDays.length === 1 ? detectedDays[0] : null;

    if (
      Number.isInteger(plan.pendingDailyDay)
      && shiftsByDay.has(plan.pendingDailyDay)
      && (detectedDays.length === 0 || detectedDays.includes(plan.pendingDailyDay))
    ) {
      day = plan.pendingDailyDay;
    }

    return day === null ? null : { plan, day, shift: shiftsByDay.get(day) };
  }

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

  function verifyWorkResult(shift, expectedPattern, breakPlan) {
    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
    const startDay = getElement(FIELD.startDay, HTMLSelectElement);
    const startTime = getElement(FIELD.startTime, HTMLInputElement);
    const endDay = getElement(FIELD.endDay, HTMLSelectElement);
    const endTime = getElement(FIELD.endTime, HTMLInputElement);
    const breakStartDay = getElement(FIELD.breakStartDay, HTMLSelectElement);
    const breakStartTime = getElement(FIELD.breakStartTime, HTMLInputElement);
    const breakEndDay = getElement(FIELD.breakEndDay, HTMLSelectElement);
    const breakEndTime = getElement(FIELD.breakEndTime, HTMLInputElement);
    const workDayType = getElement(FIELD.workDayType, HTMLSelectElement);
    const leaveType = getElement(FIELD.leaveType, HTMLSelectElement);
    const remark = getElement(FIELD.remark, HTMLInputElement);

    if (
      !pattern
      || !startDay
      || !startTime
      || !endDay
      || !endTime
      || !breakStartDay
      || !breakStartTime
      || !breakEndDay
      || !breakEndTime
      || !workDayType
      || !leaveType
      || !remark
    ) {
      throw new Error('勤務情報の入力後に確認対象の項目が見つからなくなりました。');
    }

    assertSelected(pattern, expectedPattern, 'パターン');
    assertSelected(startDay, WORK.dayOffset, '出勤予定日');
    assertSelected(endDay, WORK.dayOffset, '退勤予定日');
    if (breakPlan.enabled) {
      assertSelected(breakStartDay, WORK.dayOffset, '休憩開始日');
      assertSelected(breakEndDay, WORK.dayOffset, '休憩終了日');
    }
    assertSelected(workDayType, WORK.workDayType, '勤務日種別');
    assertSelected(leaveType, WORK.noLeave, '休暇区分');

    if (normalizeFormTime(startTime.value) !== formatFormTime(shift.start)) {
      throw new Error(`出勤予定を${formatShiftTime(shift.start)}に設定できませんでした。`);
    }
    if (normalizeFormTime(endTime.value) !== formatFormTime(shift.end)) {
      throw new Error(`退勤予定を${formatShiftTime(shift.end)}に設定できませんでした。`);
    }
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
    if (remark.value !== WORK.remark) {
      throw new Error(`申請メッセージを「${WORK.remark}」に設定できませんでした。`);
    }
  }

  async function fillWorkForm(shift) {
    const settings = loadUserSettings();
    if (!settings) {
      throw new Error(
        '休憩時間の設定が見つかりません。月間スケジュール画面の「設定」で休憩時間を設定してください。',
      );
    }
    const breakPlan = resolveBreakForShift(shift, settings);

    const pattern = getElement(FIELD.pattern, HTMLSelectElement);
    if (!pattern) throw new Error('パターン欄が見つかりません。');

    const matchingPattern = findOption(pattern, { text: shift.label });
    const expectedPattern = matchingPattern
      ? { preferredValue: matchingPattern.value, text: shift.label }
      : WORK.emptyPattern;

    setSelectOption(pattern, expectedPattern, 'パターン', { forceEvents: true });
    await wait(FORM_UPDATE_WAIT_MS);

    const startDay = getElement(FIELD.startDay, HTMLSelectElement);
    const startTime = getElement(FIELD.startTime, HTMLInputElement);
    const endDay = getElement(FIELD.endDay, HTMLSelectElement);
    const endTime = getElement(FIELD.endTime, HTMLInputElement);
    const breakStartDay = getElement(FIELD.breakStartDay, HTMLSelectElement);
    const breakStartTime = getElement(FIELD.breakStartTime, HTMLInputElement);
    const breakEndDay = getElement(FIELD.breakEndDay, HTMLSelectElement);
    const breakEndTime = getElement(FIELD.breakEndTime, HTMLInputElement);
    const workDayType = getElement(FIELD.workDayType, HTMLSelectElement);
    const leaveType = getElement(FIELD.leaveType, HTMLSelectElement);
    const remark = getElement(FIELD.remark, HTMLInputElement);
    if (
      !startDay
      || !startTime
      || !endDay
      || !endTime
      || !breakStartDay
      || !breakStartTime
      || !breakEndDay
      || !breakEndTime
      || !workDayType
      || !leaveType
      || !remark
    ) {
      throw new Error('勤務予定・休憩予定・申請メッセージの入力欄を確認できません。');
    }

    setSelectOption(startDay, WORK.dayOffset, '出勤予定日');
    setTextInput(startTime, formatFormTime(shift.start), '出勤予定');
    setSelectOption(endDay, WORK.dayOffset, '退勤予定日');
    setTextInput(endTime, formatFormTime(shift.end), '退勤予定');
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
    setSelectOption(workDayType, WORK.workDayType, '勤務日種別');
    setSelectOption(leaveType, WORK.noLeave, '休暇区分');
    setTextInput(remark, WORK.remark, '申請メッセージ');

    verifyWorkResult(shift, expectedPattern, breakPlan);

    return { breakPlan, expectedPattern, settings };
  }

  function createDailyHelper() {
    if (document.getElementById(DAILY_UI_ID) || !isScheduleEditPage()) return;

    const planned = getPlannedDailyShift();

    const container = document.createElement('div');
    container.id = DAILY_UI_ID;
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      width: 'min(320px, calc(100vw - 32px))',
      padding: '12px',
      border: '1px solid #c8d0d9',
      borderRadius: '10px',
      background: '#fff',
      color: '#17212b',
      boxShadow: '0 8px 28px rgba(0, 0, 0, .2)',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    });

    const title = document.createElement('div');
    title.textContent = `KOT 日別スケジュール入力ヘルパー v${SCRIPT_VERSION}`;
    Object.assign(title.style, {
      marginBottom: '8px',
      fontSize: '14px',
      fontWeight: '700',
    });

    const planInfo = document.createElement('div');
    Object.assign(planInfo.style, {
      marginBottom: '8px',
      padding: '7px 8px',
      borderRadius: '6px',
      background: planned ? '#eaf4ff' : '#f4f6f8',
      fontSize: '12px',
      lineHeight: '1.45',
    });
    planInfo.textContent = planned
      ? `保存計画：${planned.plan.month} ${planned.day}日 ${planned.shift.label}`
      : 'この日と一致する勤務予定は保存計画にありません。';

    const makeButton = (text, background) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      Object.assign(button.style, {
        width: '100%',
        marginTop: '6px',
        padding: '9px 12px',
        border: '0',
        borderRadius: '7px',
        background,
        color: '#fff',
        fontWeight: '700',
        cursor: 'pointer',
      });
      return button;
    };

    const workButton = planned
      ? makeButton(`勤務情報を入力（${planned.shift.label}）`, '#1668c1')
      : null;
    const holidayButton = makeButton('休日情報を入力', '#52616f');
    Object.assign(holidayButton.style, {
      width: '100%',
      marginTop: planned ? '6px' : '0',
    });

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    Object.assign(status.style, {
      minHeight: '2.8em',
      marginTop: '8px',
      fontSize: '12px',
      lineHeight: '1.4',
    });
    status.textContent = 'ボタンを押しても申請は送信されません。';

    const runWithStatus = async (button, operation, successMessage) => {
      button.disabled = true;
      button.style.cursor = 'wait';
      button.style.opacity = '.7';
      status.style.color = '#17212b';
      status.textContent = '入力しています…';

      try {
        await operation();
        status.style.color = '#137333';
        status.textContent = successMessage;
      } catch (error) {
        console.error('[KOT日別入力ヘルパー]', error);
        status.style.color = '#b3261e';
        status.textContent = `入力を完了できませんでした。一部項目が変更されている可能性があります：${error.message}`;
      } finally {
        button.disabled = false;
        button.style.cursor = 'pointer';
        button.style.opacity = '1';
      }
    };

    if (workButton) {
      workButton.addEventListener('click', async () => {
        const dailySettings = loadUserSettings();
        if (!dailySettings) {
          status.style.color = '#b3261e';
          status.textContent = '休憩時間の設定が見つかりません。月間スケジュール画面の「設定」で休憩時間を設定してください。';
          return;
        }
        const dailyBreakSummary = describeBreakSummary(dailySettings);
        const approved = window.confirm(
          `${planned.day}日のフォームへ勤務時間 ${planned.shift.label}、休憩${dailyBreakSummary}、申請メッセージを入力します。\n`
          + 'KING OF TIMEの申請ボタンは自動で押しません。よろしいですか？',
        );
        if (!approved) return;
        await runWithStatus(
          workButton,
          () => fillWorkForm(planned.shift),
          `勤務時間・休憩${dailyBreakSummary}・申請メッセージを入力しました。内容を確認してからサイトの申請ボタンを押してください。`,
        );
      });
    }

    holidayButton.addEventListener('click', async () => {
      const approved = window.confirm(
        '現在のフォーム内容を休日情報に置き換えます。よろしいですか？\n'
        + 'KING OF TIMEの申請ボタンは自動で押しません。',
      );
      if (!approved) return;
      await runWithStatus(
        holidayButton,
        fillHolidayForm,
        '休日情報を入力しました。内容を確認してから、サイトの申請ボタンを押してください。',
      );
    });

    container.append(title, planInfo);
    if (workButton) container.appendChild(workButton);
    container.append(holidayButton, status);
    document.body.appendChild(container);
  }

  function getControlText(control) {
    if (control instanceof HTMLInputElement) {
      return normalize(control.value || control.getAttribute('aria-label'));
    }
    return normalize(
      control.textContent
      || control.getAttribute('aria-label')
      || control.getAttribute('title'),
    );
  }

  function findScheduleApplicationControls() {
    const selector = 'button, a, input[type="button"], input[type="submit"]';
    return [...document.querySelectorAll(selector)].filter((control) => {
      if (control.closest(`#${DAILY_UI_ID}, #${MONTHLY_UI_ID}`)) return false;
      return getControlText(control).includes(SCHEDULE_APPLICATION_TEXT);
    });
  }

  function toYearMonthValue(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  function parseYearMonth(text) {
    const source = String(text ?? '');
    const patterns = [
      /(?:^|\D)(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月/,
      /(?:^|\D)(20\d{2})[/.\-](1[0-2]|0?[1-9])(?:\D|$)/,
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) {
        return {
          year: Number(match[1]),
          month: Number(match[2]),
          value: toYearMonthValue(Number(match[1]), Number(match[2])),
        };
      }
    }

    return null;
  }

  function detectTargetMonth() {
    const monthInput = document.querySelector('input[type="month"]');
    const fromMonthInput = parseYearMonth(monthInput?.value);
    if (fromMonthInput) return { ...fromMonthInput, confident: true };

    const headingTexts = [...document.querySelectorAll('h1, h2, h3, h4, caption')]
      .map((element) => element.textContent);
    const selectedTexts = [...document.querySelectorAll('select')]
      .map((select) => select.options[select.selectedIndex]?.textContent);
    const dateInputValues = [...document.querySelectorAll('input[type="date"]')]
      .map((input) => input.value);
    const candidates = [
      document.title,
      location.href,
      ...headingTexts,
      ...selectedTexts,
      ...dateInputValues,
      document.body.innerText.slice(0, 6000),
    ];

    for (const candidate of candidates) {
      const parsed = parseYearMonth(candidate);
      if (parsed) return { ...parsed, confident: true };
    }

    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      value: toYearMonthValue(now.getFullYear(), now.getMonth() + 1),
      confident: false,
    };
  }

  function parseMonthInput(value) {
    const match = String(value).match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
    if (!match) {
      throw new Error('対象月を正しく入力してください。');
    }
    return { year: Number(match[1]), month: Number(match[2]), value };
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function parseWorkDays(rawValue, lastDay) {
    const normalizedValue = String(rawValue)
      .replace(/[、，]/g, ',')
      .replace(/[〜～]/g, '-');
    const tokens = normalizedValue.split(/[\s,]+/).filter(Boolean);
    const result = new Set();

    for (const token of tokens) {
      const single = token.match(/^\d{1,2}$/);
      if (single) {
        const day = Number(token);
        if (day < 1 || day > lastDay) {
          throw new Error(`${day}日は対象月に存在しません。`);
        }
        result.add(day);
        continue;
      }

      const range = token.match(/^(\d{1,2})-(\d{1,2})$/);
      if (range) {
        const first = Number(range[1]);
        const last = Number(range[2]);
        if (first < 1 || last > lastDay || first > last) {
          throw new Error(`範囲「${token}」を確認してください。`);
        }
        for (let day = first; day <= last; day += 1) result.add(day);
        continue;
      }

      throw new Error(`「${token}」を日付として解釈できません。`);
    }

    return [...result].sort((a, b) => a - b);
  }

  function normalizeShiftInput(value) {
    return String(value ?? '')
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0))
      .replace(/：/g, ':')
      .replace(/[、，]/g, ',')
      .replace(/[〜～－―\u2014\u2013]/g, '-')
      .replace(/から/g, '-')
      .replace(/[；;]/g, '\n')
      .replace(/\u3000/g, ' ')
      .trim();
  }

  function parseTimeToken(rawToken, lineNumber) {
    const token = rawToken.replace(/\s+/g, '');
    const match = token.match(/^(\d{1,2})(?::(\d{1,2})|時(?:(\d{1,2})分?)?)?$/);
    if (!match) {
      throw new Error(`${lineNumber}行目の時刻「${rawToken}」を解釈できません。`);
    }

    const hour = Number(match[1]);
    const minute = Number(match[2] ?? match[3] ?? 0);
    if (hour > 23 || minute > 59) {
      throw new Error(`${lineNumber}行目の時刻「${rawToken}」を確認してください。`);
    }

    return { hour, minute, totalMinutes: (hour * 60) + minute };
  }

  function formatShiftTime(time) {
    return `${time.hour}:${String(time.minute).padStart(2, '0')}`;
  }

  // 画面に見せる休憩の要約。設定が未保存・破損のときは「なし」と区別する。
  // 「休憩をとらない」と「設定が読めない」は利用者にとって別の事実のため。
  function describeBreakSummary(settings) {
    if (!settings) return '未設定';
    if (!settings.breakEnabled) return 'なし';
    return `${formatShiftTime(settings.breakStart)}～${formatShiftTime(settings.breakEnd)}`;
  }

  function parseTimeRange(rawValue, lineNumber) {
    const parts = rawValue.split('-').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(`${lineNumber}行目は「7時～16時」のように入力してください。`);
    }

    const start = parseTimeToken(parts[0], lineNumber);
    const end = parseTimeToken(parts[1], lineNumber);
    if (end.totalMinutes <= start.totalMinutes) {
      throw new Error(`${lineNumber}行目は終了時刻を開始時刻より後にしてください。`);
    }

    return {
      start,
      end,
      label: `${formatShiftTime(start)}～${formatShiftTime(end)}`,
    };
  }

  function parseShiftSchedule(rawValue, lastDay) {
    const source = normalizeShiftInput(rawValue);
    if (!source) {
      throw new Error('当月のシフトを入力してください。');
    }
    if (/^(?:なし|出勤なし)$/.test(source)) return new Map();

    const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const shiftsByDay = new Map();

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let daysPart;
      let timePart;

      const withDaySuffix = line.match(/^(.+?日)\s*(.+)$/);
      if (withDaySuffix) {
        [, daysPart, timePart] = withDaySuffix;
      } else {
        const withSpace = line.match(/^(\S+)\s+(.+)$/);
        if (!withSpace) {
          throw new Error(`${lineNumber}行目は「1,2,3日 7時～16時」のように入力してください。`);
        }
        [, daysPart, timePart] = withSpace;
      }

      const days = parseWorkDays(daysPart.replace(/日/g, ''), lastDay);
      if (days.length === 0) {
        throw new Error(`${lineNumber}行目に出勤日がありません。`);
      }
      const timeRange = parseTimeRange(timePart, lineNumber);

      for (const day of days) {
        const existing = shiftsByDay.get(day);
        if (existing && existing.label !== timeRange.label) {
          throw new Error(`${day}日に異なる勤務時間が重複しています。`);
        }
        shiftsByDay.set(day, timeRange);
      }
    });

    return new Map([...shiftsByDay].sort(([dayA], [dayB]) => dayA - dayB));
  }

  function createSchedulePlan(targetMonth, rawValue, shiftsByDay) {
    return {
      schemaVersion: 1,
      month: targetMonth.value,
      year: targetMonth.year,
      monthNumber: targetMonth.month,
      sourceText: String(rawValue ?? '').trim(),
      createdAt: new Date().toISOString(),
      pendingDailyDay: null,
      shifts: [...shiftsByDay].map(([day, shift]) => ({
        day,
        label: shift.label,
        startHour: shift.start.hour,
        startMinute: shift.start.minute,
        endHour: shift.end.hour,
        endMinute: shift.end.minute,
      })),
    };
  }

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

  function validateStoredPlan(plan) {
    if (!plan || plan.schemaVersion !== 1) return null;
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(plan.month)) return null;
    if (!Number.isInteger(plan.year) || !Number.isInteger(plan.monthNumber)) return null;
    if (!Array.isArray(plan.shifts)) return null;

    const lastDay = getDaysInMonth(plan.year, plan.monthNumber);
    const seenDays = new Set();
    for (const shift of plan.shifts) {
      const valid = Number.isInteger(shift.day)
        && shift.day >= 1
        && shift.day <= lastDay
        && Number.isInteger(shift.startHour)
        && shift.startHour >= 0
        && shift.startHour <= 23
        && Number.isInteger(shift.startMinute)
        && shift.startMinute >= 0
        && shift.startMinute <= 59
        && Number.isInteger(shift.endHour)
        && shift.endHour >= 0
        && shift.endHour <= 23
        && Number.isInteger(shift.endMinute)
        && shift.endMinute >= 0
        && shift.endMinute <= 59
        && typeof shift.label === 'string'
        && !seenDays.has(shift.day);
      if (!valid) return null;
      seenDays.add(shift.day);
    }
    return plan;
  }

  function saveSchedulePlan(plan) {
    const validPlan = validateStoredPlan(plan);
    if (!validPlan) throw new Error('保存しようとした月間計画が不正です。');
    sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(validPlan));
  }

  function loadSchedulePlan() {
    try {
      const rawValue = sessionStorage.getItem(PLAN_STORAGE_KEY);
      return rawValue ? validateStoredPlan(JSON.parse(rawValue)) : null;
    } catch (error) {
      console.warn('[KOT月間入力ヘルパー] 保存計画を読み込めませんでした。', error);
      return null;
    }
  }

  function planToShiftMap(plan) {
    return new Map(plan.shifts.map((storedShift) => {
      const start = {
        hour: storedShift.startHour,
        minute: storedShift.startMinute,
        totalMinutes: (storedShift.startHour * 60) + storedShift.startMinute,
      };
      const end = {
        hour: storedShift.endHour,
        minute: storedShift.endMinute,
        totalMinutes: (storedShift.endHour * 60) + storedShift.endMinute,
      };
      return [storedShift.day, { start, end, label: storedShift.label }];
    }));
  }

  function formatFormTime(time) {
    return `${String(time.hour).padStart(2, '0')}${String(time.minute).padStart(2, '0')}`;
  }

  function normalizeFormTime(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length === 3 ? `0${digits}` : digits;
  }

  const RUN_STATUSES = new Set([
    'ready',
    'opening',
    'filling',
    'ready-to-submit',
    'submitting',
    'returning',
    'paused',
    'complete',
  ]);

  function createWorkdayRun(plan, queue) {
    return {
      schemaVersion: 1,
      runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      month: plan.month,
      queue: [...queue],
      currentIndex: 0,
      currentDay: null,
      status: 'ready',
      completedDays: [],
      skippedDays: [],
      failures: [],
      submissionAttempt: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function validateWorkdayRun(run) {
    if (!run || run.schemaVersion !== 1 || typeof run.runId !== 'string') return null;
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(run.month)) return null;
    if (!Array.isArray(run.queue) || !RUN_STATUSES.has(run.status)) return null;
    if (!Number.isInteger(run.currentIndex) || run.currentIndex < 0 || run.currentIndex > run.queue.length) {
      return null;
    }
    const uniqueDays = new Set();
    for (const day of run.queue) {
      if (!Number.isInteger(day) || day < 1 || day > 31 || uniqueDays.has(day)) return null;
      uniqueDays.add(day);
    }
    if (run.currentDay !== null && !uniqueDays.has(run.currentDay)) return null;
    if (!Array.isArray(run.completedDays) || !Array.isArray(run.skippedDays) || !Array.isArray(run.failures)) {
      return null;
    }
    if (run.submissionAttempt !== undefined && run.submissionAttempt !== null) {
      const attempt = run.submissionAttempt;
      if (
        typeof attempt !== 'object'
        || !Number.isInteger(attempt.day)
        || attempt.day < 1
        || attempt.day > 31
        || typeof attempt.shiftLabel !== 'string'
        || !Number.isFinite(attempt.startedAt)
      ) {
        return null;
      }
    }
    return run;
  }

  function createSubmissionAttempt(day, shift, startedAt = Date.now()) {
    return {
      day,
      shiftLabel: shift.label,
      startedAt,
    };
  }

  function hasRecentMatchingSubmissionAttempt(run, day, shift, now = Date.now()) {
    const attempt = run?.submissionAttempt;
    if (
      run?.status !== 'submitting'
      || run.currentDay !== day
      || !attempt
      || attempt.day !== day
      || attempt.shiftLabel !== shift?.label
    ) {
      return false;
    }
    const elapsed = now - attempt.startedAt;
    return elapsed >= 0 && elapsed <= DIRECT_RETURN_SUCCESS_WINDOW_MS;
  }

  function canManuallyConfirmPausedSubmission(run) {
    return Boolean(
      run
      && run.status === 'paused'
      && run.currentDay === getCurrentRunDay(run)
      && run.pauseMessage === UNCONFIRMED_RETURN_PAUSE_MESSAGE
    );
  }

  function saveWorkdayRun(run) {
    const nextRun = { ...run, updatedAt: new Date().toISOString() };
    if (!validateWorkdayRun(nextRun)) throw new Error('連続申請の進行状態が不正です。');
    sessionStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(nextRun));
    return nextRun;
  }

  function loadWorkdayRun() {
    try {
      const rawValue = sessionStorage.getItem(RUN_STORAGE_KEY);
      return rawValue ? validateWorkdayRun(JSON.parse(rawValue)) : null;
    } catch (error) {
      console.warn('[KOT勤務日連続申請] 進行状態を読み込めませんでした。', error);
      return null;
    }
  }

  function pauseWorkdayRun(message) {
    const run = loadWorkdayRun();
    if (!run || run.status === 'complete') return run;
    return saveWorkdayRun({
      ...run,
      status: 'paused',
      pauseMessage: String(message ?? 'ユーザー操作で停止しました。'),
    });
  }

  function getCurrentRunDay(run) {
    return run.queue[run.currentIndex] ?? null;
  }

  function addUniqueDay(days, day) {
    return days.includes(day) ? [...days] : [...days, day].sort((a, b) => a - b);
  }

  function setPlanPendingDay(plan, day) {
    const nextPlan = { ...plan, pendingDailyDay: day };
    saveSchedulePlan(nextPlan);
    return nextPlan;
  }

  function parseDayCandidate(text, targetMonth) {
    const source = normalize(text);
    if (!source) return null;

    let match = source.match(/(?:^|\D)(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (!match) {
      match = source.match(/(?:^|\D)(20\d{2})[/.\-](\d{1,2})[/.\-](\d{1,2})(?:\D|$)/);
    }
    if (match) {
      const [, year, month, day] = match.map(Number);
      if (year !== targetMonth.year || month !== targetMonth.month) return null;
      return day;
    }

    match = source.match(/(?:^|\D)(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (!match) {
      match = source.match(/(?:^|\D)(\d{1,2})[/.\-](\d{1,2})(?:\D|$)/);
    }
    if (match) {
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month !== targetMonth.month) return null;
      return day;
    }

    match = source.match(/(?:^|\D)(\d{1,2})\s*日(?:\D|$)/);
    if (match) return Number(match[1]);

    match = source.match(/^\D*?(\d{1,2})\s*(?:\(|（|[日月火水木金土](?:曜)?)/);
    return match ? Number(match[1]) : null;
  }

  function getDayContainer(control) {
    const row = control.closest('tr, [role="row"], li');
    if (row) return row;

    let current = control.parentElement;
    for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
      const buttons = [...current.querySelectorAll('button, a, input[type="button"]')]
        .filter((element) => getControlText(element).includes(SCHEDULE_APPLICATION_TEXT));
      if (buttons.length === 1) return current;
      current = current.parentElement;
    }

    return control.parentElement;
  }

  function extractDayFromControl(control, targetMonth) {
    const container = getDayContainer(control);
    const candidates = [];

    for (const element of [control, container].filter(Boolean)) {
      for (const attribute of ['data-date', 'data-day', 'datetime', 'title', 'aria-label']) {
        const value = element.getAttribute?.(attribute);
        if (value) candidates.push(value);
      }
    }

    if (container) {
      const datedElements = [...container.querySelectorAll('[data-date], [data-day], time[datetime]')]
        .slice(0, 10);
      for (const element of datedElements) {
        candidates.push(
          element.getAttribute('data-date'),
          element.getAttribute('data-day'),
          element.getAttribute('datetime'),
          element.textContent,
        );
      }

      const cells = [...container.querySelectorAll(':scope > th, :scope > td, th, td')]
        .slice(0, 3);
      candidates.push(...cells.map((cell) => cell.textContent));
      candidates.push(container.textContent);
    }

    for (const candidate of candidates) {
      const day = parseDayCandidate(candidate, targetMonth);
      if (day !== null) return day;
    }

    const idMatch = String(control.id).match(/(?:schdule|schedule).*?([0-3]\d)$/i);
    return idMatch ? Number(idMatch[1]) : null;
  }

  function isUnavailableControl(control) {
    return Boolean(
      control.disabled
      || control.getAttribute('aria-disabled') === 'true'
      || control.classList.contains('disabled')
    );
  }

  function buildScheduleControlMap(targetMonth, lastDay) {
    const controls = findScheduleApplicationControls();
    const controlsByDay = new Map();
    const unresolved = [];
    const duplicates = new Set();

    for (const control of controls) {
      const day = extractDayFromControl(control, targetMonth);
      if (!Number.isInteger(day) || day < 1 || day > lastDay) {
        unresolved.push(control);
        continue;
      }

      if (controlsByDay.has(day)) {
        duplicates.add(day);
        const current = controlsByDay.get(day);
        if (isUnavailableControl(current) && !isUnavailableControl(control)) {
          controlsByDay.set(day, control);
        }
      } else {
        controlsByDay.set(day, control);
      }
    }

    return { controls, controlsByDay, unresolved, duplicates };
  }

  function formatDay(year, month, day) {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const weekday = weekdays[new Date(year, month - 1, day).getDay()];
    return `${month}/${day}(${weekday})`;
  }

  function getRunnerProgressText(run) {
    const total = run.queue.length;
    const finished = Math.min(run.currentIndex, total);
    return `${finished}/${total}日完了`;
  }

  function updateRunnerOverlay(message, color = '#17212b') {
    let container = document.getElementById(RUNNER_UI_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = RUNNER_UI_ID;
      Object.assign(container.style, {
        position: 'fixed',
        right: '16px',
        top: '16px',
        zIndex: '2147483647',
        width: 'min(360px, calc(100vw - 32px))',
        padding: '12px',
        border: '2px solid #1668c1',
        borderRadius: '10px',
        background: '#fff',
        color: '#17212b',
        boxShadow: '0 8px 28px rgba(0, 0, 0, .24)',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
      });

      const title = document.createElement('div');
      title.textContent = `KOT 出勤日連続申請 v${SCRIPT_VERSION}`;
      Object.assign(title.style, {
        marginBottom: '6px',
        fontSize: '14px',
        fontWeight: '700',
      });

      const status = document.createElement('div');
      status.dataset.role = 'runner-status';
      status.setAttribute('role', 'status');
      Object.assign(status.style, {
        fontSize: '12px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
      });

      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.dataset.role = 'runner-stop';
      stopButton.textContent = '連続申請を停止';
      Object.assign(stopButton.style, {
        width: '100%',
        marginTop: '8px',
        padding: '7px 10px',
        border: '1px solid #b3261e',
        borderRadius: '6px',
        background: '#fff',
        color: '#b3261e',
        fontWeight: '700',
        cursor: 'pointer',
      });
      stopButton.addEventListener('click', () => {
        const stoppedRun = pauseWorkdayRun('ユーザー操作で停止しました。');
        status.style.color = '#b3261e';
        status.textContent = stoppedRun
          ? `${getRunnerProgressText(stoppedRun)}。連続申請を停止しました。現在の画面は自動送信しません。`
          : '連続申請を停止しました。';
        stopButton.disabled = true;
      });

      container.append(title, status, stopButton);
      document.body.appendChild(container);
    }

    const status = container.querySelector('[data-role="runner-status"]');
    if (status) {
      status.style.color = color;
      status.textContent = message;
    }
    syncRunnerRecoveryAction(container);
    return container;
  }

  function syncRunnerRecoveryAction(container) {
    const existing = container.querySelector('[data-role="runner-confirm-submitted"]');
    const run = loadWorkdayRun();
    if (!canManuallyConfirmPausedSubmission(run)) {
      existing?.remove();
      return;
    }
    if (existing) return;

    const day = getCurrentRunDay(run);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.role = 'runner-confirm-submitted';
    button.textContent = `${day}日の履歴確認済み・次へ`;
    Object.assign(button.style, {
      width: '100%',
      marginTop: '8px',
      padding: '7px 10px',
      border: '1px solid #1668c1',
      borderRadius: '6px',
      background: '#1668c1',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });
    button.addEventListener('click', () => {
      const currentRun = loadWorkdayRun();
      if (!canManuallyConfirmPausedSubmission(currentRun)) {
        button.remove();
        return;
      }
      const currentDay = getCurrentRunDay(currentRun);
      const confirmed = window.confirm(
        `${currentDay}日の申請履歴に「申請をキャンセル」と、`
        + '予定時間・休憩・申請メッセージが正しく表示されていることを確認しましたか？',
      );
      if (!confirmed) return;

      const resumeSettings = loadUserSettings();
      if (!resumeSettings?.autoSubmitEnabled) {
        pauseWorkdayRun('連続申請の設定がOFFになったため停止しました。続けるには設定でONにしてください。');
        updateRunnerOverlay(
          '連続申請の設定がOFFになったため停止しました。続けるには設定でONにしてください。',
          '#b3261e',
        );
        return;
      }

      let resumedRun = completeCurrentRunDay(currentRun, currentDay);
      const plan = loadSchedulePlan();
      const shift = plan?.month === resumedRun.month
        ? planToShiftMap(plan).get(currentDay)
        : null;
      const onDailyApplicationPage = isScheduleEditPage()
        || Boolean(shift && pageShowsSuccessfulWorkApplication(shift));

      if (onDailyApplicationPage) {
        returnFromDailyApplication(resumedRun);
        return;
      }
      if (!isBatchApplicationPage() && findScheduleApplicationControls().length > 0) {
        resumedRun = saveWorkdayRun({ ...resumedRun, status: 'ready', currentDay: null });
        updateRunnerOverlay(`${getRunnerProgressText(resumedRun)}。${currentDay}日を履歴確認済みとして次へ進みます…`);
        window.setTimeout(handleMonthlyWorkdayRun, 500);
        return;
      }
      updateRunnerOverlay(
        `${getRunnerProgressText(resumedRun)}。${currentDay}日を履歴確認済みにしました。\nタイムカードへ戻ると次へ進みます。`,
        '#9a5700',
      );
    });

    const stopButton = container.querySelector('[data-role="runner-stop"]');
    container.insertBefore(button, stopButton ?? null);
  }

  function setRunnerOverlayFinished(message, color = '#137333') {
    const container = updateRunnerOverlay(message, color);
    container.querySelector('[data-role="runner-confirm-submitted"]')?.remove();
    const stopButton = container.querySelector('[data-role="runner-stop"]');
    if (stopButton) {
      const closeButton = stopButton.cloneNode(true);
      closeButton.textContent = '閉じる';
      closeButton.disabled = false;
      closeButton.style.borderColor = '#aeb8c2';
      closeButton.style.color = '#17212b';
      closeButton.addEventListener('click', () => container.remove());
      stopButton.replaceWith(closeButton);
    }
  }

  function findDailySubmitControl() {
    const candidates = [...document.querySelectorAll('button#button_01')].filter((button) => (
      getControlText(button) === SCHEDULE_APPLICATION_TEXT && !button.disabled
    ));
    if (!candidates.length) return null;
    const visible = candidates.filter((button) => button.getClientRects().length > 0);
    return (visible.length ? visible : candidates).at(-1) ?? null;
  }

  function findDailyBackControl() {
    const preferred = document.querySelector('#button_03');
    if (preferred && getControlText(preferred) === '戻る' && !preferred.disabled) return preferred;
    const candidates = [...document.querySelectorAll(
      'button, a, input[type="button"]',
    )].filter((control) => getControlText(control) === '戻る' && !control.disabled);
    const visible = candidates.filter((control) => control.getClientRects().length > 0);
    return (visible.length ? visible : candidates)[0] ?? null;
  }

  function getHistoryTimeLabel(time) {
    return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  }

  function pageShowsSuccessfulWorkApplication(shift) {
    const pageText = normalize(document.body.innerText)
      .replace(/[〜～]/g, '-')
      .replace(/\s*-\s*/g, '-');
    const timeRange = `${getHistoryTimeLabel(shift.start)}-${getHistoryTimeLabel(shift.end)}`;
    return /申請をキャンセル|承認済み?/.test(pageText)
      && pageText.includes(timeRange)
      && pageText.includes(WORK.remark);
  }

  async function waitForSuccessfulWorkApplication(shift, timeoutMs = SUCCESS_WAIT_TIMEOUT_MS) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
      if (pageShowsSuccessfulWorkApplication(shift)) return true;
      const run = loadWorkdayRun();
      if (!run || run.status !== 'submitting') return false;
      await wait(300);
    }
    return false;
  }

  function completeCurrentRunDay(run, day) {
    const nextIndex = run.currentIndex + 1;
    const nextRun = saveWorkdayRun({
      ...run,
      currentIndex: nextIndex,
      currentDay: day,
      status: 'returning',
      completedDays: addUniqueDay(run.completedDays, day),
      pauseMessage: null,
      submissionAttempt: null,
    });
    const plan = loadSchedulePlan();
    if (plan?.month === run.month) setPlanPendingDay(plan, null);
    return nextRun;
  }

  function skipCurrentRunDay(run, day, reason) {
    return saveWorkdayRun({
      ...run,
      currentIndex: run.currentIndex + 1,
      currentDay: day,
      status: 'ready',
      skippedDays: addUniqueDay(run.skippedDays, day),
      failures: [...run.failures, { day, message: String(reason) }],
    });
  }

  function returnFromDailyApplication(run) {
    const backControl = findDailyBackControl();
    if (!backControl) {
      updateRunnerOverlay(
        `${getRunnerProgressText(run)}。申請成功を確認しました。\n「戻る」でタイムカードへ戻ると続行します。`,
        '#9a5700',
      );
      return false;
    }
    updateRunnerOverlay(`${getRunnerProgressText(run)}。申請成功。タイムカードへ戻ります…`);
    window.setTimeout(() => backControl.click(), 600);
    return true;
  }

  function dayContainerShowsExistingApplication(control) {
    const containerText = normalize(getDayContainer(control)?.textContent);
    return /申請中|申請済|承認待ち|承認済/.test(containerText);
  }

  async function handleDailyWorkdayRun() {
    let run = loadWorkdayRun();
    const plan = loadSchedulePlan();
    if (!run || run.status === 'complete') return false;
    if (run.status === 'paused') {
      updateRunnerOverlay(
        `${getRunnerProgressText(run)}。停止中：${run.pauseMessage ?? '理由なし'}`,
        '#b3261e',
      );
      return true;
    }
    if (!plan || plan.month !== run.month) {
      pauseWorkdayRun('保存計画が見つからないか、対象月が一致しません。');
      updateRunnerOverlay('保存計画を確認できないため停止しました。', '#b3261e');
      return true;
    }

    const day = getCurrentRunDay(run);
    const shift = day === null ? null : planToShiftMap(plan).get(day);
    if (day === null || !shift) {
      pauseWorkdayRun('処理対象日の勤務計画が見つかりません。');
      updateRunnerOverlay('勤務計画を確認できないため停止しました。', '#b3261e');
      return true;
    }

    if (pageShowsSuccessfulWorkApplication(shift)) {
      run = completeCurrentRunDay(run, day);
      returnFromDailyApplication(run);
      return true;
    }

    if (run.status === 'submitting') {
      pauseWorkdayRun('申請送信後の成功表示を確認できませんでした。');
      updateRunnerOverlay(
        `${day}日の申請成功を確認できないため停止しました。画面のエラーを確認してください。`,
        '#b3261e',
      );
      return true;
    }
    if (run.status !== 'opening') {
      pauseWorkdayRun(`日別画面で想定外の状態（${run.status}）になりました。`);
      updateRunnerOverlay(`${day}日の再送信を防ぐため停止しました。`, '#b3261e');
      return true;
    }

    const planned = getPlannedDailyShift();
    if (!planned || planned.day !== day || planned.shift.label !== shift.label) {
      pauseWorkdayRun('開いた日付と連続申請の対象日が一致しません。');
      updateRunnerOverlay(
        `${day}日ではない可能性があるため停止しました。日付を確認してください。`,
        '#b3261e',
      );
      return true;
    }

    run = saveWorkdayRun({ ...run, status: 'filling', currentDay: day });
    updateRunnerOverlay(
      `${getRunnerProgressText(run)}。${day}日 ${shift.label} を入力・検証しています…`,
    );
    let filled;
    try {
      filled = await fillWorkForm(shift);
    } catch (error) {
      pauseWorkdayRun(`${day}日の入力に失敗：${error.message}`);
      updateRunnerOverlay(`${day}日の入力に失敗したため停止しました：${error.message}`, '#b3261e');
      return true;
    }

    run = saveWorkdayRun({ ...run, status: 'ready-to-submit' });
    const runnerBreakSummary = describeBreakSummary(filled.settings);
    for (let seconds = AUTO_SUBMIT_COUNTDOWN_SECONDS; seconds > 0; seconds -= 1) {
      updateRunnerOverlay(
        `${getRunnerProgressText(run)}。${day}日 ${shift.label}\n休憩${runnerBreakSummary}・メッセージ入力済み。${seconds}秒後に実際の申請を送信します。`,
        '#9a5700',
      );
      await wait(1_000);
      const currentRun = loadWorkdayRun();
      if (!currentRun || currentRun.runId !== run.runId || currentRun.status !== 'ready-to-submit') {
        return true;
      }
      run = currentRun;
    }

    const submitControl = findDailySubmitControl();
    if (!submitControl) {
      pauseWorkdayRun(`${day}日のスケジュール申請ボタンが見つかりません。`);
      updateRunnerOverlay('申請ボタンを確認できないため停止しました。', '#b3261e');
      return true;
    }

    // 直前まで別タブで設定をOFFにされている可能性があるため、送信の瞬間に読み直す。
    const submitTimeSettings = loadUserSettings();
    if (!submitTimeSettings?.autoSubmitEnabled) {
      pauseWorkdayRun('連続申請の設定がOFFになったため停止しました。続けるには設定でONにしてください。');
      updateRunnerOverlay(
        '連続申請の設定がOFFになったため停止しました。続けるには設定でONにしてください。',
        '#b3261e',
      );
      return true;
    }

    // パターン選択直後の検証から時間が経っているため、送信直前にもう一度確認する。
    try {
      verifyWorkResult(shift, filled.expectedPattern, filled.breakPlan);
    } catch (error) {
      pauseWorkdayRun(`送信直前の確認に失敗したため停止しました：${error.message}`);
      updateRunnerOverlay(`送信直前の確認に失敗したため停止しました：${error.message}`, '#b3261e');
      return true;
    }

    run = saveWorkdayRun({
      ...run,
      status: 'submitting',
      submissionAttempt: createSubmissionAttempt(day, shift),
    });
    updateRunnerOverlay(`${getRunnerProgressText(run)}。${day}日の申請を送信しています…`);
    submitControl.click();

    const succeeded = await waitForSuccessfulWorkApplication(shift);
    if (succeeded) {
      const currentRun = loadWorkdayRun();
      if (currentRun?.runId === run.runId && currentRun.status === 'submitting') {
        const completedRun = completeCurrentRunDay(currentRun, day);
        returnFromDailyApplication(completedRun);
      }
      return true;
    }

    const currentRun = loadWorkdayRun();
    if (currentRun?.runId === run.runId && currentRun.status === 'submitting') {
      pauseWorkdayRun(`${day}日の申請成功を${SUCCESS_WAIT_TIMEOUT_MS / 1000}秒以内に確認できませんでした。`);
      updateRunnerOverlay(
        `${day}日の申請成功を確認できないため停止しました。画面を確認してください。`,
        '#b3261e',
      );
    }
    return true;
  }

  function finishWorkdayRun(run) {
    const completedRun = saveWorkdayRun({
      ...run,
      currentIndex: run.queue.length,
      currentDay: null,
      status: 'complete',
    });
    const extra = completedRun.skippedDays.length
      ? `\n未処理：${completedRun.skippedDays.join(', ')}日。内容を個別に確認してください。`
      : '';
    setRunnerOverlayFinished(
      `連続申請が完了しました。申請成功 ${completedRun.completedDays.length}日。${extra}`,
      completedRun.skippedDays.length ? '#9a5700' : '#137333',
    );
    return completedRun;
  }

  function handleMonthlyWorkdayRun() {
    let run = loadWorkdayRun();
    const plan = loadSchedulePlan();
    if (!run) return false;
    if (run.status === 'complete') {
      finishWorkdayRun(run);
      return true;
    }
    if (run.status === 'paused') {
      updateRunnerOverlay(
        `${getRunnerProgressText(run)}。停止中：${run.pauseMessage ?? '理由なし'}`,
        '#b3261e',
      );
      return true;
    }
    if (!plan || plan.month !== run.month) {
      pauseWorkdayRun('保存計画が見つからないか、対象月が一致しません。');
      updateRunnerOverlay('保存計画を確認できないため停止しました。', '#b3261e');
      return true;
    }
    if (run.currentIndex >= run.queue.length) {
      finishWorkdayRun(run);
      return true;
    }

    const day = getCurrentRunDay(run);
    const targetMonth = { year: plan.year, month: plan.monthNumber, value: plan.month };
    const controlMap = buildScheduleControlMap(
      targetMonth,
      getDaysInMonth(plan.year, plan.monthNumber),
    );
    const control = controlMap.controlsByDay.get(day);

    if (run.status === 'submitting') {
      const shift = planToShiftMap(plan).get(day);
      const directReturnConfirmed = hasRecentMatchingSubmissionAttempt(run, day, shift);
      if (
        directReturnConfirmed
        || !control
        || isUnavailableControl(control)
        || dayContainerShowsExistingApplication(control)
      ) {
        run = completeCurrentRunDay(run, day);
      } else {
        pauseWorkdayRun(UNCONFIRMED_RETURN_PAUSE_MESSAGE);
        updateRunnerOverlay(
          `${day}日の申請済み状態を確認できないため停止しました。重複申請を避けるため画面を確認してください。`,
          '#b3261e',
        );
        return true;
      }
    }

    if (run.status === 'opening') {
      pauseWorkdayRun('日別画面への移動を確認できませんでした。');
      updateRunnerOverlay(`${day}日の日別画面を開けなかったため停止しました。`, '#b3261e');
      return true;
    }

    if (run.status === 'returning') {
      run = saveWorkdayRun({ ...run, status: 'ready', currentDay: null });
    }
    if (run.currentIndex >= run.queue.length) {
      finishWorkdayRun(run);
      return true;
    }

    const nextDay = getCurrentRunDay(run);
    const nextControl = controlMap.controlsByDay.get(nextDay);
    if (!nextControl || isUnavailableControl(nextControl)) {
      const reason = !nextControl ? 'タイムカードに申請ボタンがない' : '申請ボタンが無効';
      run = skipCurrentRunDay(run, nextDay, reason);
      updateRunnerOverlay(`${nextDay}日は${reason}ためスキップします。`, '#9a5700');
      window.setTimeout(handleMonthlyWorkdayRun, 700);
      return true;
    }

    setPlanPendingDay(plan, nextDay);
    run = saveWorkdayRun({ ...run, status: 'opening', currentDay: nextDay });
    updateRunnerOverlay(
      `${getRunnerProgressText(run)}。${nextDay}日の日別スケジュール申請を開きます…`,
    );
    window.setTimeout(() => {
      const currentRun = loadWorkdayRun();
      if (
        currentRun?.runId === run.runId
        && currentRun.status === 'opening'
        && currentRun.currentDay === nextDay
      ) {
        nextControl.click();
      }
    }, 700);
    return true;
  }

  function resumeWorkdayRunForCurrentPage() {
    const run = loadWorkdayRun();
    if (!run) return;
    const plan = loadSchedulePlan();
    const currentDay = getCurrentRunDay(run);
    const currentShift = plan && currentDay !== null
      ? planToShiftMap(plan).get(currentDay)
      : null;
    if (isScheduleEditPage() || (currentShift && pageShowsSuccessfulWorkApplication(currentShift))) {
      handleDailyWorkdayRun().catch((error) => {
        console.error('[KOT勤務日連続申請]', error);
        pauseWorkdayRun(error.message);
        updateRunnerOverlay(`予期しないエラーで停止しました：${error.message}`, '#b3261e');
      });
      return;
    }
    if (!isBatchApplicationPage() && findScheduleApplicationControls().length > 0) {
      handleMonthlyWorkdayRun();
    }
  }

  const CANCELLATION_STATUSES = new Set([
    'ready',
    'opening-confirmation',
    'executing',
    'paused',
    'complete',
  ]);

  function parseCancelableScheduleRowText(value) {
    const source = normalize(value);
    if (!source.includes('勤務日種別') || !source.includes('対応中')) return null;
    const dateMatch = source.match(
      /(20\d{2})\/(0[1-9]|1[0-2])\/([0-3]\d)\s*[（(]([日月火水木金土])[)）]/,
    );
    if (!dateMatch) return null;

    const [, yearText, monthText, dayText, weekday] = dateMatch;
    const leaveMatch = source.match(/\(\s*休暇\s+([^)]+)\)/);
    const category = source.includes('全休')
      ? '全休'
      : (leaveMatch ? `休暇（${normalize(leaveMatch[1])}）` : '出勤時間');
    const shiftMatch = source.match(
      /シフト\s*\((\d{1,2}:\d{2})\s*[～〜~-]\s*(\d{1,2}:\d{2})\)/,
    ) ?? source.match(
      /(\d{1,2}:\d{2})\s*[～〜~-]\s*(\d{1,2}:\d{2})\s*\(通常勤務\)/,
    );
    const requestedTime = category === '出勤時間' && shiftMatch
      ? `${shiftMatch[1]}～${shiftMatch[2]}`
      : null;
    const statusIndex = source.lastIndexOf('対応中');
    const message = statusIndex >= 0 ? normalize(source.slice(statusIndex + '対応中'.length)) : '';

    return {
      date: `${yearText}/${monthText}/${dayText}`,
      month: `${yearText}-${monthText}`,
      year: Number(yearText),
      monthNumber: Number(monthText),
      day: Number(dayText),
      weekday,
      category,
      requestedTime,
      message,
    };
  }

  function toCancellationQueueItem(record) {
    return {
      applicationId: record.applicationId,
      date: record.date,
      month: record.month,
      day: record.day,
      weekday: record.weekday,
      category: record.category,
      requestedTime: record.requestedTime,
      message: record.message,
    };
  }

  function collectCancelableScheduleApplications() {
    const records = [];
    const buttons = [...document.querySelectorAll('button[id^="button_01"]')];
    for (const button of buttons) {
      const idMatch = button.id.match(/^button_01(\d+)$/);
      if (!idMatch || getControlText(button) !== '申請をキャンセル' || button.disabled) continue;
      const row = button.closest('tr, [role="row"], li');
      const form = button.closest('form');
      const parsed = parseCancelableScheduleRowText(row?.textContent);
      if (!row || !form || !parsed) continue;
      records.push({
        ...parsed,
        applicationId: idMatch[1],
        rowText: normalize(row.textContent),
        button,
        form,
      });
    }
    return records.sort((a, b) => (
      a.date.localeCompare(b.date) || a.applicationId.localeCompare(b.applicationId)
    ));
  }

  function isCancellationHistoryPage() {
    return [...document.querySelectorAll('button[id^="button_01"]')].some((button) => (
      /^button_01\d+$/.test(button.id)
      && getControlText(button) === '申請をキャンセル'
    ));
  }

  function findCancellationExecuteControl() {
    const executeButton = document.querySelector('button#button_01');
    const backButton = document.querySelector('#button_02');
    if (
      executeButton instanceof HTMLButtonElement
      && getControlText(executeButton) === '実行'
      && !executeButton.disabled
      && backButton
      && getControlText(backButton) === '戻る'
    ) {
      return executeButton;
    }
    return null;
  }

  function isCancellationConfirmationPage() {
    return Boolean(findCancellationExecuteControl());
  }

  function confirmationTextMatchesCancellationTarget(pageText, target) {
    if (!target) return false;
    const source = normalize(pageText);
    if (!source.includes(target.date) || !source.includes('勤務日種別')) return false;
    if (target.message && !source.includes(target.message)) return false;
    if (target.category === '全休' && !source.includes('全休') && !source.includes('公休')) {
      return false;
    }
    if (target.requestedTime && !source.replace(/[〜～]/g, '-').includes(
      target.requestedTime.replace(/[〜～]/g, '-'),
    )) {
      return false;
    }
    return true;
  }

  function cancellationConfirmationMatchesTarget(target) {
    const form = findCancellationExecuteControl()?.closest('form');
    const hiddenIdMatches = Boolean(form && [...form.querySelectorAll('input[type="hidden"]')].some((input) => (
      String(input.value).trim() === target?.applicationId
    )));
    return hiddenIdMatches || confirmationTextMatchesCancellationTarget(document.body.innerText, target);
  }

  function createCancellationRun(month, records, verificationRun) {
    return {
      schemaVersion: 1,
      runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      month,
      queue: records.map(toCancellationQueueItem),
      currentIndex: 0,
      currentApplicationId: null,
      status: 'ready',
      completedApplicationIds: [],
      failures: [],
      verificationRun: Boolean(verificationRun),
      navigationStartedAt: null,
      executionStartedAt: null,
      pauseMessage: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function validateCancellationRun(run) {
    if (!run || run.schemaVersion !== 1 || typeof run.runId !== 'string') return null;
    if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(run.month)) return null;
    if (!Array.isArray(run.queue) || !run.queue.length || !CANCELLATION_STATUSES.has(run.status)) {
      return null;
    }
    if (!Number.isInteger(run.currentIndex) || run.currentIndex < 0 || run.currentIndex > run.queue.length) {
      return null;
    }
    const ids = new Set();
    for (const item of run.queue) {
      if (
        !item
        || typeof item.applicationId !== 'string'
        || !/^\d+$/.test(item.applicationId)
        || ids.has(item.applicationId)
        || !/^20\d{2}\/\d{2}\/\d{2}$/.test(item.date)
        || item.month !== run.month
      ) {
        return null;
      }
      ids.add(item.applicationId);
    }
    if (run.currentApplicationId !== null && !ids.has(run.currentApplicationId)) return null;
    if (!Array.isArray(run.completedApplicationIds) || !Array.isArray(run.failures)) return null;
    if (typeof run.verificationRun !== 'boolean') return null;
    for (const key of ['navigationStartedAt', 'executionStartedAt']) {
      if (run[key] !== null && !Number.isFinite(run[key])) return null;
    }
    return run;
  }

  function saveCancellationRun(run) {
    const nextRun = { ...run, updatedAt: new Date().toISOString() };
    if (!validateCancellationRun(nextRun)) throw new Error('取消処理の進行状態が不正です。');
    sessionStorage.setItem(CANCEL_RUN_STORAGE_KEY, JSON.stringify(nextRun));
    return nextRun;
  }

  function loadCancellationRun() {
    try {
      const rawValue = sessionStorage.getItem(CANCEL_RUN_STORAGE_KEY);
      return rawValue ? validateCancellationRun(JSON.parse(rawValue)) : null;
    } catch (error) {
      console.warn('[KOT申請取消]', error);
      return null;
    }
  }

  function hasVerifiedCancellationFlow() {
    try {
      const proof = JSON.parse(localStorage.getItem(CANCEL_PROOF_STORAGE_KEY));
      return Boolean(proof?.schemaVersion === 1 && typeof proof.verifiedAt === 'string');
    } catch (_) {
      return false;
    }
  }

  function saveCancellationProof() {
    try {
      localStorage.setItem(CANCEL_PROOF_STORAGE_KEY, JSON.stringify({
        schemaVersion: 1,
        verifiedAt: new Date().toISOString(),
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function getCurrentCancellationTarget(run) {
    return run.queue[run.currentIndex] ?? null;
  }

  function getCancellationProgressText(run) {
    return `${Math.min(run.currentIndex, run.queue.length)}/${run.queue.length}件取消済み`;
  }

  function pauseCancellationRun(message) {
    const run = loadCancellationRun();
    if (!run || run.status === 'complete') return run;
    return saveCancellationRun({
      ...run,
      status: 'paused',
      pauseMessage: String(message ?? '安全のため停止しました。'),
    });
  }

  function updateCancellationOverlay(message, color = '#17212b') {
    let container = document.getElementById(CANCEL_RUNNER_UI_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CANCEL_RUNNER_UI_ID;
      Object.assign(container.style, {
        position: 'fixed',
        right: '16px',
        top: '16px',
        zIndex: '2147483647',
        width: 'min(380px, calc(100vw - 32px))',
        padding: '12px',
        border: '2px solid #b3261e',
        borderRadius: '10px',
        background: '#fff',
        color: '#17212b',
        boxShadow: '0 8px 28px rgba(0, 0, 0, .24)',
        fontFamily: 'sans-serif',
        boxSizing: 'border-box',
      });
      const title = document.createElement('div');
      title.textContent = `KOT 申請取消 v${SCRIPT_VERSION}`;
      Object.assign(title.style, { marginBottom: '6px', fontSize: '14px', fontWeight: '700' });
      const status = document.createElement('div');
      status.dataset.role = 'cancellation-status';
      Object.assign(status.style, { fontSize: '12px', lineHeight: '1.5', whiteSpace: 'pre-wrap' });
      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.dataset.role = 'cancellation-stop';
      stopButton.textContent = '一括取消を停止';
      Object.assign(stopButton.style, {
        width: '100%',
        marginTop: '8px',
        padding: '7px 10px',
        border: '1px solid #b3261e',
        borderRadius: '6px',
        background: '#fff',
        color: '#b3261e',
        fontWeight: '700',
        cursor: 'pointer',
      });
      stopButton.addEventListener('click', () => {
        const stoppedRun = pauseCancellationRun('ユーザー操作で停止しました。');
        status.style.color = '#b3261e';
        status.textContent = stoppedRun
          ? `${getCancellationProgressText(stoppedRun)}。停止しました。現在の申請履歴を確認してください。`
          : '停止しました。';
        stopButton.disabled = true;
      });
      container.append(title, status, stopButton);
      document.body.appendChild(container);
    }
    const status = container.querySelector('[data-role="cancellation-status"]');
    if (status) {
      status.style.color = color;
      status.textContent = message;
    }
    return container;
  }

  function setCancellationOverlayFinished(message, color = '#137333') {
    const container = updateCancellationOverlay(message, color);
    const stopButton = container.querySelector('[data-role="cancellation-stop"]');
    if (!stopButton) return;
    const closeButton = stopButton.cloneNode(true);
    closeButton.textContent = '閉じる';
    closeButton.disabled = false;
    closeButton.style.borderColor = '#aeb8c2';
    closeButton.style.color = '#17212b';
    closeButton.addEventListener('click', () => container.remove());
    stopButton.replaceWith(closeButton);
  }

  function completeCurrentCancellation(run, target) {
    return saveCancellationRun({
      ...run,
      currentIndex: run.currentIndex + 1,
      currentApplicationId: null,
      status: 'ready',
      completedApplicationIds: [...run.completedApplicationIds, target.applicationId],
      navigationStartedAt: null,
      executionStartedAt: null,
      pauseMessage: null,
    });
  }

  function finishCancellationRun(run) {
    const completedRun = saveCancellationRun({
      ...run,
      currentIndex: run.queue.length,
      currentApplicationId: null,
      status: 'complete',
    });
    if (completedRun.verificationRun && completedRun.completedApplicationIds.length === 1) {
      saveCancellationProof();
    }
    setCancellationOverlayFinished(
      `取消が完了しました。${completedRun.completedApplicationIds.length}件を履歴から消失確認済みです。`,
    );
    document.getElementById(CANCEL_UI_ID)?.remove();
    if (isCancellationHistoryPage()) createCancellationHelper();
    return completedRun;
  }

  function handleCancellationHistoryRun() {
    let run = loadCancellationRun();
    if (!run) return false;
    if (run.status === 'paused') {
      updateCancellationOverlay(
        `${getCancellationProgressText(run)}。停止中：${run.pauseMessage ?? '理由なし'}`,
        '#b3261e',
      );
      return true;
    }
    if (run.status === 'complete' || run.currentIndex >= run.queue.length) {
      finishCancellationRun(run);
      return true;
    }

    const target = getCurrentCancellationTarget(run);
    const records = collectCancelableScheduleApplications();
    const currentRecord = records.find((record) => record.applicationId === target.applicationId);

    if (run.status === 'executing') {
      if (currentRecord) {
        pauseCancellationRun(`${target.date}の申請が取消後も履歴に残っています。`);
        updateCancellationOverlay(
          `${target.date}の取消完了を確認できないため停止しました。`,
          '#b3261e',
        );
        return true;
      }
      run = completeCurrentCancellation(run, target);
      if (run.currentIndex >= run.queue.length) {
        finishCancellationRun(run);
        return true;
      }
    } else if (run.status === 'opening-confirmation') {
      pauseCancellationRun(`${target.date}の取消確認画面から履歴へ戻りました。`);
      updateCancellationOverlay(
        `${target.date}は取消されていない可能性があるため停止しました。`,
        '#b3261e',
      );
      return true;
    }

    const nextTarget = getCurrentCancellationTarget(run);
    const nextRecord = collectCancelableScheduleApplications().find((record) => (
      record.applicationId === nextTarget.applicationId
      && record.date === nextTarget.date
      && record.month === run.month
    ));
    if (!nextRecord) {
      pauseCancellationRun(`${nextTarget.date}の取消ボタンを履歴で確認できません。`);
      updateCancellationOverlay(
        `${nextTarget.date}の対象が変化したため停止しました。`,
        '#b3261e',
      );
      return true;
    }

    run = saveCancellationRun({
      ...run,
      currentApplicationId: nextTarget.applicationId,
      status: 'opening-confirmation',
      navigationStartedAt: Date.now(),
    });
    updateCancellationOverlay(
      `${getCancellationProgressText(run)}。${nextTarget.date} ${nextTarget.category}の取消確認画面を開きます…`,
    );
    window.setTimeout(() => {
      const currentRun = loadCancellationRun();
      if (
        currentRun?.runId === run.runId
        && currentRun.status === 'opening-confirmation'
        && currentRun.currentApplicationId === nextTarget.applicationId
      ) {
        nextRecord.button.click();
      }
    }, 500);
    return true;
  }

  async function handleCancellationConfirmationRun() {
    let run = loadCancellationRun();
    if (!run) return false;
    if (run.status === 'paused') {
      updateCancellationOverlay(
        `${getCancellationProgressText(run)}。停止中：${run.pauseMessage ?? '理由なし'}`,
        '#b3261e',
      );
      return true;
    }
    const target = getCurrentCancellationTarget(run);
    if (!target || run.currentApplicationId !== target.applicationId) {
      pauseCancellationRun('取消確認画面と進行状態が一致しません。');
      updateCancellationOverlay('対象を特定できないため停止しました。', '#b3261e');
      return true;
    }
    if (run.status === 'executing') {
      pauseCancellationRun('取消実行後も確認画面が表示されています。');
      updateCancellationOverlay('実行結果を確認できないため停止しました。', '#b3261e');
      return true;
    }
    if (run.status !== 'opening-confirmation') {
      pauseCancellationRun(`確認画面で想定外の状態（${run.status}）です。`);
      updateCancellationOverlay('再実行を防ぐため停止しました。', '#b3261e');
      return true;
    }
    const elapsed = Date.now() - run.navigationStartedAt;
    if (elapsed < 0 || elapsed > CANCEL_CONFIRMATION_WINDOW_MS) {
      pauseCancellationRun('取消確認画面を開いてから時間が経過しました。');
      updateCancellationOverlay('確認の有効時間を超えたため停止しました。', '#b3261e');
      return true;
    }
    if (!cancellationConfirmationMatchesTarget(target)) {
      pauseCancellationRun(`${target.date}の申請詳細を確認画面で照合できません。`);
      updateCancellationOverlay('日付・内容が一致しないため停止しました。', '#b3261e');
      return true;
    }

    updateCancellationOverlay(
      `${getCancellationProgressText(run)}。${target.date} ${target.category}を1秒後に取り消します…`,
      '#9a5700',
    );
    await wait(1_000);
    run = loadCancellationRun();
    const executeControl = findCancellationExecuteControl();
    if (
      !run
      || run.status !== 'opening-confirmation'
      || run.currentApplicationId !== target.applicationId
      || !executeControl
      || !cancellationConfirmationMatchesTarget(target)
    ) {
      return true;
    }
    run = saveCancellationRun({
      ...run,
      status: 'executing',
      executionStartedAt: Date.now(),
    });
    updateCancellationOverlay(`${getCancellationProgressText(run)}。${target.date}の取消を実行しています…`);
    executeControl.click();
    window.setTimeout(() => {
      const currentRun = loadCancellationRun();
      if (currentRun?.runId === run.runId && currentRun.status === 'executing' && isCancellationConfirmationPage()) {
        pauseCancellationRun('取消実行後に画面遷移がありませんでした。');
        updateCancellationOverlay('取消結果が不明なため停止しました。', '#b3261e');
      }
    }, 5_000);
    return true;
  }

  function resumeCancellationRunForCurrentPage() {
    const run = loadCancellationRun();
    if (!run) return;
    if (isCancellationConfirmationPage()) {
      handleCancellationConfirmationRun().catch((error) => {
        console.error('[KOT申請取消]', error);
        pauseCancellationRun(error.message);
        updateCancellationOverlay(`予期しないエラーで停止しました：${error.message}`, '#b3261e');
      });
      return;
    }
    if (isCancellationHistoryPage()) {
      handleCancellationHistoryRun();
      return;
    }
    if (!['complete', 'paused'].includes(run.status)) {
      updateCancellationOverlay(
        `${getCancellationProgressText(run)}。申請履歴（過去60日）へ戻ると完了確認を続けます。`,
        '#9a5700',
      );
    }
  }

  function createCancellationHelper() {
    if (document.getElementById(CANCEL_UI_ID) || !isCancellationHistoryPage()) return;
    const container = document.createElement('div');
    container.id = CANCEL_UI_ID;
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      width: 'min(500px, calc(100vw - 32px))',
      maxHeight: 'min(86vh, 800px)',
      overflow: 'auto',
      padding: '14px',
      border: '2px solid #b3261e',
      borderRadius: '10px',
      background: '#fff',
      color: '#17212b',
      boxShadow: '0 8px 28px rgba(0, 0, 0, .22)',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    });
    const title = document.createElement('div');
    title.textContent = `KOT 月単位・申請取消 v${SCRIPT_VERSION}`;
    Object.assign(title.style, { marginBottom: '7px', fontSize: '15px', fontWeight: '700' });
    const warning = document.createElement('div');
    warning.textContent = '処理待ちのスケジュール申請だけが対象です。打刻申請は除外します。取消のたびに管理者へ通知される場合があります。';
    Object.assign(warning.style, {
      padding: '8px',
      borderRadius: '6px',
      background: '#fff1f0',
      color: '#8a1c15',
      fontSize: '12px',
      lineHeight: '1.45',
    });
    const monthLabel = document.createElement('label');
    monthLabel.textContent = '取消する対象月';
    Object.assign(monthLabel.style, { display: 'block', marginTop: '10px', fontSize: '12px', fontWeight: '700' });
    const monthInput = document.createElement('input');
    monthInput.type = 'month';
    Object.assign(monthInput.style, {
      width: '100%',
      marginTop: '4px',
      padding: '7px',
      border: '1px solid #aeb8c2',
      borderRadius: '6px',
      boxSizing: 'border-box',
    });
    const allRecords = collectCancelableScheduleApplications();
    const availableMonths = [...new Set(allRecords.map((record) => record.month))].sort();
    const planMonth = loadSchedulePlan()?.month;
    monthInput.value = availableMonths.includes(planMonth)
      ? planMonth
      : (availableMonths.at(-1) ?? '');
    const proofNote = document.createElement('div');
    Object.assign(proofNote.style, { marginTop: '8px', fontSize: '12px', lineHeight: '1.45' });
    const selectAllButton = document.createElement('button');
    selectAllButton.type = 'button';
    selectAllButton.textContent = '表示中をすべて選択';
    Object.assign(selectAllButton.style, {
      width: '100%',
      marginTop: '8px',
      padding: '7px 10px',
      border: '1px solid #52616f',
      borderRadius: '6px',
      background: '#fff',
      color: '#17212b',
      fontWeight: '700',
      cursor: 'pointer',
    });
    const list = document.createElement('div');
    Object.assign(list.style, {
      maxHeight: '300px',
      overflow: 'auto',
      marginTop: '8px',
      border: '1px solid #d7dde3',
      borderRadius: '6px',
      padding: '4px 8px',
    });
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    Object.assign(actionButton.style, {
      width: '100%',
      marginTop: '9px',
      padding: '9px 12px',
      border: '0',
      borderRadius: '7px',
      background: '#b3261e',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });
    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    Object.assign(status.style, { marginTop: '8px', fontSize: '12px', lineHeight: '1.45', whiteSpace: 'pre-wrap' });

    let monthRecords = [];
    const selectedIds = new Set();
    const updateSelectionState = () => {
      const verified = hasVerifiedCancellationFlow();
      const selectedCount = selectedIds.size;
      selectAllButton.textContent = selectedCount === monthRecords.length && monthRecords.length
        ? '表示中の選択をすべて解除'
        : '表示中をすべて選択';
      actionButton.textContent = verified
        ? `選択した${selectedCount}件を一括取消`
        : `初回確認：選択した${selectedCount}件を取消`;
      actionButton.disabled = selectedCount === 0 || (!verified && selectedCount !== 1);
      actionButton.style.opacity = actionButton.disabled ? '.5' : '1';
      proofNote.style.color = verified ? '#137333' : '#9a5700';
      proofNote.textContent = verified
        ? '取消動作の1件テストは確認済みです。複数選択できます。'
        : '初回は安全確認のため1件だけ選択してください。成功後に複数選択を有効化します。';
    };
    const render = () => {
      monthRecords = collectCancelableScheduleApplications().filter((record) => (
        record.month === monthInput.value
      ));
      for (const id of [...selectedIds]) {
        if (!monthRecords.some((record) => record.applicationId === id)) selectedIds.delete(id);
      }
      list.replaceChildren();
      for (const record of monthRecords) {
        const label = document.createElement('label');
        Object.assign(label.style, {
          display: 'flex',
          alignItems: 'flex-start',
          gap: '7px',
          padding: '6px 2px',
          borderBottom: '1px solid #edf0f2',
          fontSize: '12px',
          lineHeight: '1.4',
          cursor: 'pointer',
        });
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedIds.has(record.applicationId);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedIds.add(record.applicationId);
          else selectedIds.delete(record.applicationId);
          updateSelectionState();
        });
        const detail = document.createElement('span');
        const scheduleDetail = record.category === '全休'
          ? '全休（公休）'
          : `${record.category}${record.requestedTime ? ` ${record.requestedTime}` : ''}`;
        detail.textContent = `${record.date}(${record.weekday})  ${scheduleDetail}`;
        label.append(checkbox, detail);
        list.appendChild(label);
      }
      if (!monthRecords.length) {
        const empty = document.createElement('div');
        empty.textContent = 'この月の取消可能なスケジュール申請はありません。';
        Object.assign(empty.style, { padding: '10px 2px', fontSize: '12px', color: '#52616f' });
        list.appendChild(empty);
      }
      status.style.color = '#17212b';
      status.textContent = `${monthRecords.length}件を検出。出勤時間 ${monthRecords.filter((record) => record.category === '出勤時間').length}件、休暇 ${monthRecords.filter((record) => record.category !== '出勤時間').length}件。`;
      updateSelectionState();
    };
    monthInput.addEventListener('change', () => {
      selectedIds.clear();
      render();
    });
    selectAllButton.addEventListener('click', () => {
      const allSelected = monthRecords.length > 0 && monthRecords.every((record) => (
        selectedIds.has(record.applicationId)
      ));
      selectedIds.clear();
      if (!allSelected) monthRecords.forEach((record) => selectedIds.add(record.applicationId));
      render();
    });
    actionButton.addEventListener('click', () => {
      try {
        const selectedRecords = monthRecords.filter((record) => selectedIds.has(record.applicationId));
        const verified = hasVerifiedCancellationFlow();
        if (!selectedRecords.length) throw new Error('取消対象を1件以上選択してください。');
        if (!verified && selectedRecords.length !== 1) {
          throw new Error('初回は取消動作の確認のため1件だけ選択してください。');
        }
        const [yearText, monthText] = monthInput.value.split('-');
        const phrase = !verified
          ? `${selectedRecords[0].date.replace(/\/(0?\d{1,2})\/(0?\d{1,2})$/, '年$1月$2日')}をキャンセル`
          : `${yearText}年${Number(monthText)}月分をキャンセル`;
        const details = selectedRecords.map((record) => (
          `${record.date} ${record.category}${record.requestedTime ? ` ${record.requestedTime}` : ''}`
        )).join('\n');
        const confirmation = window.prompt(
          `${selectedRecords.length}件の処理待ちスケジュール申請を実際に取り消します。\n`
          + '管理者へ取消通知が送られる場合があります。\n\n'
          + `${details}\n\n実行する場合だけ「${phrase}」と入力してください。`,
          '',
        );
        if (confirmation !== phrase) {
          status.style.color = '#9a5700';
          status.textContent = '取消処理を開始しませんでした。';
          return;
        }
        const existingRun = loadCancellationRun();
        if (
          existingRun
          && !['paused', 'complete'].includes(existingRun.status)
          && !window.confirm('進行中の取消処理があります。新しい処理で置き換えますか？')
        ) {
          return;
        }
        const run = saveCancellationRun(createCancellationRun(
          monthInput.value,
          selectedRecords,
          !verified,
        ));
        updateCancellationOverlay(`${getCancellationProgressText(run)}。最初の対象を準備しています…`);
        status.style.color = '#b3261e';
        status.textContent = `${selectedRecords.length}件の取消処理を開始しました。`;
        window.setTimeout(handleCancellationHistoryRun, 400);
      } catch (error) {
        status.style.color = '#b3261e';
        status.textContent = `取消処理を開始できませんでした：${error.message}`;
      }
    });

    container.append(
      title,
      warning,
      monthLabel,
      monthInput,
      proofNote,
      selectAllButton,
      list,
      actionButton,
      status,
    );
    document.body.appendChild(container);
    render();
  }

  function formatTimeInputValue(time) {
    if (!time) return '';
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

    // 未設定の人には共通の初期値（12:00～13:00）を見せず、自分の時刻を入力させる。
    const initialBreakStart = storedSettings ? storedSettings.breakStart : null;
    const initialBreakEnd = storedSettings ? storedSettings.breakEnd : null;
    const breakStartField = createTimeField('kot-settings-break-start', '休憩開始', initialBreakStart);
    const breakEndField = createTimeField('kot-settings-break-end', '休憩終了', initialBreakEnd);
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
      if (toTotalMinutes(start) >= toTotalMinutes(end)) {
        settingsStatus.style.color = '#b3261e';
        settingsStatus.textContent = '休憩終了は休憩開始より後の時刻にしてください。';
        return;
      }

      let saved;
      try {
        saved = saveUserSettings({
          version: 1,
          breakEnabled: breakEnabled.checked,
          breakStart: start,
          breakEnd: end,
          autoSubmitEnabled: autoSubmit.checked,
        });
      } catch (error) {
        console.error('[KOT申請ヘルパー設定]', error);
        settingsStatus.style.color = '#b3261e';
        settingsStatus.textContent = `設定を保存できませんでした：${error.message}`;
        return;
      }

      guidance.style.color = '#17212b';
      guidance.textContent = '自分の休憩時間を設定しています。変更したらそのつど保存してください。';
      settingsStatus.style.color = '#137333';
      settingsStatus.textContent = `保存しました。休憩：${describeBreakSummary(saved)}`;
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

  function createPreviewSection(label) {
    const section = document.createElement('div');
    section.style.marginTop = '10px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '12px';
    title.textContent = label;

    const content = document.createElement('div');
    Object.assign(content.style, {
      marginTop: '3px',
      fontSize: '12px',
      lineHeight: '1.55',
      overflowWrap: 'anywhere',
    });

    section.append(title, content);
    return { section, title, content };
  }

  function isBatchApplicationPage() {
    return Boolean(
      document.querySelector(`select[id^="${BATCH.patternPrefix}"]`)
      && document.querySelector(`select[id^="${BATCH.workDayTypePrefix}"]`)
    );
  }

  function parseBatchDate(patternSelect) {
    const match = patternSelect.id.match(/_(20\d{2})(\d{2})(\d{2})$/);
    if (!match) return null;
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      key: `${match[1]}${match[2]}${match[3]}`,
    };
  }

  function findBatchRemark(mainRow, fallbackRemark) {
    let currentRow = mainRow;
    for (let distance = 0; currentRow && distance < 5; distance += 1) {
      if (
        distance > 0
        && currentRow.querySelector(`select[id^="${BATCH.patternPrefix}"]`)
      ) {
        break;
      }
      const remark = currentRow.querySelector('input[name="remark_list"]');
      if (remark instanceof HTMLInputElement) return remark;
      currentRow = currentRow.nextElementSibling;
    }
    return fallbackRemark instanceof HTMLInputElement ? fallbackRemark : null;
  }

  function getBatchRows() {
    const patternSelects = [...document.querySelectorAll(
      `select[id^="${BATCH.patternPrefix}"]`,
    )].filter((select) => !select.id.includes('{{count}}'));
    const fallbackRemarks = [...document.querySelectorAll('input[name="remark_list"]')];

    return patternSelects.map((pattern, index) => {
      const date = parseBatchDate(pattern);
      if (!date) return null;
      const mainRow = pattern.closest('tr');
      const workDayType = document.getElementById(`${BATCH.workDayTypePrefix}${date.key}`);
      const leaveType = document.getElementById(`${BATCH.leaveTypePrefix}${date.key}`);
      const leaveMode = document.getElementById(`${BATCH.leaveModePrefix}${date.key}`);
      if (
        !(workDayType instanceof HTMLSelectElement)
        || !(leaveType instanceof HTMLSelectElement)
        || !(leaveMode instanceof HTMLSelectElement)
      ) {
        return null;
      }
      return {
        ...date,
        pattern,
        workDayType,
        leaveType,
        leaveMode,
        remark: findBatchRemark(mainRow, fallbackRemarks[index]),
        mainRow,
        rowText: normalize(mainRow?.textContent),
      };
    }).filter(Boolean);
  }

  const CURRENT_LEAVE_NAMES = [
    '養育両立支援休暇',
    '子の看護等休暇',
    '労災休業（業務）',
    '産後パパ育休',
    '慶弔休暇',
    '振替休日',
    '特別休暇',
    '介護休暇',
    '有休',
    '公休',
    '欠勤',
  ];

  function readBatchCurrentState(batchRow) {
    const currentSummary = normalize(batchRow.rowText.split('変更なし')[0]);
    const summaryWithoutRanges = currentSummary.replace(
      /\d{1,2}:\d{2}\s*[～〜-]\s*\d{1,2}:\d{2}/g,
      '',
    );
    const scheduleMatch = currentSummary.match(
      /(\d{1,2}):(\d{2})\s*[～〜-]\s*(\d{1,2}):(\d{2})/,
    );
    const workDayTypeMatch = currentSummary.match(
      /勤務日種別\s*[：:]\s*(平日|法定休日|法定外休日)/,
    );
    const currentLeave = CURRENT_LEAVE_NAMES.find((name) => currentSummary.includes(name)) ?? null;
    const scheduleLabel = scheduleMatch
      ? `${Number(scheduleMatch[1])}:${scheduleMatch[2]}～${Number(scheduleMatch[3])}:${scheduleMatch[4]}`
      : null;

    return {
      currentSummary,
      scheduleLabel,
      workDayType: workDayTypeMatch?.[1] ?? null,
      currentLeave,
      hasPunch: /(?:^|\s)\d{1,2}:\d{2}(?=\s|$)/.test(summaryWithoutRanges),
      unavailable: Boolean(
        batchRow.pattern.disabled
        || batchRow.workDayType.disabled
        || batchRow.leaveType.disabled
      ),
    };
  }

  function isAlreadyHolidayState(state) {
    return state.currentLeave === '公休' && state.workDayType === '法定外休日';
  }

  function isAlreadyWorkState(state, shift) {
    return state.scheduleLabel === shift.label
      && state.workDayType === '平日'
      && state.currentLeave === null;
  }

  function analyzeBatchPlan(plan) {
    const shiftsByDay = planToShiftMap(plan);
    const lastDay = getDaysInMonth(plan.year, plan.monthNumber);
    const allDays = Array.from({ length: lastDay }, (_, index) => index + 1);
    const rows = getBatchRows().filter((row) => (
      row.year === plan.year && row.month === plan.monthNumber
    ));
    const rowsByDay = new Map(rows.map((row) => [row.day, row]));
    const analysis = {
      plan,
      rows,
      rowsByDay,
      work: [],
      holiday: [],
      daily: [],
      unchanged: [],
      punched: [],
      conflicts: [],
      unavailable: [],
      missing: allDays.filter((day) => !rowsByDay.has(day)),
    };

    for (const row of rows) {
      const state = readBatchCurrentState(row);
      const shift = shiftsByDay.get(row.day) ?? null;
      const base = { day: row.day, row, state, shift };

      if (shift && isAlreadyWorkState(state, shift)) {
        analysis.unchanged.push({ ...base, reason: '勤務設定済み' });
        continue;
      }
      if (!shift && isAlreadyHolidayState(state)) {
        analysis.unchanged.push({ ...base, reason: '公休設定済み' });
        continue;
      }
      if (state.hasPunch) {
        analysis.punched.push({ ...base, reason: '打刻あり' });
        continue;
      }
      if (state.unavailable) {
        analysis.unavailable.push({ ...base, reason: '編集不可' });
        continue;
      }
      if (state.currentLeave && state.currentLeave !== '公休') {
        analysis.conflicts.push({ ...base, reason: `既存休暇：${state.currentLeave}` });
        continue;
      }

      if (shift) {
        const matchingPattern = findOption(row.pattern, { text: shift.label });
        if (!matchingPattern) {
          analysis.daily.push({ ...base, reason: '固定パターンなし' });
        } else {
          analysis.work.push({ ...base, matchingPattern });
        }
      } else {
        analysis.holiday.push(base);
      }
    }

    return analysis;
  }

  function formatBatchItems(items, plan) {
    if (!items.length) return 'なし';
    return items.map((item) => {
      const date = formatDay(plan.year, plan.monthNumber, item.day);
      const shift = item.shift ? ` ${item.shift.label}` : '';
      const reason = item.reason ? `（${item.reason}）` : '';
      return `${date}${shift}${reason}`;
    }).join('、');
  }

  function highlightBatchRow(batchRow, color) {
    if (!batchRow.mainRow) return;
    batchRow.mainRow.style.outline = `2px solid ${color}`;
    batchRow.mainRow.style.outlineOffset = '-2px';
  }

  async function applyBatchAction(action) {
    const { row, state, shift } = action;
    if (shift) {
      if (!row.remark) {
        throw new Error(`${row.day}日の申請メッセージ欄が見つかりません。`);
      }
      const matchingPattern = findOption(row.pattern, { text: shift.label });
      if (!matchingPattern) {
        throw new Error(`${row.day}日の勤務パターン「${shift.label}」が見つかりません。`);
      }
      const patternTarget = {
        preferredValue: matchingPattern.value,
        text: shift.label,
      };
      setSelectOption(row.pattern, patternTarget, `${row.day}日のパターン`);
      setSelectOption(row.workDayType, BATCH.workWorkDayType, `${row.day}日の勤務日種別`);
      const leaveTarget = state.currentLeave === '公休'
        ? BATCH.deleteLeave
        : BATCH.unchangedLeave;
      setSelectOption(row.leaveType, leaveTarget, `${row.day}日の休暇`);
      setTextInput(row.remark, WORK.remark, `${row.day}日の申請メッセージ`);

      assertSelected(row.pattern, patternTarget, `${row.day}日のパターン`);
      assertSelected(row.workDayType, BATCH.workWorkDayType, `${row.day}日の勤務日種別`);
      assertSelected(row.leaveType, leaveTarget, `${row.day}日の休暇`);
      if (row.remark.value !== WORK.remark) {
        throw new Error(`${row.day}日の申請メッセージを設定できませんでした。`);
      }
      highlightBatchRow(row, '#1668c1');
      return;
    }

    if (!row.remark) {
      throw new Error(`${row.day}日の申請メッセージ欄が見つかりません。`);
    }
    setSelectOption(
      row.workDayType,
      BATCH.holidayWorkDayType,
      `${row.day}日の勤務日種別`,
    );
    const modeIsReady = !row.leaveMode.disabled
      && Boolean(findOption(row.leaveMode, BATCH.fullDayLeave));
    setSelectOption(
      row.leaveType,
      BATCH.holidayLeave,
      `${row.day}日の休暇`,
      { forceEvents: !modeIsReady },
    );
    const leaveMode = await waitForSelectOption(
      `#${row.leaveMode.id}`,
      BATCH.fullDayLeave,
    );
    setSelectOption(leaveMode, BATCH.fullDayLeave, `${row.day}日の取得単位`);
    setTextInput(row.remark, BATCH.holidayRemark, `${row.day}日の申請メッセージ`);

    assertSelected(row.workDayType, BATCH.holidayWorkDayType, `${row.day}日の勤務日種別`);
    assertSelected(row.leaveType, BATCH.holidayLeave, `${row.day}日の休暇`);
    assertSelected(leaveMode, BATCH.fullDayLeave, `${row.day}日の取得単位`);
    if (row.remark.value !== BATCH.holidayRemark) {
      throw new Error(`${row.day}日の申請メッセージを設定できませんでした。`);
    }
    highlightBatchRow(row, '#137333');
  }

  async function applyBatchPlan(analysis, onProgress) {
    const actions = [...analysis.work, ...analysis.holiday]
      .sort((itemA, itemB) => itemA.day - itemB.day);
    const successes = [];
    const failures = [];

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      onProgress?.(index + 1, actions.length, action.day);
      try {
        await applyBatchAction(action);
        successes.push(action);
      } catch (error) {
        console.error(`[KOT月間入力ヘルパー] ${action.day}日の反映に失敗`, error);
        failures.push({ ...action, error });
        highlightBatchRow(action.row, '#b3261e');
      }
    }
    return { actions, successes, failures };
  }

  function createBatchHelper() {
    if (document.getElementById(BATCH_UI_ID) || !isBatchApplicationPage()) return;

    const plan = loadSchedulePlan();
    const batchRows = getBatchRows();
    const batchMonths = [...new Set(batchRows.map((row) => (
      toYearMonthValue(row.year, row.month)
    )))];
    const monthMatches = Boolean(plan && batchMonths.length === 1 && batchMonths[0] === plan.month);

    const container = document.createElement('div');
    container.id = BATCH_UI_ID;
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      width: 'min(460px, calc(100vw - 32px))',
      maxHeight: 'min(82vh, 760px)',
      overflow: 'auto',
      padding: '14px',
      border: '1px solid #c8d0d9',
      borderRadius: '10px',
      background: '#fff',
      color: '#17212b',
      boxShadow: '0 8px 28px rgba(0, 0, 0, .2)',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    });

    const title = document.createElement('div');
    title.textContent = `KOT 月間一括フォーム入力 v${SCRIPT_VERSION}`;
    Object.assign(title.style, {
      marginBottom: '8px',
      fontSize: '15px',
      fontWeight: '700',
    });

    const note = document.createElement('div');
    Object.assign(note.style, {
      padding: '8px',
      borderRadius: '6px',
      background: '#fff7e6',
      color: '#754c00',
      fontSize: '12px',
      lineHeight: '1.45',
    });
    note.textContent = '休日は「法定外休日・公休・全日休暇・全休」を設定します。一括画面にパターン削除欄がないため、休日のパターンは「変更なし」のままです。申請は送信しません。';

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.textContent = '反映対象を再確認';
    const fillButton = document.createElement('button');
    fillButton.type = 'button';
    fillButton.textContent = 'フォームへ反映（申請しない）';
    for (const [button, background] of [
      [previewButton, '#52616f'],
      [fillButton, '#1668c1'],
    ]) {
      Object.assign(button.style, {
        width: '100%',
        marginTop: '9px',
        padding: '9px 12px',
        border: '0',
        borderRadius: '7px',
        background,
        color: '#fff',
        fontWeight: '700',
        cursor: 'pointer',
      });
    }

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    Object.assign(status.style, {
      marginTop: '8px',
      fontSize: '12px',
      lineHeight: '1.45',
    });

    const summary = createPreviewSection('集計');
    const changes = createPreviewSection('一括フォームへ反映');
    const daily = createPreviewSection('日別入力が必要');
    const skipped = createPreviewSection('変更しない・要確認');
    let latestAnalysis = null;

    const renderAnalysis = () => {
      if (!plan) {
        throw new Error('保存された月間計画がありません。タイムカード画面で計画を保存してください。');
      }
      if (!monthMatches) {
        throw new Error(`保存計画（${plan.month}）と表示中の一括画面（${batchMonths.join('、') || '判定不能'}）が一致しません。`);
      }

      latestAnalysis = analyzeBatchPlan(plan);
      const changeCount = latestAnalysis.work.length + latestAnalysis.holiday.length;
      summary.content.textContent = [
        `${plan.year}年${plan.monthNumber}月`,
        `勤務へ変更：${latestAnalysis.work.length}日`,
        `休日へ変更：${latestAnalysis.holiday.length}日`,
        `日別入力：${latestAnalysis.daily.length}日`,
        `変更不要：${latestAnalysis.unchanged.length}日`,
      ].join('／');
      changes.content.textContent = [
        `勤務：${formatBatchItems(latestAnalysis.work, plan)}`,
        `休日：${formatBatchItems(latestAnalysis.holiday, plan)}`,
      ].join('\n');
      daily.content.textContent = formatBatchItems(latestAnalysis.daily, plan);
      skipped.content.textContent = [
        `変更不要：${formatBatchItems(latestAnalysis.unchanged, plan)}`,
        `打刻あり：${formatBatchItems(latestAnalysis.punched, plan)}`,
        `別休暇あり：${formatBatchItems(latestAnalysis.conflicts, plan)}`,
        `編集不可：${formatBatchItems(latestAnalysis.unavailable, plan)}`,
        `画面にない日：${latestAnalysis.missing.length ? latestAnalysis.missing.join(', ') : 'なし'}`,
      ].join('\n');
      for (const item of [summary, changes, daily, skipped]) {
        item.section.hidden = false;
        item.content.style.whiteSpace = 'pre-wrap';
      }
      fillButton.disabled = changeCount === 0;
      fillButton.style.opacity = changeCount === 0 ? '.55' : '1';
      fillButton.style.cursor = changeCount === 0 ? 'not-allowed' : 'pointer';
      status.style.color = '#137333';
      status.textContent = `確認完了。${changeCount}日分をフォームへ反映できます。まだ申請は送信していません。`;
      return latestAnalysis;
    };

    previewButton.addEventListener('click', () => {
      try {
        renderAnalysis();
      } catch (error) {
        status.style.color = '#b3261e';
        status.textContent = error.message;
        fillButton.disabled = true;
      }
    });

    fillButton.addEventListener('click', async () => {
      try {
        const analysis = renderAnalysis();
        const changeCount = analysis.work.length + analysis.holiday.length;
        if (changeCount === 0) return;
        const approved = window.confirm(
          `${plan.month} の一括申請フォームへ ${changeCount}日分を入力します。\n`
          + '打刻あり・別休暇あり・変更不要・画面にない日は変更しません。\n'
          + 'KING OF TIMEの申請ボタンは押しません。よろしいですか？',
        );
        if (!approved) return;

        fillButton.disabled = true;
        previewButton.disabled = true;
        const result = await applyBatchPlan(analysis, (current, total, day) => {
          status.style.color = '#17212b';
          status.textContent = `フォームへ反映中：${current}/${total}（${day}日）`;
        });
        if (result.failures.length) {
          status.style.color = '#b3261e';
          status.textContent = `${result.successes.length}日を反映、${result.failures.length}日で失敗しました。赤枠の行を確認してください。申請は送信していません。`;
        } else {
          status.style.color = '#137333';
          status.textContent = `${result.successes.length}日分を反映しました。青・緑枠の行と休憩予定を確認し、問題なければKING OF TIMEの「申請する」を押してください。`;
        }
      } catch (error) {
        console.error('[KOT月間入力ヘルパー]', error);
        status.style.color = '#b3261e';
        status.textContent = `反映できませんでした：${error.message}`;
      } finally {
        fillButton.disabled = false;
        previewButton.disabled = false;
      }
    });

    container.append(
      title,
      note,
      previewButton,
      fillButton,
      status,
      summary.section,
      changes.section,
      daily.section,
      skipped.section,
    );
    document.body.appendChild(container);

    try {
      renderAnalysis();
    } catch (error) {
      status.style.color = '#b3261e';
      status.textContent = error.message;
      fillButton.disabled = true;
      for (const item of [summary, changes, daily, skipped]) item.section.hidden = true;
    }
  }

  function createMonthlyPreview() {
    if (document.getElementById(MONTHLY_UI_ID)) return;

    const applicationControls = findScheduleApplicationControls();
    if (applicationControls.length === 0) return;

    const detectedMonth = detectTargetMonth();
    const existingPlan = loadSchedulePlan();
    const container = document.createElement('div');
    container.id = MONTHLY_UI_ID;
    Object.assign(container.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      width: 'min(430px, calc(100vw - 32px))',
      maxHeight: 'min(78vh, 720px)',
      overflow: 'auto',
      padding: '14px',
      border: '1px solid #c8d0d9',
      borderRadius: '10px',
      background: '#fff',
      color: '#17212b',
      boxShadow: '0 8px 28px rgba(0, 0, 0, .2)',
      fontFamily: 'sans-serif',
      boxSizing: 'border-box',
    });

    const title = document.createElement('div');
    title.textContent = `KOT 月間スケジュール入力 v${SCRIPT_VERSION}`;
    Object.assign(title.style, {
      marginBottom: '10px',
      fontSize: '15px',
      fontWeight: '700',
    });

    const monthLabel = document.createElement('label');
    monthLabel.textContent = '対象月';
    Object.assign(monthLabel.style, {
      display: 'block',
      marginBottom: '4px',
      fontSize: '12px',
      fontWeight: '700',
    });

    const monthInput = document.createElement('input');
    monthInput.type = 'month';
    monthInput.value = detectedMonth.value;
    Object.assign(monthInput.style, {
      width: '100%',
      padding: '8px',
      border: '1px solid #aeb8c2',
      borderRadius: '6px',
      boxSizing: 'border-box',
    });

    const workDaysLabel = document.createElement('label');
    workDaysLabel.textContent = '当月のシフト（勤務時間ごとに1行）';
    Object.assign(workDaysLabel.style, {
      display: 'block',
      marginTop: '10px',
      marginBottom: '4px',
      fontSize: '12px',
      fontWeight: '700',
    });

    const workDaysInput = document.createElement('textarea');
    workDaysInput.rows = 4;
    workDaysInput.inputMode = 'numeric';
    workDaysInput.autocomplete = 'off';
    workDaysInput.placeholder = '例:\n1,2,3日 7時～16時\n8,9日 9時～18時';
    if (existingPlan?.month === detectedMonth.value) {
      workDaysInput.value = existingPlan.sourceText;
    }
    Object.assign(workDaysInput.style, {
      width: '100%',
      padding: '8px',
      border: '1px solid #aeb8c2',
      borderRadius: '6px',
      boxSizing: 'border-box',
      resize: 'vertical',
      fontFamily: 'sans-serif',
    });

    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.textContent = 'プレビューを作成';
    Object.assign(previewButton.style, {
      width: '100%',
      marginTop: '10px',
      padding: '9px 12px',
      border: '0',
      borderRadius: '7px',
      background: '#1668c1',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });

    const saveAndOpenButton = document.createElement('button');
    saveAndOpenButton.type = 'button';
    saveAndOpenButton.textContent = '計画を保存して月間一括画面へ';
    saveAndOpenButton.hidden = true;
    Object.assign(saveAndOpenButton.style, {
      width: '100%',
      marginTop: '8px',
      padding: '9px 12px',
      border: '0',
      borderRadius: '7px',
      background: '#137333',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });

    const runWorkdaysButton = document.createElement('button');
    runWorkdaysButton.type = 'button';
    runWorkdaysButton.textContent = '出勤日の時間を連続申請';
    runWorkdaysButton.hidden = true;
    Object.assign(runWorkdaysButton.style, {
      width: '100%',
      marginTop: '8px',
      padding: '9px 12px',
      border: '0',
      borderRadius: '7px',
      background: '#b3261e',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    Object.assign(status.style, {
      marginTop: '8px',
      fontSize: '12px',
      lineHeight: '1.45',
      color: detectedMonth.confident ? '#17212b' : '#9a5700',
    });
    status.textContent = detectedMonth.confident
      ? '対象月を確認し、当月のシフトを入力してください。まだ画面操作は行いません。'
      : '対象月を自動判定できませんでした。表示中の月に直してからプレビューしてください。';

    const summary = createPreviewSection('集計');
    const workDays = createPreviewSection('出勤（勤務時間）');
    const holidayDays = createPreviewSection('休日化');
    const mapping = createPreviewSection('日付と申請ボタンの確認');
    for (const item of [summary, workDays, holidayDays, mapping]) {
      item.section.hidden = true;
    }

    let previewReady = false;

    // 自動申請は既定 OFF。設定で明示的に ON にするまでボタン自体を出さない。
    function applyAutoSubmitVisibility(currentSettings) {
      const enabled = Boolean(currentSettings?.autoSubmitEnabled);
      runWorkdaysButton.hidden = !(enabled && previewReady);
    }

    const settingsSection = createSettingsSection((savedSettings) => {
      applyAutoSubmitVisibility(savedSettings);
    });

    let latestPlan = null;
    let latestControlMap = null;
    let latestUnconfirmedPatterns = [];

    previewButton.addEventListener('click', () => {
      try {
        const targetMonth = parseMonthInput(monthInput.value);
        const lastDay = getDaysInMonth(targetMonth.year, targetMonth.month);
        const shiftsByDay = parseShiftSchedule(workDaysInput.value, lastDay);
        const selectedWorkDays = [...shiftsByDay.keys()];
        const workDaySet = new Set(selectedWorkDays);
        const allDays = Array.from({ length: lastDay }, (_, index) => index + 1);
        const selectedHolidayDays = allDays.filter((day) => !workDaySet.has(day));
        const controlMap = buildScheduleControlMap(targetMonth, lastDay);
        const mappedDays = [...controlMap.controlsByDay.keys()].sort((a, b) => a - b);
        const missingDays = allDays.filter((day) => !controlMap.controlsByDay.has(day));
        const unavailableDays = mappedDays.filter((day) => (
          isUnavailableControl(controlMap.controlsByDay.get(day))
        ));
        const unconfirmedPatterns = [...new Set(
          [...shiftsByDay.values()]
            .map((shift) => shift.label)
            .filter((label) => !OBSERVED_WORK_PATTERNS.has(label)),
        )];
        latestPlan = createSchedulePlan(targetMonth, workDaysInput.value, shiftsByDay);
        latestControlMap = controlMap;
        latestUnconfirmedPatterns = unconfirmedPatterns;

        const format = (day) => formatDay(targetMonth.year, targetMonth.month, day);
        summary.content.textContent = `${targetMonth.year}年${targetMonth.month}月：出勤 ${selectedWorkDays.length}日／休日化 ${selectedHolidayDays.length}日`;
        workDays.content.textContent = selectedWorkDays.length
          ? selectedWorkDays
            .map((day) => `${format(day)} ${shiftsByDay.get(day).label}`)
            .join('\n')
          : 'なし';
        workDays.content.style.whiteSpace = 'pre-wrap';
        holidayDays.content.textContent = selectedHolidayDays.map(format).join('、');

        const mappingLines = [
          `日付を特定できたスケジュール申請ボタン：${mappedDays.length}/${lastDay}日`,
        ];
        if (missingDays.length) {
          mappingLines.push(`未検出の日：${missingDays.join(', ')}`);
        }
        if (unavailableDays.length) {
          mappingLines.push(`無効状態のボタン：${unavailableDays.join(', ')}`);
        }
        if (controlMap.unresolved.length) {
          mappingLines.push(`日付を特定できないボタン：${controlMap.unresolved.length}個`);
        }
        if (controlMap.duplicates.size) {
          mappingLines.push(`同じ日に複数見つかった日：${[...controlMap.duplicates].sort((a, b) => a - b).join(', ')}`);
        }
        mapping.content.textContent = mappingLines.join('\n');
        mapping.content.style.whiteSpace = 'pre-wrap';

        for (const item of [summary, workDays, holidayDays, mapping]) {
          item.section.hidden = false;
        }
        saveAndOpenButton.hidden = false;
        previewReady = true;
        applyAutoSubmitVisibility(loadUserSettings());

        if (unconfirmedPatterns.length) {
          status.style.color = '#9a5700';
          status.textContent = `プレビューを作成しました。「${unconfirmedPatterns.join('、')}」は一括画面に無いため、日別フォームで入力します。`;
        } else {
          status.style.color = '#137333';
          status.textContent = 'プレビューを作成しました。入力・画面遷移・申請は行っていません。';
        }
      } catch (error) {
        latestPlan = null;
        latestControlMap = null;
        latestUnconfirmedPatterns = [];
        saveAndOpenButton.hidden = true;
        previewReady = false;
        applyAutoSubmitVisibility(loadUserSettings());
        status.style.color = '#b3261e';
        status.textContent = `プレビューを作成できませんでした：${error.message}`;
      }
    });

    saveAndOpenButton.addEventListener('click', () => {
      if (!latestPlan || !latestControlMap) {
        status.style.color = '#b3261e';
        status.textContent = '先にプレビューを作成してください。';
        return;
      }

      const approved = window.confirm(
        `${latestPlan.month} の計画を保存し、月間一括申請画面へ移動します。\n`
        + `勤務 ${latestPlan.shifts.length}日、休日 ${getDaysInMonth(latestPlan.year, latestPlan.monthNumber) - latestPlan.shifts.length}日です。\n`
        + 'この操作では申請を送信しません。よろしいですか？',
      );
      if (!approved) return;

      try {
        saveSchedulePlan(latestPlan);
        const openCandidates = latestControlMap.unresolved.filter((control) => (
          !isUnavailableControl(control)
        ));
        if (openCandidates.length === 1) {
          status.style.color = '#137333';
          status.textContent = '計画を保存しました。月間一括申請画面へ移動します…';
          openCandidates[0].click();
          return;
        }

        const dailyNote = latestUnconfirmedPatterns.length
          ? ` 固定パターンにない勤務時間（${latestUnconfirmedPatterns.join('、')}）は後で日別フォームへ入力します。`
          : '';
        status.style.color = '#9a5700';
        status.textContent = `計画を保存しました。月間一括のボタンを一意に判定できないため、手動で月間一括申請画面を開いてください。${dailyNote}`;
      } catch (error) {
        status.style.color = '#b3261e';
        status.textContent = `計画を保存できませんでした：${error.message}`;
      }
    });

    runWorkdaysButton.addEventListener('click', () => {
      if (!latestPlan || !latestControlMap) {
        status.style.color = '#b3261e';
        status.textContent = '先にプレビューを作成してください。';
        return;
      }

      try {
        const shiftsByDay = planToShiftMap(latestPlan);
        const dailyRequiredDays = [...shiftsByDay]
          .filter(([, shift]) => !OBSERVED_WORK_PATTERNS.has(shift.label))
          .map(([day]) => day);
        const defaultDays = dailyRequiredDays.filter((day) => {
          const control = latestControlMap.controlsByDay.get(day);
          return control
            && !isUnavailableControl(control)
            && !dayContainerShowsExistingApplication(control);
        });
        const suggestedDays = defaultDays.length ? defaultDays : dailyRequiredDays;
        if (!suggestedDays.length) {
          status.style.color = '#137333';
          status.textContent = '日別フォームで処理する勤務時間はありません。固定パターンは月間一括画面で処理できます。';
          return;
        }

        const rawDays = window.prompt(
          '連続申請する出勤日を確認してください。\n'
          + 'すでに申請した日は削除できます。例：1,8,15',
          suggestedDays.join(','),
        );
        if (rawDays === null) return;
        const queue = parseWorkDays(rawDays.replace(/日/g, ''), getDaysInMonth(
          latestPlan.year,
          latestPlan.monthNumber,
        ));
        if (!queue.length) throw new Error('連続申請する日を1日以上指定してください。');

        const invalidDays = queue.filter((day) => !shiftsByDay.has(day));
        if (invalidDays.length) {
          throw new Error(`${invalidDays.join(', ')}日は入力した勤務計画に含まれていません。`);
        }

        const runnerSettings = loadUserSettings();
        if (!runnerSettings) {
          throw new Error('先に「設定」で休憩時間を設定してください。');
        }
        if (!runnerSettings.autoSubmitEnabled) {
          throw new Error('「連続申請（自動で実際に申請する）を使う」がOFFです。設定を確認してから、もう一度プレビューを作成してください。');
        }
        const breakSummary = describeBreakSummary(runnerSettings);
        const details = queue.map((day) => `${day}日 ${shiftsByDay.get(day).label}`).join('\n');
        const confirmation = window.prompt(
          `次の${queue.length}日を自動で開き、入力後${AUTO_SUBMIT_COUNTDOWN_SECONDS}秒待って実際に申請します。\n`
          + `休憩：${breakSummary}\n申請メッセージ：${WORK.remark}\n\n`
          + `${details}\n\n実行する場合だけ「申請する」と入力してください。`,
          '',
        );
        if (confirmation !== '申請する') {
          status.style.color = '#9a5700';
          status.textContent = '連続申請を開始しませんでした。';
          return;
        }

        const existingRun = loadWorkdayRun();
        if (
          existingRun
          && !['paused', 'complete'].includes(existingRun.status)
          && !window.confirm('進行中の連続申請があります。新しい処理で置き換えますか？')
        ) {
          return;
        }

        saveSchedulePlan({ ...latestPlan, pendingDailyDay: null });
        const run = saveWorkdayRun(createWorkdayRun(latestPlan, queue));
        status.style.color = '#137333';
        status.textContent = `${queue.length}日分の連続申請を開始しました。右上の進行表示からいつでも停止できます。`;
        updateRunnerOverlay(`${getRunnerProgressText(run)}。最初の日を準備しています…`);
        window.setTimeout(handleMonthlyWorkdayRun, 500);
      } catch (error) {
        console.error('[KOT勤務日連続申請]', error);
        status.style.color = '#b3261e';
        status.textContent = `連続申請を開始できませんでした：${error.message}`;
      }
    });

    applyAutoSubmitVisibility(loadUserSettings());

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
    document.body.appendChild(container);
  }

  const activeCancellationRun = loadCancellationRun();
  if (isCancellationConfirmationPage()) {
    // 取消対象は保存済みの進行状態と照合してから実行する。
  } else if (isCancellationHistoryPage()) {
    createCancellationHelper();
  } else if (
    activeCancellationRun
    && ['ready', 'opening-confirmation', 'executing'].includes(activeCancellationRun.status)
  ) {
    // 取消後の遷移先が履歴一覧以外でも、他の自動入力UIは表示しない。
  } else if (isScheduleEditPage()) {
    createDailyHelper();
  } else if (isBatchApplicationPage()) {
    createBatchHelper();
  } else {
    createMonthlyPreview();
  }
  window.setTimeout(resumeWorkdayRunForCurrentPage, 600);
  window.setTimeout(resumeCancellationRunForCurrentPage, 650);
})();
