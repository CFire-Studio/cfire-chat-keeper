JSON.stringify((function() {
  var all = document.querySelectorAll('*');
  var scrollables = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.scrollHeight > el.clientHeight + 10) {
      var oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        scrollables.push({
          tag: el.tagName,
          cls: (el.className || '').toString().substring(0, 100),
          id: el.id || '',
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollTop: el.scrollTop,
          overflowY: oy,
          childCount: el.children.length,
          hasMsgList: !!el.querySelector('[class*="message-list"]')
        });
      }
    }
  }
  return { count: scrollables.length, scrollables: scrollables };
})())
