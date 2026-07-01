(async function() {
  // Try to list conversations via the extension's messaging system
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({ type: 'q:list', payload: null }, function(response) {
      if (chrome.runtime.lastError) {
        resolve(JSON.stringify({ error: chrome.runtime.lastError.message }));
      } else {
        resolve(JSON.stringify({ conversations: response || [], count: response ? response.length : 0 }));
      }
    });
  });
})()
