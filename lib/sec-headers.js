'use strict';

// lib/sec-headers.js - Sec-CH-UA / Sec-Fetch-* HTTP 头计算(防 HTTP/2 + Client Hints 指纹关联)
// 输入: profile (fp.buildFingerprint 输出) + url + resourceType + isTopLevel + pageOrigin
// 输出: { 'Sec-CH-UA': ..., 'Sec-Fetch-Dest': ..., ... }
// 引入位置: lib/views.js 在 sess.setUserAgent 之后,挂 sess.webRequest.onBeforeSendHeaders

// Node process.platform → Client Hints platform 字符串
const PLATFORM_NAME = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
// 防御性反向映射 (fp.output.userAgentData.platform 已经是大写形式,但万一小写传入也要稳)
const PLATFORM_NAME_LOOSE = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

// Chromium resourceType (Electron webRequest.onBeforeSendHeaders) → Sec-Fetch-Dest
const RESOURCE_DEST = {
  mainFrame: 'document',
  subFrame: 'iframe',
  stylesheet: 'style',
  script: 'script',
  image: 'image',
  font: 'font',
  xhr: 'empty',
  fetch: 'empty',
  websocket: 'empty',
  media: 'video',
  ping: 'empty',
  cspReport: 'empty',
  prefetch: 'empty',
  other: 'empty',
};

// eTLD+1 简化判断 (com/org/net/gov/edu/io/co/cn 二级域)
function getRegistrableDomain(host) {
  if (!host) return '';
  const parts = host.toLowerCase().split('.');
  if (parts.length <= 2) return host.toLowerCase();
  const knownTld2 = ['com', 'org', 'net', 'gov', 'edu', 'io', 'co', 'cn', 'com.cn', 'org.cn', 'net.cn'];
  const last2 = parts.slice(-2).join('.');
  if (knownTld2.includes(last2) && parts.length >= 3) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

// request URL 相对于 pageOrigin 的 site 分类
function classifySite(requestUrl, pageOrigin) {
  if (!requestUrl || !pageOrigin) return 'cross-site';
  const reqOrigin = requestUrl.protocol + '//' + requestUrl.host;
  const pgOrigin = pageOrigin.protocol + '//' + pageOrigin.host;
  if (reqOrigin === pgOrigin) return 'same-origin';
  if (getRegistrableDomain(requestUrl.hostname) === getRegistrableDomain(pageOrigin.hostname)) return 'same-site';
  return 'cross-site';
}

// URL 安全解析
function safeParseUrl(u) {
  try { return new URL(u); } catch (e) { return null; }
}

// 主入口: 输入 profile + 请求上下文, 返回应注入的 Sec-* 头对象
function computeSecHeaders(input) {
  input = input || {};
  const profile = input.profile;
  if (!profile || !profile.userAgentData) return {};
  const url = input.url || '';
  const rt = input.resourceType || 'other';
  const isTopLevel = !!input.isTopLevel;
  const pageOrigin = input.pageOrigin || null;

  const headers = {};

  // 1) Sec-CH-UA / Sec-CH-UA-Mobile / Sec-CH-UA-Platform
  //    顶层 mainFrame 才发这三个完整集合; 子资源只发 Sec-CH-UA-Mobile
  const brands = profile.userAgentData.brands || [];
  if (brands.length > 0) {
    const orderedBrands = brands.map(function (b) { return '"' + (b.brand || '') + '";v="' + (b.version || '0') + '"'; }).join(', ');
    headers['Sec-CH-UA'] = orderedBrands;
    headers['Sec-CH-UA-Mobile'] = profile.userAgentData.mobile ? '?1' : '?0';
    const rawPf = profile.userAgentData.platform || PLATFORM_NAME[profile.platform] || '';
    const pf = PLATFORM_NAME_LOOSE[String(rawPf).toLowerCase()] || rawPf;
    headers['Sec-CH-UA-Platform'] = '"' + pf + '"';
  }

  // 2) Sec-Fetch-Dest
  headers['Sec-Fetch-Dest'] = RESOURCE_DEST[rt] || 'empty';

  // 3) Sec-Fetch-Mode
  let mode = 'cors';
  if (rt === 'mainFrame' || rt === 'subFrame') mode = 'navigate';
  else if (rt === 'websocket') mode = 'websocket';
  else if (rt === 'xhr' || rt === 'fetch') mode = isTopLevel ? 'cors' : 'no-cors';
  else if (rt === 'script' || rt === 'stylesheet' || rt === 'image' || rt === 'font') mode = 'no-cors';
  headers['Sec-Fetch-Mode'] = mode;

  // 4) Sec-Fetch-Site
  let site = 'cross-site';
  if (rt === 'mainFrame') site = 'none';
  else {
    const parsed = safeParseUrl(url);
    if (parsed && pageOrigin) site = classifySite(parsed, pageOrigin);
  }
  headers['Sec-Fetch-Site'] = site;

  // 5) Sec-Fetch-User (仅顶层 mainFrame 用户触发导航)
  if (rt === 'mainFrame' && isTopLevel) headers['Sec-Fetch-User'] = '?1';
  // 否则不设 (Chromium 默认不发, 显式置空会暴露自动化)

  return headers;
}

module.exports = {
  computeSecHeaders: computeSecHeaders,
  classifySite: classifySite,
  getRegistrableDomain: getRegistrableDomain,
  safeParseUrl: safeParseUrl,
  PLATFORM_NAME: PLATFORM_NAME,
  RESOURCE_DEST: RESOURCE_DEST,
};
