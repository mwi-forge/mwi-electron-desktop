// src/js/subscription-tab.js - Clash 订阅管理 tab (Clash Verge integration)
// 依赖: window.api.subscriptions.* (preload)
// 暴露 window.mwiSubscriptionsTab.open() / close() / refreshList() / showNodes()
(function () {
  // i18n helper
  function t(key, vars) {
    return (window.mwiI18n && window.mwiI18n.t) ? window.mwiI18n.t(key, vars) : key;
  }

  var mountId = 'canvas-subs-mount';
  var opened = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function latencyLabel(lat) {
    if (!lat) return "<span class='subs__latency subs__latency--na'>—</span>";
    if (lat.status === 'timeout') return "<span class='subs__latency subs__latency--timeout'>" + t('subscription.tab.alert.timeout') + "</span>";
    if (lat.status === 'refused') return "<span class='subs__latency subs__latency--refused'>" + t('subscription.tab.alert.refused') + "</span>";
    if (lat.rtt === null) return "<span class='subs__latency subs__latency--na'>—</span>";
    var cls = lat.rtt < 200 ? 'ok' : (lat.rtt < 500 ? 'mid' : 'slow');
    return "<span class='subs__latency subs__latency--" + cls + "'>" + lat.rtt + 'ms</span>';
  }

  function renderList(subs) {
    var host = document.getElementById('subs-list');
    if (!host) return;
    if (!subs || subs.length === 0) {
      host.innerHTML = "<div class='subs__empty'>" + t('subscription.tab.empty.no_subs') + "</div>";
      return;
    }
    var html = subs.map(function (s) {
      var st = s.status || 'idle';
      var stLabel = st === 'ok' ? t('subscription.tab.status.ok') : (st === 'error' ? t('subscription.tab.status.error') : (st === 'fetching' ? t('subscription.tab.status.fetching') : t('subscription.tab.status.idle')));
      var lastFetched = s.lastFetchedAt ? new Date(s.lastFetchedAt).toLocaleString() : '—';
      return [
        "<div class='subs__card' data-sub-id='" + s.id + "'>",
          "<div class='subs__card-head'><span class='subs__card-title'>" + esc(s.name) + "</span><span class='subs__card-status subs__card-status--" + st + "'>" + stLabel + '</span></div>',
          "<div class='subs__card-meta'>" + esc(s.url) + '</div>',
          "<div class='subs__card-meta'>" + t('subscription.tab.card.last_fetched_prefix', { time: lastFetched, n: (s.nodeCount || 0) }) + '</div>',
          "<div class='subs__card-actions'>",
            "<button data-action='refresh' data-id='" + s.id + "'>" + t('subscription.tab.btn.refresh') + "</button>",
            "<button data-action='measure' data-id='" + s.id + "'>" + t('subscription.tab.btn.measure_all') + "</button>",
            "<button data-action='view-nodes' data-id='" + s.id + "'>" + t('subscription.tab.btn.view_nodes') + "</button>",
            "<button data-action='delete' data-id='" + s.id + "' class='subs__danger'>" + t('subscription.tab.btn.delete') + "</button>",
          '</div>',
          "<div class='subs__nodes' id='subs-nodes-" + s.id + "'></div>",
        '</div>',
      ].join('');
    }).join('');
    host.innerHTML = html;
  }

  async function refreshList() {
    try {
      var list = await window.api.subscriptions.list();
      var withCount = [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var nodes = await window.api.subscriptions.listNodes(s.id);
        withCount.push(Object.assign({}, s, { nodeCount: (nodes || []).length }));
      }
      renderList(withCount);
      bindActions();
    } catch (e) { console.error('[subs-tab] refreshList failed', e); }
  }

  async function showNodes(subId) {
    var host = document.getElementById('subs-nodes-' + subId);
    if (!host) return;
    var nodes = await window.api.subscriptions.listNodes(subId);
    if (!nodes || nodes.length === 0) {
      host.innerHTML = "<div class='subs__empty'>" + t('subscription.tab.empty.no_nodes') + "</div>";
      return;
    }
    var html = nodes.map(function (n) {
      return [
        "<div class='subs__node'>",
          "<span class='subs__node-name'>" + esc(n.name) + '</span>',
          "<span class='subs__node-type'>" + esc(n.type || '?') + '</span>',
          "<span class='subs__node-server'>" + esc(n.server + ':' + n.port) + '</span>',
          latencyLabel(n.latency),
          "<button data-action='measure-one' data-sub-id='" + subId + "' data-node-id='" + esc(n.id) + "'>" + t('subscription.tab.btn.measure_one') + "</button>",
        '</div>',
      ].join('');
    }).join('');
    host.innerHTML = html;
  }

  function bindActions() {
    var root = document.getElementById('subs-root');
    if (!root) return;
    var q = function (sel, fn) { root.querySelectorAll(sel).forEach(fn); };

    q("[data-action='add']", function (btn) {
      btn.addEventListener('click', async function () {
        var name = document.getElementById('subs-name').value.trim();
        var url = document.getElementById('subs-url').value.trim();
        if (!url) { alert(t('subscription.tab.alert.url_required')); return; }
        btn.disabled = true; btn.textContent = t('subscription.tab.btn.importing');
        try {
          var r = await window.api.subscriptions.add({ name: name, url: url });
          if (!r.ok) { alert(t('subscription.tab.alert.import_fail', { error: r.error })); return; }
          document.getElementById('subs-url').value = '';
          await refreshList();
        } catch (e) { alert(t('subscription.tab.alert.import_err', { message: e.message })); }
        finally { btn.disabled = false; btn.textContent = t('subscription.tab.btn.import'); }
      });
    });

    q("[data-action='refresh']", function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.dataset.id;
        btn.disabled = true; btn.textContent = t('subscription.tab.btn.refreshing');
        try { await window.api.subscriptions.refresh(id); await refreshList(); }
        catch (e) { alert(t('subscription.tab.alert.refresh_fail', { message: e.message })); }
        finally { btn.disabled = false; btn.textContent = t('subscription.tab.btn.refresh'); }
      });
    });

    q("[data-action='measure']", function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.dataset.id;
        btn.disabled = true; btn.textContent = t('subscription.tab.btn.measuring_all');
        try { await window.api.subscriptions.measureNodes(id); await showNodes(id); }
        catch (e) { alert(t('subscription.tab.alert.measure_fail', { message: e.message })); }
        finally { btn.disabled = false; btn.textContent = t('subscription.tab.btn.measure_all'); }
      });
    });

    q("[data-action='view-nodes']", function (btn) {
      btn.addEventListener('click', function () { showNodes(btn.dataset.id); });
    });

    q("[data-action='delete']", function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.dataset.id;
        if (!confirm(t('subscription.tab.confirm.delete', { id: id }))) return;
        try { await window.api.subscriptions.delete(id); await refreshList(); }
        catch (e) { alert(t('subscription.tab.alert.delete_fail', { message: e.message })); }
      });
    });

    q("[data-action='measure-one']", function (btn) {
      btn.addEventListener('click', async function () {
        var subId = btn.dataset.subId, nodeId = btn.dataset.nodeId;
        btn.disabled = true; btn.textContent = t('subscription.tab.btn.measuring_one');
        try {
          var r = await window.api.subscriptions.measureNode(subId, nodeId);
          if (r.ok) await showNodes(subId);
        } catch (e) { alert(t('subscription.tab.alert.measure_one_fail', { message: e.message })); }
        finally { btn.disabled = false; btn.textContent = t('subscription.tab.btn.measure_one'); }
      });
    });
  }

  async function open() {
    opened = true;
    var mount = ensureMount();
    mount.hidden = false;
    mount.innerHTML = [
      "<div class='subs-root' id='subs-root'>",
        "<div class='subs__header'>" + t('subscription.tab.title') + "</div>",
        "<div class='subs__form'><input id='subs-name' placeholder='" + t('subscription.tab.placeholder.name') + "' /><input id='subs-url' placeholder='" + t('subscription.tab.placeholder.url') + "' /><button data-action='add'>" + t('subscription.tab.btn.import') + "</button></div>",
        "<div id='subs-list'></div>",
      '</div>',
    ].join('');
    await refreshList();
  }

  function ensureMount() {
    var el = document.getElementById(mountId);
    if (el) return el;
    el = document.createElement('div');
    el.id = mountId;
    el.className = 'canvas__form-mount';
    (document.querySelector('.canvas') || document.body).appendChild(el);
    return el;
  }

  async function close() {
    if (!opened) return;
    opened = false;
    var m = document.getElementById(mountId);
    if (m) { m.hidden = true; m.innerHTML = ''; }
  }

  window.mwiSubscriptionsTab = { open: open, close: close, refreshList: refreshList, showNodes: showNodes };

  // 语言切换时如果订阅 tab 正开着，重建一次以应用新 locale
  if (window.mwiI18n && window.mwiI18n.onChange) {
    window.mwiI18n.onChange(function () {
      if (opened) { open(); }
    });
  }
})();
