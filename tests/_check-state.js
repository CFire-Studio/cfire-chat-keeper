// 检查豆包页面当前滚动状态 + 扩展 IndexedDB 中此对话的消息数
(async function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  var state = scroller ? {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop,
    atTop: scroller.scrollTop === 0,
    atBottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 5
  } : null;

  // 查询 IndexedDB 消息数（在 service worker / background 上下文才能访问扩展 DB）
  // 这里只返回页面状态
  return JSON.stringify({
    url: location.href,
    scrollerState: state,
    apiCallCount: performance.getEntriesByType('resource')
      .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length
  });
})()
