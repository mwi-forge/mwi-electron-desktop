// src/js/store.js - 简单发布订阅 state（全局 IIFE，无模块依赖）

window.mwiStore = (function () {
  const state = {
    accounts: [],
    groups: [],
    focusedAccountId: null,
    // Phase 2+ 才用到，先声明
    runningIds: [],
  };

  const subscribers = new Set();

  return {
    get: () => state,
    set: (patch) => {
      Object.assign(state, patch);
      for (const cb of subscribers) {
        try { cb(state); } catch (e) { console.error('[mwiStore] subscriber error', e); }
      }
    },
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
})();
