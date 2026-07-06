// 查询 raw 表中所有 /im/chain/single 响应，分析 message_id 稳定性
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
  // 只看 doubao 的 /im/chain/single
  var chainRaws = raws.filter(function(r) {
    return r.url && r.url.indexOf('/im/chain/single') >= 0;
  });

  var result = {
    totalRaw: raws.length,
    chainRawCount: chainRaws.length,
    analyses: []
  };

  // 分析每个 /im/chain/single 响应
  var allMessageIds = {}; // message_id -> [response index]
  chainRaws.forEach(function(r, i) {
    try {
      var json = JSON.parse(r.body);
      var msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages;
      if (msgs) {
        var ids = msgs.map(function(m) { return m.message_id; });
        var analysis = {
          index: i,
          capturedAt: r.capturedAt,
          url: r.url.substring(0, 100),
          msgCount: msgs.length,
          firstId: ids[0],
          lastId: ids[ids.length-1],
          ids: ids
        };
        result.analyses.push(analysis);

        ids.forEach(function(id) {
          if (!allMessageIds[id]) allMessageIds[id] = [];
          allMessageIds[id].push(i);
        });
      }
    } catch(e) {
      result.analyses.push({ index: i, error: e.message });
    }
  });

  // 检查重复的 message_id
  var duplicates = {};
  Object.keys(allMessageIds).forEach(function(id) {
    if (allMessageIds[id].length > 1) {
      duplicates[id] = allMessageIds[id];
    }
  });
  result.duplicateCount = Object.keys(duplicates).length;
  result.duplicates = duplicates;
  result.totalUniqueIds = Object.keys(allMessageIds).length;

  return JSON.stringify(result);
})()
