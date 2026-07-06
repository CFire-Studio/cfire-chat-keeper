// 检查豆包页面的滚动容器状态和 DOM 结构
(function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no v_list_scroller' });

  var info = {
    scroller: {
      className: scroller.className,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      canScrollUp: scroller.scrollTop > 0,
      canScrollDown: scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight
    },
    children: []
  };

  // 检查滚动容器的子元素
  for (var i = 0; i < Math.min(scroller.children.length, 10); i++) {
    var child = scroller.children[i];
    info.children.push({
      tag: child.tagName,
      className: child.className,
      childCount: child.children.length,
      rect: child.getBoundingClientRect()
    });
  }

  // 检查是否有哨兵元素（load-more 触发器）
  var messageList = document.querySelector('[class*="message-list"]');
  if (messageList) {
    info.messageList = {
      className: messageList.className,
      childCount: messageList.children.length
    };
    // 找 sentinel / load-more / placeholder 元素
    var sentinels = messageList.querySelectorAll('[class*="sentinel"], [class*="load-more"], [class*="placeholder"], [class*="loading"]');
    info.sentinels = Array.from(sentinels).map(function(el) {
      return { tag: el.tagName, className: el.className, rect: el.getBoundingClientRect() };
    });
  }

  // 检查所有 v_list_row 的数量和位置
  var rows = scroller.querySelectorAll('[class*="v_list_row"], [class*="list_row"], [class*="message-row"]');
  info.rowCount = rows.length;
  if (rows.length > 0) {
    info.firstRow = { className: rows[0].className, rect: rows[0].getBoundingClientRect() };
    info.lastRow = { className: rows[rows.length-1].className, rect: rows[rows.length-1].getBoundingClientRect() };
  }

  return JSON.stringify(info);
})()
