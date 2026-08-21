const gateway = require('../lib/socks-gateway');
(async () => {
  try {
    await gateway.allocate({ id: 'test', server: 'test.com', port: 443, name: 'test' }, {});
  } catch (e) {
    console.log('caught:', e.message);
  }
})();
