JSON.stringify((function() {
  // Check recent network requests for /im/chain/single
  var entries = performance.getEntriesByType('resource');
  var chainCalls = entries.filter(function(e) {
    return e.name.indexOf('/im/chain/single') >= 0;
  }).map(function(e) {
    return {
      url: e.name.substring(0, 120),
      startTime: Math.round(e.startTime),
      duration: Math.round(e.duration)
    };
  });

  // Check scroller's current state and children
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  var content = scroller ? scroller.querySelector('[class*="scroller_content"]') : null;
  var contentChildren = content ? content.children : [];

  // Check for any "loading" or "load more" indicators
  var loadingIndicators = document.querySelectorAll('[class*="loading"], [class*="load-more"], [class*="fetch"]');

  // Check the first child of scroller_content (might be a sentinel)
  var firstChild = contentChildren[0];
  var lastChild = contentChildren[contentChildren.length - 1];

  return {
    chainCallCount: chainCalls.length,
    chainCalls: chainCalls.slice(-5),
    scrollerContentChildren: contentChildren.length,
    firstChild: firstChild ? {
      tag: firstChild.tagName,
      cls: (firstChild.className || '').toString().substring(0, 100),
      height: firstChild.offsetHeight,
      textPreview: (firstChild.innerText || '').substring(0, 60)
    } : null,
    lastChild: lastChild ? {
      tag: lastChild.tagName,
      cls: (lastChild.className || '').toString().substring(0, 100),
      height: lastChild.offsetHeight,
      textPreview: (lastChild.innerText || '').substring(0, 60)
    } : null,
    loadingIndicatorCount: loadingIndicators.length
  };
})())
