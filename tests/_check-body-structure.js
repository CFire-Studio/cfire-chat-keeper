// 检查 raw 表中后续 4 组响应的 body 结构，确认 parseDoubao 能否正确解析
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

  var raws = await all('raw');
  var chainRaws = raws.filter(function(r) {
    return r.url && r.url.indexOf('/im/chain/single') >= 0;
  });

  // 按 capturedAt 排序
  chainRaws.sort(function(a, b) { return a.capturedAt - b.capturedAt; });

  // 提取每组响应的第一个 message_id 作为组标识
  var groups = {};
  chainRaws.forEach(function(r) {
    try {
      var json = JSON.parse(r.body);
      var msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages;
      if (msgs && msgs.length > 0) {
        var convId = null;
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j].conversation_id) { convId = msgs[j].conversation_id; break; }
        }
        if (convId !== '11111111111111111' && convId !== 11111111111111111) return;

        var firstId = msgs[0].message_id;
        var groupKey = String(firstId);
        if (!groups[groupKey]) {
          groups[groupKey] = {
            firstId: firstId,
            lastId: msgs[msgs.length-1].message_id,
            count: msgs.length,
            capturedAt: r.capturedAt,
            bodyLength: r.body.length,
            // 检查 body 结构
            hasDownlinkBody: !!json.downlink_body,
            hasPullSingle: !!(json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body),
            hasMessages: !!(json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages),
            // 检查消息结构
            firstMsgKeys: msgs[0] ? Object.keys(msgs[0]) : [],
            firstMsgHasContentBlock: !!(msgs[0] && msgs[0].content_block),
            firstMsgContentBlockCount: msgs[0] && msgs[0].content_block ? msgs[0].content_block.length : 0,
            // 检查第一条消息的 block_type
            blockTypes: msgs[0] && msgs[0].content_block ? msgs[0].content_block.map(function(b) { return b.block_type; }) : []
          };
        }
      }
    } catch(e) {}
  });

  return JSON.stringify({
    totalChainRaws: chainRaws.length,
    groupCount: Object.keys(groups).length,
    groups: Object.values(groups)
  });
})()

