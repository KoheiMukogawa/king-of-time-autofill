// ==UserScript==
// @name         KING OF TIME 月間一括申請フォーム調査
// @namespace    local.kot.helper
// @version      0.1.0
// @description  月間一括申請画面のフォーム構造を安全に調査します。入力・クリック・申請は行いません。
// @match        https://s2.ta.kingoftime.jp/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_ID = 'kot-batch-inspector-button';
  const MODAL_ID = 'kot-batch-inspector-modal';
  const MAX_CONTROLS = 1200;
  const MAX_OPTIONS_PER_SELECT = 100;

  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  function getControlText(element) {
    if (element instanceof HTMLInputElement) {
      return normalize(element.value || element.getAttribute('aria-label'));
    }
    return normalize(
      element.textContent
      || element.getAttribute('aria-label')
      || element.getAttribute('title'),
    );
  }

  function getLabelText(element) {
    if (element.id) {
      const escapedId = window.CSS?.escape
        ? window.CSS.escape(element.id)
        : element.id.replace(/["\\]/g, '\\$&');
      const label = document.querySelector(`label[for="${escapedId}"]`);
      if (label) return normalize(label.textContent).slice(0, 160);
    }

    const wrappingLabel = element.closest('label');
    return wrappingLabel ? normalize(wrappingLabel.textContent).slice(0, 160) : null;
  }

  function getRowInfo(element) {
    const row = element.closest('tr, [role="row"], li');
    if (!row) return { rowIndex: null, rowText: null };

    const allRows = [...document.querySelectorAll('tr, [role="row"], li')];
    return {
      rowIndex: allRows.indexOf(row),
      rowText: normalize(row.textContent).slice(0, 500),
    };
  }

  function describeControl(element, index) {
    const base = {
      index,
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute('type'),
      id: element.id || null,
      name: element.getAttribute('name'),
      class: normalize(element.className) || null,
      label: getLabelText(element),
      disabled: Boolean(element.disabled),
      readOnly: Boolean(element.readOnly),
      required: Boolean(element.required),
      placeholder: element.getAttribute('placeholder'),
      ariaLabel: element.getAttribute('aria-label'),
      ...getRowInfo(element),
    };

    if (element instanceof HTMLSelectElement) {
      return {
        ...base,
        selectedText: normalize(element.options[element.selectedIndex]?.textContent),
        selectedValue: element.value,
        optionCount: element.options.length,
        options: [...element.options]
          .slice(0, MAX_OPTIONS_PER_SELECT)
          .map((option) => ({
            text: normalize(option.textContent),
            value: option.value,
            disabled: option.disabled,
          })),
      };
    }

    if (element instanceof HTMLInputElement) {
      return {
        ...base,
        checked: ['checkbox', 'radio'].includes(element.type) ? element.checked : undefined,
        min: element.getAttribute('min'),
        max: element.getAttribute('max'),
        step: element.getAttribute('step'),
        maxLength: element.maxLength >= 0 ? element.maxLength : null,
        // 入力値は個人情報を避けるため収集しない。
        hasValue: !['button', 'submit', 'reset'].includes(element.type)
          ? Boolean(element.value)
          : undefined,
        text: ['button', 'submit', 'reset'].includes(element.type)
          ? getControlText(element)
          : undefined,
      };
    }

    if (element instanceof HTMLTextAreaElement) {
      return {
        ...base,
        rows: element.rows,
        hasValue: Boolean(element.value),
      };
    }

    if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) {
      return {
        ...base,
        text: getControlText(element),
        hrefPresent: element instanceof HTMLAnchorElement
          ? Boolean(element.getAttribute('href'))
          : undefined,
      };
    }

    return base;
  }

  function describeForm(form, index) {
    let actionPath = null;
    try {
      actionPath = form.action ? new URL(form.action, location.href).pathname : null;
    } catch (_) {
      actionPath = null;
    }

    return {
      index,
      id: form.id || null,
      name: form.getAttribute('name'),
      method: form.method || null,
      actionPath,
      controlCount: form.elements.length,
    };
  }

  function buildReport() {
    const selector = [
      'select',
      'input:not([type="hidden"]):not([type="password"]):not([type="file"])',
      'textarea',
      'button',
      'a[href]',
    ].join(',');

    const controls = [...document.querySelectorAll(selector)]
      .filter((element) => !element.closest(`#${BUTTON_ID}, #${MODAL_ID}`))
      .slice(0, MAX_CONTROLS);
    const forms = [...document.forms];

    return {
      generatedAt: new Date().toISOString(),
      page: {
        origin: location.origin,
        pathname: location.pathname,
        title: document.title,
      },
      pageSignals: {
        formCount: forms.length,
        totalControlCount: document.querySelectorAll(selector).length,
        capturedControlCount: controls.length,
        scheduleApplicationControlCount: controls.filter((element) => (
          getControlText(element).includes('スケジュール申請')
        )).length,
        applyControlCount: controls.filter((element) => (
          /申請する|スケジュール申請/.test(getControlText(element))
        )).length,
      },
      forms: forms.map(describeForm),
      controls: controls.map(describeControl),
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      Object.assign(textarea.style, {
        position: 'fixed',
        left: '-9999px',
        opacity: '0',
      });
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  }

  function showReport() {
    document.getElementById(MODAL_ID)?.remove();

    const reportText = JSON.stringify(buildReport(), null, 2);
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: 'rgba(0, 0, 0, .5)',
      boxSizing: 'border-box',
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, {
      width: 'min(1000px, 96vw)',
      maxHeight: '92vh',
      overflow: 'auto',
      padding: '16px',
      borderRadius: '10px',
      background: '#fff',
      color: '#17212b',
      boxShadow: '0 12px 40px rgba(0, 0, 0, .3)',
      fontFamily: 'sans-serif',
    });

    const title = document.createElement('div');
    title.textContent = 'KOT 月間一括申請フォーム調査結果';
    Object.assign(title.style, {
      marginBottom: '8px',
      fontSize: '16px',
      fontWeight: '700',
    });

    const note = document.createElement('div');
    note.textContent = '入力値・パスワード・ファイルは収集しません。申請や画面操作も行いません。';
    Object.assign(note.style, {
      marginBottom: '8px',
      fontSize: '12px',
    });

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.value = reportText;
    Object.assign(textarea.style, {
      width: '100%',
      height: '62vh',
      padding: '10px',
      border: '1px solid #aeb8c2',
      boxSizing: 'border-box',
      fontFamily: 'monospace',
      fontSize: '12px',
    });

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      gap: '8px',
      marginTop: '10px',
    });

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = '調査結果をコピー';
    copyButton.addEventListener('click', async () => {
      const copied = await copyText(reportText);
      copyButton.textContent = copied ? 'コピーしました' : 'コピーできませんでした';
    });

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', () => overlay.remove());

    for (const button of [copyButton, closeButton]) {
      Object.assign(button.style, {
        padding: '8px 14px',
        border: '1px solid #aeb8c2',
        borderRadius: '6px',
        background: '#f7f9fb',
        cursor: 'pointer',
      });
    }

    actions.append(copyButton, closeButton);
    panel.append(title, note, textarea, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  function addInspectorButton() {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'KOT 月間フォーム調査';
    Object.assign(button.style, {
      position: 'fixed',
      left: '16px',
      bottom: '16px',
      zIndex: '2147483646',
      padding: '10px 14px',
      border: '0',
      borderRadius: '8px',
      background: '#222',
      color: '#fff',
      fontWeight: '700',
      cursor: 'pointer',
    });
    button.addEventListener('click', showReport);
    document.body.appendChild(button);
  }

  addInspectorButton();
})();
