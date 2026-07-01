(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no scroller' });
  var before = {
    sH: scroller.scrollHeight,
    cH: scroller.clientHeight,
    sT: scroller.scrollTop
  };
  var apiBefore = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;
  // Scroll to top + dispatch events
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000, bubbles: true, cancelable: true }));
  // Store state for later polling
  window.__ackBefore = { before: before, apiBefore: apiBefore, time: Date.now() };
  return JSON.stringify({ msg: 'scrolled', before: before, apiBefore: apiBefore });
})()
