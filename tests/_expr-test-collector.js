(async function() {
  // Try to send SCROLL_UP to the Doubao tab to test if collector is loaded
  return new Promise(function(resolve) {
    chrome.tabs.query({}, function(tabs) {
      var doubaoTab = tabs.find(function(t) { return t.url && t.url.indexOf('doubao.com/chat/') >= 0; });
      if (!doubaoTab) {
        resolve(JSON.stringify({ error: 'no doubao tab found' }));
        return;
      }
      chrome.tabs.sendMessage(doubaoTab.id, { type: 'ack:scroll-up' }, function(response) {
        if (chrome.runtime.lastError) {
          resolve(JSON.stringify({
            error: chrome.runtime.lastError.message,
            tabId: doubaoTab.id,
            tabUrl: doubaoTab.url,
            collectorLoaded: false
          }));
        } else {
          resolve(JSON.stringify({
            response: response,
            tabId: doubaoTab.id,
            collectorLoaded: true
          }));
        }
      });
    });
  });
})()
