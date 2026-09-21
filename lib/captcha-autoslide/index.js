// lib/captcha-autoslide/index.js - 对外 facade（lifecycle / ipc 消费）
// 依赖装配：单测经 controller.init() 全量注入假实现；
// 生产路径懒装配（ensureReady）——logs/alert/executeJavaScript/drag 全部走真实通道。

const controller = require('./controller');
const match = require('./match');
const trajectory = require('./trajectory');
const drag = require('./drag');
const pageScripts = require('./page-scripts');

module.exports = {
  init: controller.init,
  attach: controller.attach,
  detach: controller.detach,
  isEnabled: controller.isEnabled,
  getConfig: controller.getConfig,
  setEnabled: controller.setEnabled,
  getState: controller.getState,
  // 内部模块暴露仅供单测（不作为对外 API 承诺）
  __internals: { controller, match, trajectory, drag, pageScripts },
};
