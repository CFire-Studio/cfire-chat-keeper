// 查询 DB 中所有对话和消息的 turnId，与 raw 表对比
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
  var raws = await all('raw');

  // 按对话分组消息
  var msgsByConv = {};
  msgs.forEach(function(m) {
    if (!msgsByConv[m.convId]) msgsByConv[m.convId] = [];
    msgsByConv[m.convId].push(m);
  });

  // 提取 raw 表中 convId=11111111111111111 的所有 message_id
  var chainRaws = raws.filter(function(r) {
    return r.url && r.url.indexOf('/im/chain/single') >= 0;
  });

  var rawMsgIds = {};
  chainRaws.forEach(function(r) {
    try {
      var json = JSON.parse(r.body);
      var msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages;
      if (msgs) {
        msgs.forEach(function(m) {
          if (m.conversation_id === '11111111111111111' || m.conversation_id === 11111111111111111) {
            rawMsgIds[m.message_id] = true;
          }
        });
      }
    } catch(e) {}
  });

  // 提取 DB 中所有消息的 turnId
  var dbTurnIds = {};
  msgs.forEach(function(m) {
    dbTurnIds[m.turnId] = m.convId;
  });

  // 检查 raw 表中的 message_id 是否在 DB 中
  var inDb = 0;
  var notInDb = 0;
  var notInDbIds = [];
  Object.keys(rawMsgIds).forEach(function(id) {
    if (dbTurnIds[id]) {
      inDb++;
    } else {
      notInDb++;
      notInDbIds.push(id);
    }
  });

  return JSON.stringify({
    totalConvs: convs.length,
    allConvs: convs.map(function(c) { return { id: c.id, site: c.site, messageCount: c.messageCount, title: c.title }; }),
    totalMsgs: msgs.length,
    msgsByConv: Object.keys(msgsByConv).map(function(k) {
      return { convId: k, count: msgsByConv[k].length, turnIds: msgsByConv[k].map(function(m) { return m.turnId; }) };
    }),
    rawMsgIdCount: Object.keys(rawMsgIds).length,
    rawMsgIdsInDb: inDb,
    rawMsgIdsNotInDb: notInDb,
    notInDbIds: notInDbIds
  });
})()
