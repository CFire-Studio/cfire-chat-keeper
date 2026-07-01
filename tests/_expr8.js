(async function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no v_list_scroller' });

  // Record performance entries before
  var beforeCount = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  var beforeState = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  // Scroll to top and dispatch events
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  // Also try wheel event (some virtual scroll libs listen to wheel)
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true }));

  // Wait 5 seconds, checking periodically
  var newCallFound = false;
  for (var i = 0; i < 50; i++) {
    await new Promise(function(r) { setTimeout(r, 100); });
    var afterCount = performance.getEntriesByType('resource')
      .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;
    if (afterCount > beforeCount) {
      newCallFound = true;
      break;
    }
  }

  var afterState = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  var afterCount = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  return JSON.stringify({
    beforeState: beforeState,
    afterState: afterState,
    apiCallsBefore: beforeCount,
    apiCallsAfter: afterCount,
    newApiCallTriggered: newCallFound,
    scrollHeightChanged: beforeState.scrollHeight !== afterState.scrollHeight
  });
})()
