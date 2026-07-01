JSON.stringify({
  hasAckHook: typeof window.__ACK_HOOK__ !== 'undefined',
  ackHookValue: window.__ACK_HOOK__,
  fetchIsNative: window.fetch.toString().indexOf('native code') >= 0,
  fetchToString: window.fetch.toString().substring(0, 100)
})
