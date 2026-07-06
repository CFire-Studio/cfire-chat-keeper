// 查询 DB 中豆包对话消息的 turnId 结构，分析是否有冲突
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
      openDb().then(function(db) {
        if (!db.objectStoreNames.contains(store)) { resolve([]); return; }
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

  // 按 convId 分组
  var byConv = {};
  doubaoMsgs.forEach(function(m) {
    if (!byConv[m.convId]) byConv[m.convId] = [];
    byConv[m.convId].push(m);
  });

  var result = {
    totalConvs: convs.length,
    doubaoConvs: doubaoConvs.map(function(c) {
      return { id: c.id, title: c.title, messageCount: c.messageCount };
    }),
    doubaoMsgCount: doubaoMsgs.length,
    byConv: {}
  };

  Object.keys(byConv).forEach(function(convId) {
    var convMsgs = byConv[convId];
    convMsgs.sort(function(a, b) { return a.createdAt - b.createdAt; });
    result.byConv[convId] = {
      count: convMsgs.length,
      turnIds: convMsgs.map(function(m) { return m.turnId; }),
      firstMsg: {
        turnId: convMsgs[0].turnId,
        role: convMsgs[0].role,
        contentPreview: (convMsgs[0].content || '').substring(0, 50)
      },
      lastMsg: {
        turnId: convMsgs[convMsgs.length - 1].turnId,
        role: convMsgs[convMsgs.length - 1].role,
        contentPreview: (convMsgs[convMsgs.length - 1].content || '').substring(0, 50)
      }
    };
  });

  return JSON.stringify(result);
})()
