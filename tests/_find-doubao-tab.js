// 在 service worker 中查询 doubao.com/chat 的 tab id
(async function() {
  return new Promise(function(resolve) {
    chrome.tabs.query({}, function(tabs) {
      var doubao = tabs.find(function(t) { return t.url && t.url.indexOf('doubao.com/chat/') >= 0; });
      if (!doubao) {
        resolve(JSON.stringify({ error: 'no doubao tab', tabCount: tabs.length }));
      } else {
        resolve(JSON.stringify({ tabId: doubao.id, url: doubao.url, title: doubao.title }));
      }
    });
  });
})()
