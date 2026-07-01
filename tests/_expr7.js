(async function() {
  // Query IndexedDB directly from the page context
  return new Promise(function(resolve) {
    var req = indexedDB.open('cfire-chat-keeper', 1);
    req.onsuccess = function() {
      var db = req.result;
      if (!db.objectStoreNames.contains('messages')) {
        resolve(JSON.stringify({ error: 'no messages store' }));
        return;
      }
      var tx = db.transaction('messages', 'readonly');
      var store = tx.objectStore('messages');
      var idx = store.index('convId');
      var convId = 'doubao:38427006775604738';
      var getAllReq = idx.getAll(IDBKeyRange.only(convId));
      getAllReq.onsuccess = function() {
        var msgs = getAllReq.result || [];
        resolve(JSON.stringify({
          convId: convId,
          messageCount: msgs.length,
          messages: msgs.map(function(m) {
            return {
              turnId: m.turnId,
              role: m.role,
              contentPreview: (m.content || '').substring(0, 50),
              createdAt: m.createdAt
            };
          })
        }));
      };
      getAllReq.onerror = function() {
        resolve(JSON.stringify({ error: 'getAll failed: ' + getAllReq.error }));
      };
    };
    req.onerror = function() {
      resolve(JSON.stringify({ error: 'open failed: ' + req.error }));
    };
  });
})()
