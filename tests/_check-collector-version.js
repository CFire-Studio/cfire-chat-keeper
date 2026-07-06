// 在 service worker 中 fetch 自己的 collector.js，检查是否包含新代码标志
(async function() {
  var extUrl = chrome.runtime.getURL('static/collector.js');
  // 列出所有可访问的扩展资源
  var allUrls = chrome.runtime.getManifest().web_accessible_resources || [];
  // 尝试 fetch collector
  try {
    var resp = await fetch(extUrl);
    var text = await resp.text();
    return JSON.stringify({
      extUrl: extUrl,
      status: resp.status,
      length: text.length,
      hasReachedTop: text.indexOf('reachedTop') >= 0,
      hasMaxConsecutiveEmpty: text.indexOf('maxConsecutiveEmpty') >= 0 || text.indexOf('ConsecutiveEmpty') >= 0,
      hasOverallTimeout: text.indexOf('overallTimeoutMs') >= 0 || text.indexOf('12e4') >= 0,
      first500: text.substring(0, 500)
    });
  } catch (e) {
    return JSON.stringify({ error: e.message, extUrl: extUrl });
  }
})()
