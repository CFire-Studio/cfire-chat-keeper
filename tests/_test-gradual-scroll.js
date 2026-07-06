// 测试渐进式向上滚动是否能触发 /im/chain/single 请求
(function() {
  return new Promise(function(resolve) {
    var scroller = document.querySelector('[class*="v_list_scroller"]');
    if (!scroller) { resolve(JSON.stringify({ error: 'no scroller' })); return; }

    var apiCalls = [];
    var origFetch = window.fetch;
    window.fetch = function() {
      var url = typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url) || '';
      var promise = origFetch.apply(this, arguments);
      if (url.indexOf('/im/chain/single') >= 0) {
        var callTime = Date.now();
        promise.then(function(res) {
          var clone = res.clone();
          clone.text().then(function(body) {
            try {
              var json = JSON.parse(body);
              var msgs = json && json.downlink_body && json.downlink_body.pull_singe_chain_downlink_body && json.downlink_body.pull_singe_chain_downlink_body.messages;
              apiCalls.push({
                url: url,
                time: callTime,
                count: msgs ? msgs.length : 0,
                firstId: msgs && msgs[0] ? msgs[0].message_id : null,
                lastId: msgs && msgs[msgs.length-1] ? msgs[msgs.length-1].message_id : null
              });
            } catch(e) {
              apiCalls.push({ url: url, time: callTime, error: e.message });
            }
          }).catch(function(){});
        }).catch(function(){});
      }
      return promise;
    };

    var startScrollTop = scroller.scrollTop;
    var startScrollHeight = scroller.scrollHeight;
    var step = 0;
    var maxSteps = 50;
    var stepSize = 200; // 每次滚动 200px

    function doStep() {
      if (step >= maxSteps || scroller.scrollTop <= 0) {
        // 恢复 fetch
        window.fetch = origFetch;
        setTimeout(function() {
          resolve(JSON.stringify({
            startScrollTop: startScrollTop,
            startScrollHeight: startScrollHeight,
            endScrollTop: scroller.scrollTop,
            endScrollHeight: scroller.scrollHeight,
            steps: step,
            apiCalls: apiCalls,
            apiCallCount: apiCalls.length
          }));
        }, 2000); // 等待 2s 让最后的 API 响应到达
        return;
      }

      // 向上滚动一步
      scroller.scrollTop = Math.max(0, scroller.scrollTop - stepSize);
      // 触发 scroll 事件
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      step++;

      // 等待 300ms 再下一步
      setTimeout(doStep, 300);
    }

    // 开始滚动
    setTimeout(doStep, 100);
  });
})()
