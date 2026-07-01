JSON.stringify((function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  if (!scroller) return { error: 'no v_list_scroller found' };

  var msgList = document.querySelector('[class*="message-list"]');

  // Check DOM relationship
  var scrollerContainsMsgList = msgList ? scroller.contains(msgList) : false;
  var msgListContainsScroller = msgList ? msgList.contains(scroller) : false;

  // Check what's directly inside the scroller
  var scrollerChildren = [];
  for (var i = 0; i < scroller.children.length; i++) {
    var c = scroller.children[i];
    scrollerChildren.push({
      tag: c.tagName,
      cls: (c.className || '').toString().substring(0, 100),
      childCount: c.children.length,
      textPreview: (c.innerText || '').substring(0, 80)
    });
  }

  // Find message-like elements inside scroller
  var msgEls = scroller.querySelectorAll('[class*="bg-g-send"], [class*="message-action-bar"]');
  var userMsgs = scroller.querySelectorAll('[class*="bg-g-send"]');
  var assistantMsgs = scroller.querySelectorAll('[class*="message-action-bar"]');

  return {
    scroller: {
      tag: scroller.tagName,
      cls: (scroller.className || '').toString(),
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop
    },
    msgList: msgList ? {
      cls: (msgList.className || '').toString().substring(0, 100),
      parentCls: msgList.parentElement ? (msgList.parentElement.className || '').toString().substring(0, 100) : 'none'
    } : null,
    scrollerContainsMsgList: scrollerContainsMsgList,
    msgListContainsScroller: msgListContainsScroller,
    scrollerChildren: scrollerChildren,
    userMsgCount: userMsgs.length,
    assistantMsgCount: assistantMsgs.length
  };
})())
