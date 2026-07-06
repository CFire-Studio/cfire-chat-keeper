// 手动滚动到顶部，观察是否触发新的 /im/chain/single 请求
// 同时记录滚动前后的状态变化
(async function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no scroller' });

  var apiBefore = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  var stateBefore = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  // 滚到顶
  scroller.scrollTop = 0;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  scroller.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -scroller.clientHeight * 2,
    bubbles: true,
    cancelable: true
  }));

  // 等待 5 秒，让页面有机会发起请求
  await new Promise(function(r) { setTimeout(r, 5000); });

  var apiAfter = performance.getEntriesByType('resource')
    .filter(function(e) { return e.name.indexOf('/im/chain/single') >= 0; }).length;

  var stateAfter = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  return JSON.stringify({
    apiBefore: apiBefore,
    apiAfter: apiAfter,
    newApiCalls: apiAfter - apiBefore,
    stateBefore: stateBefore,
    stateAfter: stateAfter,
    scrollHeightGrew: stateAfter.scrollHeight > stateBefore.scrollHeight,
    atTop: stateAfter.scrollTop === 0
  });
})()
