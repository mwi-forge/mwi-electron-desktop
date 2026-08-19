// src/js/settings-tab.js - 设置面板（静态 tab：仅 locale 切换 + 关闭）
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

  function buildForm() {
    var supported = (window.mwiI18n && window.mwiI18n.SUPPORTED) || ['zh-CN', 'en-US'];
    var current = (window.mwiI18n && window.mwiI18n.getLocale()) || 'zh-CN';

    var card = el('div', CARD);
    card.appendChild(el('div', 'account-form-card__title', t('settings.title')));

    var form = el('form', FORM);
    form.autocomplete = 'off';

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
      if (window.mwiI18n) window.mwiI18n.setLocale(code);
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
