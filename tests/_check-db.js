// 在扩展 service worker 中查询 IndexedDB 当前状态
(async function() {
  function openDb() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open('cfire-chat-keeper');
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }
  function all(store) {
    return new Promise(function(resolve, reject) {
      var db;
      openDb().then(function(d) {
        db = d;
        if (!db.objectStoreNames.contains(store)) {
          resolve([]);
          return;
        }
        var t = db.transaction(store, 'readonly');
        var r = t.objectStore(store).getAll();
        r.onsuccess = function() { resolve(r.result); };
        r.onerror = function() { reject(r.error); };
      });
    });
  }
  var convs = await all('conversations');
  var msgs = await all('messages');
  var doubaoConvs = convs.filter(function(c) { return c.site === 'doubao'; });
  var doubaoMsgs = msgs.filter(function(m) { return m.convId && m.convId.indexOf('doubao:') === 0; });
  return JSON.stringify({
    totalConvs: convs.length,
    doubaoConvs: doubaoConvs.map(function(c) {
      return { id: c.id, title: c.title, messageCount: c.messageCount, imageCount: c.imageCount };
    }),
    totalMsgs: msgs.length,
    doubaoMsgCount: doubaoMsgs.length,
    doubaoMsgTurnIds: doubaoMsgs.map(function(m) { return m.turnId; }).slice(0, 50),
    doubaoMsgFirst5: doubaoMsgs.slice(0, 5).map(function(m) {
      return { turnId: m.turnId, role: m.role, contentPreview: (m.content || '').substring(0, 60) };
    }),
    doubaoMsgLast5: doubaoMsgs.slice(-5).map(function(m) {
      return { turnId: m.turnId, role: m.role, contentPreview: (m.content || '').substring(0, 60) };
    })
  });
})()
