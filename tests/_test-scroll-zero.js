// 测试 scrollTop=0 后 v_list_top_indicator 的位置和 API 请求
(function() {
  return new Promise(function(resolve) {
    var scroller = document.querySelector('[class*="v_list_scroller"]');
    if (!scroller) { resolve(JSON.stringify({ error: 'no scroller' })); return; }

    var indicator = document.querySelector('[class*="v_list_top_indicator"]');
    var msgList = document.querySelector('[class*="message-list"]');

    var apiCalls = [];
    var origFetch = window.fetch;
    window.fetch = function() {
      var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
      var promise = origFetch.apply(this, arguments);
      if (url.indexOf('/im/chain/single') >= 0) {
        apiCalls.push({ url: url.substring(0, 100), time: Date.now() });
      }
      return promise;
    };

    var states = [];

    function snapshot(label) {
      var s = {
        label: label,
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        indicatorRect: indicator ? indicator.getBoundingClientRect() : null,
        msgListClass: msgList ? msgList.className : null,
        rowCount: scroller.querySelectorAll('[class*="v_list_row"]').length,
        apiCallsSoFar: apiCalls.length
      };
      states.push(s);
    }

    snapshot('before');

    // 设置 scrollTop = 0
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    snapshot('after-scrolltop-0');

    // 等待 500ms
    setTimeout(function() {
      snapshot('after-500ms');

      // 再次设置 scrollTop = 0（可能被虚拟滚动调整回来了）
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      snapshot('after-second-scrolltop-0');

      // 等待 1s
      setTimeout(function() {
        snapshot('after-1s');

        // 恢复 fetch
        window.fetch = origFetch;

        resolve(JSON.stringify({
          states: states,
          totalApiCalls: apiCalls.length,
          apiCalls: apiCalls
        }));
      }, 1000);
    }, 500);
  });
})()
