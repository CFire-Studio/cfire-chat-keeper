(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  var before = window.__ackBefore;
  if (!before) return JSON.stringify({ error: 'no __ackBefore' });
  var after = scroller ? {
    sH: scroller.scrollHeight,
    cH: scroller.clientHeight,
    sT: scroller.scrollTop
  } : null;
  var apiAfter = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;
  var elapsed = Date.now() - before.time;
  return JSON.stringify({
    elapsed: elapsed,
    before: before.before,
    after: after,
    apiBefore: before.apiBefore,
    apiAfter: apiAfter,
    newApiCall: apiAfter > before.apiBefore,
    scrollHeightChanged: before.before.sH !== after.sH
  });
})()
