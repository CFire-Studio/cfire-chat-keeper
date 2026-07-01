(function() {
  window.__ackTestResult = null;
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) { window.__ackTestResult = JSON.stringify({ error: 'no scroller' }); return 'started: no scroller'; }

  var beforeCount = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  var beforeState = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  scroller.scrollTop = 0;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }));

  var checkCount = 0;
  var interval = setInterval(function() {
    checkCount++;
    var afterCount = performance.getEntriesByType('resource')
      .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

    if (afterCount > beforeCount || checkCount >= 50) {
      clearInterval(interval);
      var afterState = {
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        scrollTop: scroller.scrollTop
      };
      window.__ackTestResult = JSON.stringify({
        beforeState: beforeState,
        afterState: afterState,
        apiCallsBefore: beforeCount,
        apiCallsAfter: afterCount,
        newApiCallTriggered: afterCount > beforeCount,
        scrollHeightChanged: beforeState.scrollHeight !== afterState.scrollHeight,
        checkIterations: checkCount
      });
    }
  }, 100);

  return 'started, beforeCount=' + beforeCount + ' beforeScrollTop=' + beforeState.scrollTop;
})()
