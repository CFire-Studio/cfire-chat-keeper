(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  var test = window.__ackFlowTest;
  if (!test) return JSON.stringify({ error: 'no flow test data' });
  var apiAfter = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;
  var afterState = scroller ? {
    sH: scroller.scrollHeight,
    cH: scroller.clientHeight,
    sT: scroller.scrollTop
  } : null;
  return JSON.stringify({
    elapsed: Date.now() - test.time,
    scrolledToTop: !!test.scrolledToTop,
    apiBefore: test.apiBefore,
    apiAfter: apiAfter,
    newApiCall: apiAfter > test.apiBefore,
    stateAtBottom: test.stateAtBottom,
    stateAfter: afterState,
    scrollHeightChanged: test.stateAtBottom.sH !== afterState.sH
  });
})()
