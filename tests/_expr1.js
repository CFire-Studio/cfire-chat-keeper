JSON.stringify({
  hasMsgList: !!document.querySelector('[class*="message-list"]'),
  scrollInfo: (function() {
    var el = document.querySelector('[class*="message-list"]');
    if (!el) return 'no [class*=message-list] found';
    var info = {
      tag: el.tagName,
      cls: el.className.substring(0, 100),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      isScrollable: el.scrollHeight > el.clientHeight
    };
    var p = el.parentElement;
    var ancestors = [];
    while (p && p !== document.body) {
      var oy = getComputedStyle(p).overflowY;
      if (p.scrollHeight > p.clientHeight && (oy === 'auto' || oy === 'scroll')) {
        ancestors.push({
          tag: p.tagName,
          cls: p.className.substring(0, 80),
          scrollHeight: p.scrollHeight,
          clientHeight: p.clientHeight,
          scrollTop: p.scrollTop,
          overflowY: oy
        });
      }
      p = p.parentElement;
    }
    info.scrollableAncestors = ancestors;
    return info;
  })()
})
