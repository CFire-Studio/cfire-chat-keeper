// 深入分析 raw 表中每个 /im/chain/single 响应的 conversation_id 和 URL 参数
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

  var analyses = [];
  var convIdSet = {};

  chainRaws.forEach(function(r, i) {
    try {
      var json = JSON.parse(r.body);
      var msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages;
      if (msgs && msgs.length > 0) {
        // 提取 conversation_id
        var convId = null;
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j].conversation_id) {
            convId = msgs[j].conversation_id;
            break;
          }
        }
        convIdSet[convId || 'null'] = (convIdSet[convId || 'null'] || 0) + 1;

        var ids = msgs.map(function(m) { return m.message_id; });
        analyses.push({
          index: i,
          capturedAt: r.capturedAt,
          msgCount: msgs.length,
          convId: convId,
          firstId: ids[0],
          lastId: ids[ids.length-1],
          urlParams: r.url.split('?')[1] || 'no-params'
        });
      }
    } catch(e) {}
  });

  return JSON.stringify({
    totalChainRaws: chainRaws.length,
    convIdDistribution: convIdSet,
    analyses: analyses
  });
})()
