// 检查扩展已加载的 manifest 和 collector 脚本路径
(async function() {
  var manifest = chrome.runtime.getManifest();
  var scripts = manifest.content_scripts || [];
  var extBase = chrome.runtime.getURL('');
  return JSON.stringify({
    extBase: extBase,
    version: manifest.version,
    contentScripts: scripts.map(function(s) {
      return { matches: s.matches, js: s.js, run_at: s.run_at };
    }),
    manifestName: manifest.name
  });
})()
