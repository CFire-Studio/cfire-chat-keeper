(async function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return JSON.stringify({ error: 'no scroller' });

  var before = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  // Scroll to top to trigger loading earlier messages
  scroller.scrollTop = 0;

  // Wait 2.5s for the page to react and load more messages
  await new Promise(function(r) { setTimeout(r, 2500); });

  var after = {
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop
  };

  return JSON.stringify({
    before: before,
    after: after,
    scrollHeightChanged: before.scrollHeight !== after.scrollHeight,
    scrollTopChanged: before.scrollTop !== after.scrollTop,
    newMessagesLoaded: after.scrollHeight > before.scrollHeight
  });
})()
