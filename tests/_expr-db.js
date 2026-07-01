(async function() {
  return new Promise(function(resolve) {
    var req = indexedDB.open('cfire-chat-keeper', 1);
    req.onsuccess = function() {
      var db = req.result;
      var result = {};

      // List all conversations
      var convTx = db.transaction('conversations', 'readonly');
      var convReq = convTx.objectStore('conversations').getAll();
      convReq.onsuccess = function() {
        result.conversations = (convReq.result || []).map(function(c) {
          return { id: c.id, site: c.site, convId: c.conversationId, messageCount: c.messageCount, title: c.title };
        });

        // Get messages for doubao:11111111111111111
        var msgTx = db.transaction('messages', 'readonly');
        var msgIdx = msgTx.objectStore('messages').index('convId');
        var msgReq = msgIdx.getAll(IDBKeyRange.only('doubao:11111111111111111'));
        msgReq.onsuccess = function() {
          var msgs = msgReq.result || [];
          result.targetMessages = msgs.length;
          result.targetMessagePreviews = msgs.map(function(m) {
            return { turnId: m.turnId, role: m.role, preview: (m.content || '').substring(0, 40) };
          });
          resolve(JSON.stringify(result, null, 2));
        };
        msgReq.onerror = function() { resolve(JSON.stringify({ error: 'msg getAll failed' })); };
      };
      convReq.onerror = function() { resolve(JSON.stringify({ error: 'conv getAll failed' })); };
    };
    req.onerror = function() { resolve(JSON.stringify({ error: 'DB open failed' })); };
  });
})()
