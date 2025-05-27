// src/background.js
console.log('WhatsBlitz background script loaded');

// Listen for popup commands
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('Background received message:', msg.command);
  
  if (msg.command === 'startMessaging') {
    console.log('Starting messaging process with', msg.list.length, 'contacts');
    
    // Find open WhatsApp Web tab
    chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, async tabs => {
      console.log('Found WhatsApp tabs:', tabs.length);
      
      if (tabs.length === 0) {
        console.log('No WhatsApp Web tab found');
        sendResponse({ error: 'Please open WhatsApp Web first and make sure you are logged in.' });
        return;
      }
      
      const targetTab = tabs[0];
      console.log('Sending message to tab:', targetTab.id);
      
      try {
        // Ensure content script is injected
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          files: ['src/content.js']
        });
        
        // Send data to content script
        const response = await chrome.tabs.sendMessage(targetTab.id, {
          command: 'processList',
          list: msg.list
        });
        
        console.log('Content script responded:', response);
        sendResponse({ success: true, received: response?.received || msg.list.length });
        
      } catch (error) {
        console.error('Error in messaging process:', error);
        
        if (error.message.includes('Could not establish connection')) {
          sendResponse({ error: 'Failed to communicate with WhatsApp Web. Please refresh the page and try again.' });
        } else {
          sendResponse({ error: 'An unexpected error occurred: ' + error.message });
        }
      }
    });
    
    return true; // Keep message channel open for async response
  }
  
  return false;
});

// Handle tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only care about WhatsApp Web tabs
  if (tab.url && tab.url.includes('web.whatsapp.com') && changeInfo.status === 'complete') {
    console.log('WhatsApp Web tab updated:', tabId);
    
    try {
      // Check if there's an active queue
      const result = await chrome.storage.local.get(['whatsblitzActive', 'whatsblitzQueue']);
      
      if (result.whatsblitzActive && result.whatsblitzQueue) {
        console.log('Active queue detected, ensuring content script is injected');
        
        // Inject content script
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['src/content.js']
        });
        
        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Resume the queue
        await chrome.tabs.sendMessage(tabId, {
          command: 'processList',
          list: result.whatsblitzQueue
        });
      }
    } catch (error) {
      console.error('Error handling tab update:', error);
    }
  }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    // Check if this was a WhatsApp Web tab with an active queue
    const result = await chrome.storage.local.get(['whatsblitzActive', 'whatsblitzQueue']);
    
    if (result.whatsblitzActive && result.whatsblitzQueue) {
      // Check if there are any other WhatsApp Web tabs
      const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      
      if (tabs.length === 0) {
        // No more WhatsApp Web tabs, clear the queue
        await chrome.storage.local.remove(['whatsblitzActive', 'whatsblitzQueue', 'whatsblitzIndex']);
        console.log('Cleared queue due to WhatsApp Web tab closure');
      }
    }
  } catch (error) {
    console.error('Error handling tab removal:', error);
  }
});