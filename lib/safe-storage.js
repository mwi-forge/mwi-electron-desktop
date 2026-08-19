// lib/safe-storage.js - Electron safeStorage 包装
// 用于加密代理密码等敏感字段

const { safeStorage } = require('electron');

const ERR_UNAVAILABLE = new Error('safeStorage unavailable on this platform (likely no keyring configured on Linux)');

function isAvailable() {
  return safeStorage.isEncryptionAvailable();
}

function encrypt(plain) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw ERR_UNAVAILABLE;
  }
  return safeStorage.encryptString(plain).toString('base64');
}

function decrypt(b64) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw ERR_UNAVAILABLE;
  }
  const buf = Buffer.from(b64, 'base64');
  return safeStorage.decryptString(buf);
}

module.exports = { isAvailable, encrypt, decrypt };
