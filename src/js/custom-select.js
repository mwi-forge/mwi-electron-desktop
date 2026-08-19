// custom-select.js — 自定义 listbox（取代原生 <select> 让 options 走 DSH 深色主题）
//
// 浏览器限制：<option> 列表由 OS 渲染（macOS Chrome = 系统浅色面板），CSS 完全碰不到。
// 这里用 div + role=listbox/option 自管理弹层重写，支持：
//   - 点击触发 / 点击外部关闭 / ESC 关闭
//   - 键盘导航：ArrowDown/Up 移动 / Enter 选择 / Home/End 跳首尾 / Tab 自动关闭
//   - aria-selected / role=listbox 屏幕阅读器可达
//   - hidden <input> 同步 value，form submit 直接读 input.value
//
// 用法：
//   const el = document.querySelector("select#groupId");
//   window.mwiCustomSelect.replace(el);
//   form submit: document.querySelector("input[name=groupId]").value

(function () {
  var BQ = String.fromCharCode(96);
  var AMP = String.fromCharCode(38);
  var LT = String.fromCharCode(60);
  var GT = String.fromCharCode(62);
  var QUOT = String.fromCharCode(34);
  var APOS = String.fromCharCode(39);

  function escapeHtml(s) {
    var str = String(s == null ? "" : "");
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (c === AMP) out = out + AMP + "amp;";
      else if (c === LT) out = out + AMP + "lt;";
      else if (c === GT) out = out + AMP + "gt;";
      else if (c === QUOT) out = out + AMP + "quot;";
      else if (c === APOS) out = out + AMP + "#39;";
      else out = out + c;
    }
    return out;
  }

  var _uid = 0;
  function nextId(prefix) { return prefix + (++_uid); }

  var _instanceCache = Object.create(null);
  _instanceCache.get = function (k) { return this["_" + (k._csId || "")]; };
  _instanceCache.set = function (k, v) { k._csId = ++this._seq || (this._seq = 1); this["_" + k._csId] = v; };
  _instanceCache.delete = function (k) { if (k._csId) { delete this["_" + k._csId]; } };

  function replace(native) {
    if (!native || native.tagName !== "SELECT") return null;
    if (native.dataset.customSelectReady === "1") return _instanceCache.get(native) || null;
    native.dataset.customSelectReady = "1";

    var options = [];
    for (var i = 0; i < native.options.length; i++) {
      var o = native.options[i];
      options.push({ value: String(o.value), label: String(o.textContent || o.value), disabled: !!o.disabled });
    }
    var name = native.getAttribute("name") || "";
    var placeholder = native.getAttribute("data-placeholder") || "";
    var selectedValue = String(native.value || "");
    var hasSel = false;
    for (var j = 0; j < options.length; j++) if (options[j].value === selectedValue) { hasSel = true; break; }
    if (!hasSel) selectedValue = options.length ? options[0].value : "";

    native.style.display = "none";

    var root = document.createElement("div");
    root.className = "custom-select";
    root.setAttribute("data-custom-select", "1");
    var triggerId = nextId("cs-trigger-");
    var listId = nextId("cs-list-");

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select__trigger";
    trigger.id = triggerId;
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", listId);
    var label = document.createElement("span");
    label.className = "custom-select__label";
    var chevron = document.createElement("span");
    chevron.className = "custom-select__chevron";
    trigger.appendChild(label);
    trigger.appendChild(chevron);

    var popover = document.createElement("ul");
    popover.className = "custom-select__popover";
    popover.id = listId;
    popover.setAttribute("role", "listbox");
    popover.setAttribute("tabindex", "-1");
    popover.hidden = true;
    popover.addEventListener("mousedown", function (e) { e.preventDefault(); });

    var hidden = document.createElement("input");
    hidden.type = "hidden";
    if (name) hidden.name = name;
    hidden.value = selectedValue;

    native.parentNode.insertBefore(root, native.nextSibling);
    root.appendChild(trigger);
    root.appendChild(popover);
    native.parentNode.insertBefore(hidden, root.nextSibling);

    var optionNodes = [];
    function renderOptions() {
      popover.innerHTML = "";
      optionNodes.length = 0;
      for (var k = 0; k < options.length; k++) {
        var opt = options[k];
        var li = document.createElement("li");
        li.className = "custom-select__option";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(opt.value === selectedValue));
        li.dataset.value = opt.value;
        li.dataset.index = String(k);
        if (opt.disabled) li.setAttribute("aria-disabled", "true");
        var check = document.createElement("span");
        check.className = "custom-select__check";
        li.appendChild(check);
        var txt = document.createElement("span");
        txt.className = "custom-select__option-label";
        txt.textContent = opt.label;
        li.appendChild(txt);
        if (opt.value === selectedValue) li.classList.add("custom-select__option--selected");
        (function (val, dis) {
          li.addEventListener("click", function () {
            if (dis) return;
            selectValue(val);
            close();
            trigger.focus();
          });
          li.addEventListener("mouseenter", function () {
            if (dis) return;
            setHighlight(parseInt(li.dataset.index, 10));
          });
        })(opt.value, opt.disabled);
        popover.appendChild(li);
        optionNodes.push(li);
      }
    }
    renderOptions();

    function renderLabel() {
      var cur = null;
      for (var m = 0; m < options.length; m++) if (options[m].value === selectedValue) { cur = options[m]; break; }
      if (cur) {
        label.textContent = cur.label;
        label.classList.remove("custom-select__label--placeholder");
      } else if (placeholder) {
        label.textContent = placeholder;
        label.classList.add("custom-select__label--placeholder");
      } else {
        label.textContent = "";
      }
    }
    renderLabel();

    var isOpen = false;
    var highlightIndex = -1;

    function setHighlight(idx) {
      while (idx >= 0 && idx < options.length && options[idx].disabled) idx = idx + 1;
      if (idx >= options.length) idx = -1;
      for (var n = 0; n < optionNodes.length; n++) {
        optionNodes[n].classList.toggle("custom-select__option--highlight", n === idx);
      }
      highlightIndex = idx;
      if (idx >= 0 && optionNodes[idx]) optionNodes[idx].scrollIntoView({ block: "nearest" });
    }

    function selectValue(v) {
      selectedValue = v;
      hidden.value = v;
      native.value = v;
      try { native.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
      renderLabel();
      for (var p = 0; p < optionNodes.length; p++) {
        var li = optionNodes[p];
        var isSel = li.dataset.value === v;
        li.classList.toggle("custom-select__option--selected", isSel);
        li.setAttribute("aria-selected", String(isSel));
      }
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      root.classList.add("custom-select--open");
      trigger.setAttribute("aria-expanded", "true");
      popover.hidden = false;
      var curIdx = -1;
      for (var q = 0; q < options.length; q++) if (options[q].value === selectedValue) { curIdx = q; break; }
      setHighlight(curIdx);
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      root.classList.remove("custom-select--open");
      trigger.setAttribute("aria-expanded", "false");
      popover.hidden = true;
    }

    function toggle() {
      if (isOpen) close(); else open();
    }

    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      toggle();
    });
    trigger.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (!isOpen) open();
        else if (highlightIndex >= 0) { selectValue(options[highlightIndex].value); close(); trigger.focus(); }
      } else if (e.key === "ArrowDown" || (e.altKey && e.key === "ArrowDown")) {
        e.preventDefault();
        if (!isOpen) open();
        else setHighlight(highlightIndex < 0 ? 0 : Math.min(highlightIndex + 1, options.length - 1));
      } else if (e.key === "ArrowUp" || (e.altKey && e.key === "ArrowUp")) {
        e.preventDefault();
        if (!isOpen) open();
        else setHighlight(highlightIndex < 0 ? 0 : Math.max(highlightIndex - 1, 0));
      } else if (e.key === "Escape") {
        if (isOpen) { e.preventDefault(); close(); }
      } else if (e.key === "Home") {
        if (isOpen) { e.preventDefault(); setHighlight(0); }
      } else if (e.key === "End") {
        if (isOpen) { e.preventDefault(); setHighlight(options.length - 1); }
      } else if (e.key === "Tab") {
        close();
      }
    });

    function onDocPointer(e) {
      if (!isOpen) return;
      if (!root.contains(e.target) && !popover.contains(e.target)) close();
    }
    document.addEventListener("mousedown", onDocPointer, true);

    function onWindowScroll() { if (isOpen) close(); }
    window.addEventListener("scroll", onWindowScroll, true);
    function onWindowResize() { if (isOpen) close(); }
    window.addEventListener("resize", onWindowResize);

    var api = {
      setValue: function (v) { selectValue(String(v)); },
      getValue: function () { return selectedValue; },
      open: open,
      close: close,
      destroy: function () {
        document.removeEventListener("mousedown", onDocPointer, true);
        window.removeEventListener("scroll", onWindowScroll, true);
        window.removeEventListener("resize", onWindowResize);
        if (root.parentNode) root.parentNode.removeChild(root);
        if (hidden.parentNode) hidden.parentNode.removeChild(hidden);
        native.style.display = "";
        delete native.dataset.customSelectReady;
        _instanceCache.delete(native);
      },
    };
    _instanceCache.set(native, api);
    return api;
  }

  window.mwiCustomSelect = { replace: replace };
})();