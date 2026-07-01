(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no scroller' });

  // Step 1: Scroll to BOTTOM first (simulate user at latest messages)
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

  var apiBefore = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  var stateAtBottom = {
    sH: scroller.scrollHeight,
    cH: scroller.clientHeight,
    sT: scroller.scrollTop
  };

  // Store for later check
  window.__ackFlowTest = {
    apiBefore: apiBefore,
    stateAtBottom: stateAtBottom,
    time: Date.now()
  };

  // Step 2: After 500ms, scroll to TOP (simulate user scrolling up)
  setTimeout(function() {
    var s = document.querySelector('[class*="v_list_scroller"]');
    if (!s) return;
    s.scrollTop = 0;
    s.dispatchEvent(new Event('scroll', { bubbles: true }));
    s.dispatchEvent(new WheelEvent('wheel', { deltaY: -2000, bubbles: true, cancelable: true }));
    if (window.__ackFlowTest) {
      window.__ackFlowTest.scrolledToTop = true;
      window.__ackFlowTest.scrollTopTime = Date.now();
    }
  }, 500);

  return JSON.stringify({
    msg: 'flow started: scrolled to bottom, will scroll to top in 500ms',
    apiBefore: apiBefore,
    stateAtBottom: stateAtBottom
  });
})()
