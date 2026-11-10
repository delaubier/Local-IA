/// <reference types="chrome"/>

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: any) => console.error(error));

chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ received: true });
  return false;
});

