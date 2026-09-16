// src/js/settings-tab.js - 设置面板（静态 tab：locale + idle auto-stop + 关闭）
// 由 tabbar.openSettingsTab() 在 canvas 上挂载 .canvas__form-mount，关闭走 window.mwiTabbar.closeFormTab('settings')。
// 复用 .account-form-card / .account-form-card__form / .modal__btn 等样式（参见 src/css/account-form.css + per memory 2026-08-19 表单样式复用经验）。

(function () {
  'use strict';

  var MOUNT = 'canvas__form-mount';
  var CARD = 'account-form-card settings-tab';
  var FORM = 'account-form-card__form';

  // i18n 助手：mwiI18n 未就绪时回退 key 字面
  function t(key, vars) {
    return (window.mwiI18n && window.mwiI18n.t) ? window.mwiI18n.t(key, vars) : key;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // idle auto-stop fieldset（per openspec/changes/idle-auto-stop）
  // 异步从主进程拉当前配置；toggle / number 双向联动，submit 一起写回
  function buildIdleAutoStopFieldset() {
    var fs = document.createElement('fieldset');
    fs.className = 'settings-tab__idle-fieldset';
    fs.appendChild(el('legend', null, t('settings.idleAutoStop.label')));

    // row 1：toggle + minutes 在同一行紧凑排版
    var inputRow = el('div', 'settings-tab__idle-input-row');
    var enabledLabel = el('label', 'settings-tab__row settings-tab__toggle-row');
    var enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.id = 'settings-idle-enabled';
    enabledInput.name = 'idleAutoStopEnabled';
    enabledLabel.appendChild(enabledInput);
    var enabledText = el('span', null, t('settings.idleAutoStop.enabled'));
    enabledLabel.appendChild(enabledText);
    inputRow.appendChild(enabledLabel);

    var minutesLabel = el('label', 'settings-tab__row settings-tab__minutes-row');
    minutesLabel.htmlFor = 'settings-idle-minutes';
    var minutesInput = document.createElement('input');
    minutesInput.type = 'number';
    minutesInput.id = 'settings-idle-minutes';
    minutesInput.name = 'idleAutoStopMinutes';
    minutesInput.min = '1';
    minutesInput.max = '1440';
    minutesInput.step = '1';
    minutesInput.inputMode = 'numeric';
    minutesLabel.appendChild(minutesInput);
    // 滑块快捷调整（与数字输入双向联动）
    var minutesSlider = document.createElement('input');
    minutesSlider.type = 'range';
    minutesSlider.id = 'settings-idle-minutes-slider';
    minutesSlider.name = 'idleAutoStopMinutesSlider';
    minutesSlider.min = '1';
    minutesSlider.max = '1440';
    minutesSlider.step = '1';
    minutesLabel.appendChild(minutesSlider);
    minutesLabel.appendChild(el('span', 'settings-tab__minutes-suffix', t('settings.idleAutoStop.value', { n: '' }).replace(/\s*分钟\s*$|\s*min\s*$/i, '')));
    // number ↔ slider 双向联动
    minutesInput.addEventListener('input', function () {
      var v = parseInt(minutesInput.value, 10);
      if (isFinite(v) && v >= 1 && v <= 1440) minutesSlider.value = String(v);
    });
    minutesSlider.addEventListener('input', function () {
      minutesInput.value = minutesSlider.value;
    });
    inputRow.appendChild(minutesLabel);
    fs.appendChild(inputRow);

    // hint 文本
    fs.appendChild(el('div', 'settings-tab__hint', t('settings.idleAutoStop.hint')));

    // 异步拉当前 idle config：timeoutMs → minutes 回填；enabled 反推 toggle
    var initialEnabled = false;
    var initialMinutes = 5;
    var idleConfigPromise = (window.api && window.api.views && window.api.views.getIdleConfig)
      ? window.api.views.getIdleConfig()
      : Promise.resolve({ timeoutMs: 5 * 60 * 1000, enabled: true });
    idleConfigPromise.then(function (cfg) {
      initialEnabled = !!(cfg && cfg.enabled);
      initialMinutes = cfg && cfg.timeoutMs > 0 ? Math.max(1, Math.round(cfg.timeoutMs / 60000)) : 5;
      enabledInput.checked = initialEnabled;
      minutesInput.value = String(initialMinutes);
      minutesSlider.value = String(initialMinutes);
      minutesInput.disabled = !initialEnabled;
      minutesSlider.disabled = !initialEnabled;
    }).catch(function (_e) {
      // fallback：默认 5 分钟 / 已启用
      enabledInput.checked = true;
      minutesInput.value = '5';
      minutesSlider.value = '5';
      minutesInput.disabled = false;
      minutesSlider.disabled = false;
    });

    // toggle / number / slider 联动
    enabledInput.addEventListener('change', function () {
      minutesInput.disabled = !enabledInput.checked;
      minutesSlider.disabled = !enabledInput.checked;
    });

    return { fieldset: fs, getEnabledInput: function () { return enabledInput; }, getMinutesInput: function () { return minutesInput; } };
  }

  function buildForm() {
    var supported = (window.mwiI18n && window.mwiI18n.SUPPORTED) || ['zh-CN', 'en-US'];
    var current = (window.mwiI18n && window.mwiI18n.getLocale()) || 'zh-CN';

    var card = el('div', CARD);
    card.appendChild(el('div', 'account-form-card__title', t('settings.title')));

    var form = el('form', FORM);
    form.autocomplete = 'off';

    // locale fieldset（保留既有结构）
    var fs = document.createElement('fieldset');
    fs.appendChild(el('legend', null, t('settings.legend')));
    fs.appendChild(el('label', null, t('settings.label.locale')));
    var labelNode = fs.lastChild;
    labelNode.htmlFor = 'settings-locale';

    var sel = document.createElement('select');
    sel.id = 'settings-locale';
    sel.name = 'locale';
    for (var i = 0; i < supported.length; i++) {
      var code = supported[i];
      var opt = document.createElement('option');
      opt.value = code;
      opt.textContent = t('settings.locale_label.' + code);
      if (code === current) opt.selected = true;
      sel.appendChild(opt);
    }
    fs.appendChild(sel);
    fs.appendChild(el('div', 'settings-tab__hint', t('settings.hint')));

    form.appendChild(fs);

    // idle auto-stop fieldset
    var idle = buildIdleAutoStopFieldset();
    form.appendChild(idle.fieldset);

    var actions = el('div', 'account-form-card__actions');
    var saveBtn = el('button', 'modal__btn modal__btn--primary', t('settings.btn.save'));
    saveBtn.type = 'submit';
    var cancelBtn = el('button', 'modal__btn', t('settings.btn.close_tab'));
    cancelBtn.type = 'button';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    form.appendChild(actions);

    card.appendChild(form);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = sel.value;
      // locale 优先落（renderer 侧同步落 document.documentElement.lang）
      if (window.mwiI18n) window.mwiI18n.setLocale(code);
      // idle auto-stop 异步写主进程（setLocale 立即返回，setIdleConfig await 即可，
      // // 失败也不阻塞关 tab——per design R4 写失败静默 fallback）
      var enabledInput = idle.getEnabledInput();
      var minutesInput = idle.getMinutesInput();
      var minutes = parseInt(minutesInput.value, 10);
      if (!isFinite(minutes) || minutes < 1) minutes = 1;
      if (minutes > 1440) minutes = 1440;
      var payloadMs = enabledInput.checked ? (minutes * 60000) : 0;
      if (window.api && window.api.views && window.api.views.setIdleConfig) {
        window.api.views.setIdleConfig({ timeoutMs: payloadMs }).catch(function (err) {
          console.warn('[settings-tab] setIdleConfig failed:', err && err.message);
        });
      }
      if (window.mwiTabbar && typeof window.mwiTabbar.closeFormTab === 'function') {
        window.mwiTabbar.closeFormTab('settings');
      }
    });
    cancelBtn.addEventListener('click', function () {
      if (window.mwiTabbar && typeof window.mwiTabbar.closeFormTab === 'function') {
        window.mwiTabbar.closeFormTab('settings');
      }
    });

    return card;
  }

  function open() {
    var mount = document.querySelector('.' + MOUNT);
    if (!mount) {
      console.warn('[settings-tab] .canvas__form-mount not found in DOM; settings tab cannot render');
      return;
    }
    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(buildForm());
    mount.hidden = false;
  }

  function close() {
    var mount = document.querySelector('.' + MOUNT);
    if (!mount) return;
    mount.hidden = true;
    while (mount.firstChild) mount.removeChild(mount.firstChild);
  }

  window.mwiSettings = { open: open, close: close };

  // 语言切换时如果 settings tab 正开着，重新挂载一次以更新 locale 标签
  if (window.mwiI18n && window.mwiI18n.onChange) {
    window.mwiI18n.onChange(function () {
      var mount = document.querySelector('.' + MOUNT);
      if (mount && !mount.hidden && mount.firstChild) {
        open();
      }
    });
  }
})();
