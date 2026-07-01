JSON.stringify((function() {
  var scroller = document.querySelector('[class*="v_list_scroller"]');
  var content = scroller ? scroller.querySelector('[class*="scroller_content"]') : null;
  if (!content) return { error: 'no scroller_content' };

  var listItems = content.querySelector('[class*="list_items"]');
  var scrollHolder = content.querySelector('[class*="scroll_holder"]');

  // Check computed styles of list_items
  var liStyle = listItems ? getComputedStyle(listItems) : null;

  // Count actual message elements (look for various message selectors)
  var allChildren = listItems ? listItems.children : [];
  var childInfo = [];
  for (var i = 0; i < allChildren.length; i++) {
    var c = allChildren[i];
    childInfo.push({
      tag: c.tagName,
      cls: (c.className || '').toString().substring(0, 80),
      height: c.offsetHeight,
      transform: getComputedStyle(c).transform,
      top: getComputedStyle(c).top,
      position: getComputedStyle(c).position,
      textPreview: (c.innerText || '').substring(0, 40)
    });
  }

  // Also check scroll_holder
  var shStyle = scrollHolder ? getComputedStyle(scrollHolder) : null;

  return {
    listItems: {
      cls: listItems ? (listItems.className || '').toString() : null,
      height: listItems ? listItems.offsetHeight : null,
      position: liStyle ? liStyle.position : null,
      transform: liStyle ? liStyle.transform : null,
      childCount: allChildren.length
    },
    scrollHolder: {
      cls: scrollHolder ? (scrollHolder.className || '').toString() : null,
      height: scrollHolder ? scrollHolder.offsetHeight : null,
      position: shStyle ? shStyle.position : null
    },
    children: childInfo,
    scroller: {
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop
    }
  };
})())
