// 搜索豆包页面中所有可能的顶部哨兵/load-more 触发元素
(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no scroller' });

  var info = {
    scrollerRect: scroller.getBoundingClientRect(),
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight
  };

  // 搜索所有包含 top/header/sentinel/load/fetch/prev 的元素
  var keywords = ['top', 'header', 'sentinel', 'load', 'fetch', 'prev', 'upper', 'start', 'begin'];
  var found = [];
  var all = document.querySelectorAll('div, span');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cn = el.className || '';
    if (typeof cn !== 'string') continue;
    cn = cn.toLowerCase();
    for (var k = 0; k < keywords.length; k++) {
      if (cn.indexOf(keywords[k]) >= 0) {
        var rect = el.getBoundingClientRect();
        // 只关注滚动容器附近或内部的元素
        if (rect.x >= info.scrollerRect.x - 100 && rect.x <= info.scrollerRect.x + info.scrollerRect.width + 100) {
          found.push({
            tag: el.tagName,
            className: el.className,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            keyword: keywords[k]
          });
        }
        break;
      }
    }
  }
  info.matches = found;

  // 检查 scroller_content 的子元素
  var content = scroller.querySelector('[class*="scroller_content"]');
  if (content) {
    info.contentChildren = [];
    for (var i = 0; i < content.children.length; i++) {
      var child = content.children[i];
      info.contentChildren.push({
        tag: child.tagName,
        className: child.className,
        childCount: child.children.length,
        rect: child.getBoundingClientRect()
      });
    }
  }

  // 检查 message-list 的子元素
  var msgList = document.querySelector('[class*="message-list"]');
  if (msgList) {
    info.msgListChildren = [];
    for (var i = 0; i < msgList.children.length; i++) {
      var child = msgList.children[i];
      info.msgListChildren.push({
        tag: child.tagName,
        className: child.className,
        childCount: child.children.length,
        rect: child.getBoundingClientRect()
      });
    }
  }

  return JSON.stringify(info);
})()
