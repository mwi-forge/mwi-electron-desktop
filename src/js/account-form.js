// src/js/account-form.js - 账号表单逻辑（中部 canvas 静态 tab 嵌入）
// 由 tabbar.js 切到 form tab 时调用 window.mwiAccountForm.open({isEdit, account})
// 表单字段参考原 sidebar.js inline DOM 版本（保持字段、行为一致）

(function () {
  // i18n 助手：mwiI18n 未就绪时回退 key 字面
  function t(key, vars) {
    return (window.mwiI18n && window.mwiI18n.t) ? window.mwiI18n.t(key, vars) : key;
  }

  let mountNode = null;
  let unsubAccounts = null;
  let onCloseCb = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function makeLabel(text, name, type, value, attrs) {
    var lbl = document.createElement('label');
    lbl.textContent = text;
    var input = document.createElement('input');
    input.name = name;
    if (type) input.type = type;
    if (value != null && value !== '') input.value = value;
    if (attrs) for (var k in attrs) input.setAttribute(k, attrs[k]);
    lbl.appendChild(input);
    return lbl;
  }

  function makeSelectLabel(text, name, options) {
    var lbl = document.createElement('label');
    lbl.textContent = text;
    var sel = document.createElement('select');
    sel.name = name;
    (options || []).forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.selected) opt.selected = true;
      sel.appendChild(opt);
    });
    lbl.appendChild(sel);
    return { label: lbl, select: sel };
  }

  function buildForm(payload, ctx) {
    var isEdit = !!payload.isEdit;
    var account = payload.account || null;

    var card = document.createElement('div');
    card.className = 'account-form-card';

    var title = document.createElement('div');
    title.className = 'account-form-card__title';
    title.textContent = isEdit ? t('account.form.title_edit') : t('account.form.title_new');
    card.appendChild(title);

    var form = document.createElement('form');
    form.className = 'account-form-card__form';
    form.id = 'account-form';

    // 分组 select
    var groupWrap = makeSelectLabel(t('account.form.field.group'), 'groupId', []);
    var groupSelect = groupWrap.select;
    var groupOptions = (ctx.groups || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    groupOptions.forEach(function (g) {
      var opt = document.createElement('option');
      opt.value = String(g.id);
      // group.name 是用户数据，但默认组名（默认分组 / 农场号）来自 lib/accounts.js schema
      // 在 sidebar 已做翻译映射；这里同样保持一致：渲染时检查 + 转
      opt.textContent = String(displayGroupNameSync(g.name) || g.id);
      if (account && String(account.groupId) === String(g.id)) opt.selected = true;
      groupSelect.appendChild(opt);
    });
    form.appendChild(groupWrap.label);

    form.appendChild(makeLabel(t('account.form.field.name'), 'name', null, account ? account.name : '', { required: '', placeholder: t('account.form.placeholder.name') }));
    form.appendChild(makeLabel(t('account.form.field.url'), 'url', null, account ? account.url : 'https://www.milkywayidle.com/game', { required: '', placeholder: t('account.form.placeholder.url') }));

    var fpWrap = makeSelectLabel(t('account.form.field.fingerprint'), 'fingerprintPreset', []);
    var fpSelect = fpWrap.select;
    var presets = ctx.presets || [];
    var matched = false;
    presets.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = String(p.label || p.id);
      if (account && account.fingerprintPreset === String(p.id)) { opt.selected = true; matched = true; }
      else if (!account && String(p.id) === String(ctx.defaultPreset)) { opt.selected = true; matched = true; }
      fpSelect.appendChild(opt);
    });
    if (account && account.fingerprintPreset && !matched) {
      var custom = document.createElement('option');
      custom.value = String(account.fingerprintPreset);
      custom.textContent = String(account.fingerprintPreset) + t('account.form.fingerprint.custom_suffix');
      custom.selected = true;
      fpSelect.appendChild(custom);
    }
    var fpLabel = fpWrap.label;
    var fpHint = document.createElement('span');
    fpHint.className = 'modal__hint';
    fpHint.textContent = t('account.form.hint.fingerprint');
    fpLabel.appendChild(fpHint);
    form.appendChild(fpLabel);

    form.appendChild(makeLabel(t('account.form.field.userAgent'), 'userAgent', null,
      account && account.userAgent ? account.userAgent : '',
      { placeholder: t('account.form.placeholder.userAgent') }));

    var fs = document.createElement('fieldset');
    fs.className = 'modal__fieldset';
    var legend = document.createElement('legend');
    legend.textContent = t('account.form.proxy.legend');
    fs.appendChild(legend);

    var proxyTypeWrap = makeSelectLabel(t('account.form.proxy.type'), 'proxyType', [
      { value: '', label: t('account.form.proxy.type.none') },
      { value: 'socks5', label: t('account.form.proxy.type.socks5') },
      { value: 'http', label: t('account.form.proxy.type.http') },
      { value: 'subscription', label: t('account.form.proxy.type.subscription') }
    ]);
    var proxyTypeSel = proxyTypeWrap.select;
    var preProxyType = null;
    if (account && account.proxy) {
      preProxyType = account.proxy.source === 'subscription' ? 'subscription' : (account.proxy.type || null);
    }
    if (preProxyType) {
      for (var i = 0; i < proxyTypeSel.options.length; i++) {
        if (proxyTypeSel.options[i].value === preProxyType) { proxyTypeSel.options[i].selected = true; break; }
      }
    }
    fs.appendChild(proxyTypeWrap.label);

    var manualHostLbl = makeLabel(t('account.form.proxy.host'), 'proxyHost', null,
      account && account.proxy ? (account.proxy.host || '') : '',
      { placeholder: t('account.form.placeholder.proxy.host') });
    manualHostLbl.className = 'account-form-card__manual-proxy';
    fs.appendChild(manualHostLbl);
    var manualPortLbl = makeLabel(t('account.form.proxy.port'), 'proxyPort', 'number',
      account && account.proxy ? (account.proxy.port || '') : '',
      { placeholder: t('account.form.placeholder.proxy.port') });
    manualPortLbl.className = 'account-form-card__manual-proxy';
    fs.appendChild(manualPortLbl);
    var manualUserLbl = makeLabel(t('account.form.proxy.username'), 'proxyUsername', null,
      account && account.proxy ? (account.proxy.username || '') : '');
    manualUserLbl.className = 'account-form-card__manual-proxy';
    fs.appendChild(manualUserLbl);
    var manualPassLbl = makeLabel(t('account.form.proxy.password'), 'proxyPassword', 'password', null,
      { placeholder: t('account.form.placeholder.proxy.password') });
    manualPassLbl.className = 'account-form-card__manual-proxy';
    fs.appendChild(manualPassLbl);

    var subsWrap = document.createElement('div');
    subsWrap.className = 'account-form-card__subs';
    subsWrap.hidden = true;
    var subsSelWrap = makeSelectLabel(t('account.form.proxy.sub'), 'proxySubId', []);
    var subsSelect = subsSelWrap.select;
    subsWrap.appendChild(subsSelWrap.label);
    var nodeSelWrap = makeSelectLabel(t('account.form.proxy.node'), 'proxyNodeId', []);
    var nodeSelect = nodeSelWrap.select;
    subsWrap.appendChild(nodeSelWrap.label);
    var exclLbl = document.createElement('label');
    exclLbl.className = 'account-form-card__exclusive';
    var exclChk = document.createElement('input');
    exclChk.type = 'checkbox';
    exclChk.name = 'proxyExclusive';
    exclChk.checked = !!(account && account.proxy && account.proxy.source === 'subscription' && account.proxy.exclusive);
    exclLbl.appendChild(exclChk);
    exclLbl.appendChild(document.createTextNode(t('account.form.proxy.exclusive')));
    subsWrap.appendChild(exclLbl);
    fs.appendChild(subsWrap);
    form.appendChild(fs);

    var loadSubscriptions = function () {
      subsSelect.innerHTML = '';
      window.api.subscriptions.list().then(function (subs) {
        (subs || []).forEach(function (s) {
          var opt = document.createElement('option');
          opt.value = String(s.id);
          opt.textContent = String(s.name || s.id);
          if (account && account.proxy && account.proxy.source === 'subscription' && String(account.proxy.subscriptionId) === String(s.id)) {
            opt.selected = true;
          }
          subsSelect.appendChild(opt);
        });
        if (subsSelect.options.length > 0) loadNodes(true);
      }).catch(function (e) {});
    };
    var loadNodes = function (preselectNode) {
      var subId = subsSelect.value;
      if (!subId) { nodeSelect.innerHTML = ''; return; }
      nodeSelect.innerHTML = '';
      window.api.subscriptions.listNodes(subId).then(function (nodes) {
        (nodes || []).forEach(function (n) {
          var opt = document.createElement('option');
          opt.value = String(n.id);
          opt.textContent = String(n.name || n.id);
          if (preselectNode && account && account.proxy && account.proxy.source === 'subscription' && String(account.proxy.nodeId) === String(n.id)) {
            opt.selected = true;
          }
          nodeSelect.appendChild(opt);
        });
      }).catch(function (e) {});
    };
    subsSelect.addEventListener('change', function () { loadNodes(false); });
    var toggleManualFields = function (show) {
      var els = fs.querySelectorAll('.account-form-card__manual-proxy');
      for (var j = 0; j < els.length; j++) els[j].hidden = !show;
    };
    var syncSubsVisibility = function () {
      var show = String(proxyTypeSel.value || '') === 'subscription';
      subsWrap.hidden = !show;
      toggleManualFields(!show);
      if (show && subsSelect.options.length === 0) loadSubscriptions();
    };
    proxyTypeSel.addEventListener('change', syncSubsVisibility);
    if (preProxyType === 'subscription') { subsWrap.hidden = false; toggleManualFields(false); setTimeout(function () { loadSubscriptions(); }, 50); }

    var actions = document.createElement('div');
    actions.className = 'account-form-card__actions';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.id = 'account-form-cancel';
    cancelBtn.textContent = t('account.form.btn.cancel');
    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn--accent';
    submitBtn.id = 'account-form-submit';
    submitBtn.textContent = isEdit ? t('account.form.btn.submit_edit') : t('account.form.btn.submit_new');
    actions.appendChild(cancelBtn);
    actions.appendChild(submitBtn);
    form.appendChild(actions);

    card.appendChild(form);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      cancelBtn.disabled = true;
      var f = ev.target;
      var hiddenVal = function (n) {
        var el = form.querySelector('input[name=' + JSON.stringify(n) + ']');
        return el ? el.value : '';
      };
      var data = {
        name: f.name.value.trim(),
        url: f.url.value.trim(),
        groupId: hiddenVal('groupId'),
        fingerprintPreset: hiddenVal('fingerprintPreset').trim(),
      };
      var ua = f.userAgent.value.trim();
      if (ua) data.userAgent = ua;
      var ptype = hiddenVal('proxyType');
      var phost = f.proxyHost.value.trim();
      var pport = parseInt(f.proxyPort.value, 10);
      if (ptype === '') {
        data.proxy = null;
      } else if (ptype === 'subscription') {
        var subId = subsSelect.value;
        var nodeId = nodeSelect.value;
        if (!subId || !nodeId) {
          window.mwiAlert.alert({ type: 'warn', message: t('account.form.alert.select_sub_node') });
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          return;
        }
        var excl = form.querySelector('input[name=proxyExclusive]');
        data.proxy = {
          source: 'subscription',
          subscriptionId: subId,
          nodeId: nodeId,
          exclusive: !!(excl && excl.checked),
        };
      } else if (phost && pport) {
        data.proxy = {
          type: ptype,
          host: phost,
          port: pport,
          username: f.proxyUsername.value.trim() || null,
          password: f.proxyPassword.value || null,
        };
      }
      try {
        if (isEdit) {
          await window.api.accounts.update(account.id, data);
        } else {
          await window.api.accounts.create(data);
        }
        if (onCloseCb) onCloseCb({ ok: true });
      } catch (e) {
        window.mwiAlert.alert({ type: 'error', message: t('account.form.alert.fail', { message: e.message || e }) });
        submitBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener('click', function () {
      if (onCloseCb) onCloseCb({ ok: false, cancelled: true });
    });

    if (window.mwiCustomSelect && typeof window.mwiCustomSelect.replace === 'function') {
      var sels = [groupSelect, fpSelect, proxyTypeSel];
      for (var s = 0; s < sels.length; s++) {
        try { window.mwiCustomSelect.replace(sels[s]); } catch (e) {}
      }
    }

    return card;
  }

  // 同步版 displayGroupName（与 sidebar.js 行为一致）：
  // 默认组名（'默认分组'/'农场号'）来自 lib/accounts.js schema，
  // 渲染时按 name 翻译，已持久化的旧数据无需迁移也能翻译
  var DEFAULT_GROUP_NAMES = {
    '默认分组': 'sidebar.group.default_name',  // grp_farm 已删除（per 2026-08-19 user）
  };
  function displayGroupNameSync(name) {
    var key = DEFAULT_GROUP_NAMES[name];
    return key ? t(key) : name;
  }

  async function open(payload, ctx) {
    if (!ctx) ctx = {};
    if (!mountNode) mountNode = document.getElementById('canvas-form-mount');
    if (!mountNode) { console.error('[account-form] #canvas-form-mount missing'); return; }
    onCloseCb = ctx.onClose || null;

    mountNode.innerHTML = '';
    mountNode.hidden = false;

    var placeholder = document.querySelector('.canvas__placeholder');
    if (placeholder) placeholder.hidden = true;

    var loading = document.createElement('div');
    loading.className = 'account-form-loading';
    loading.textContent = t('account.form.loading');
    mountNode.appendChild(loading);

    var groups = [];
    var presets = [];
    try { groups = await window.api.groups.list() || []; } catch (e) {}
    try { presets = await window.api.fingerprint.listPresets() || []; } catch (e) {}

    mountNode.innerHTML = '';
    var formNode = buildForm(payload, {
      groups: groups,
      presets: presets,
      defaultPreset: 'preset_01',
    });
    mountNode.appendChild(formNode);

    // 缓存当前 payload/ctx 以便 onChange 重渲（per 翻译不完整修复）
    currentPayload = payload;
    currentCtx = ctx;
  }

  let currentPayload = null;
  let currentCtx = null;

  function close() {
    if (mountNode) {
      mountNode.innerHTML = '';
      mountNode.hidden = true;
    }
    var placeholder = document.querySelector('.canvas__placeholder');
    if (placeholder) placeholder.hidden = false;
    onCloseCb = null;
    currentPayload = null;
    currentCtx = null;
  }

  // 暴露
  window.mwiAccountForm = { open: open, close: close };

  // 语言切换时如果表单正打开着，重建一次以应用新 locale
  if (window.mwiI18n && window.mwiI18n.onChange) {
    window.mwiI18n.onChange(function () {
      if (currentPayload && mountNode && !mountNode.hidden) {
        var placeholder = document.querySelector('.canvas__placeholder');
        if (placeholder) placeholder.hidden = true;
        // 简单重渲（不重建数据，因为 groups/presets 跟 locale 无关）
        mountNode.innerHTML = '';
        mountNode.appendChild(buildForm(currentPayload, currentCtx || {}));
      }
    });
  }
})();
