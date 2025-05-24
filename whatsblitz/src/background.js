// src/background.js
// Listen for popup commands to start messaging
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.command === 'startMessaging') {
    // Find open WhatsApp Web tab
    chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, tabs => {
      if (tabs.length === 0) {
        sendResponse({ error: 'WhatsApp Web not open' });
      } else {
        // Send data to content script in first matching tab
        chrome.tabs.sendMessage(tabs[0].id, {
          command: 'processList',
          list: msg.list // Array of { number, name, message }
        });
        sendResponse({ success: true });
      }
    });
    return true; // async response
  }
});