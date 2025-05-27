// src/background.js
console.log('WhatsBlitz background script loaded');

// Keep track of injected tabs
const injectedTabs = new Set();

// Helper function to inject content script
async function injectContentScript(tabId) {
  try {
    console.log('Injecting content script into tab:', tabId);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    injectedTabs.add(tabId);
    
    // Wait for script to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    console.error('Error injecting content script:', error);
    return false;
  }
}

// Helper function to send message with retry
async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      
      if (error.message.includes('Extension context invalidated')) {
        throw error; // Don't retry if extension context is invalid
      }
      
      if (i < maxRetries - 1) {
        // Try to reinject the content script
        const injected = await injectContentScript(tabId);
        if (!injected) {
          throw new Error('Failed to reinject content script');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  throw new Error('Failed to send message after retries');
}

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
        if (!injectedTabs.has(targetTab.id)) {
          const injected = await injectContentScript(targetTab.id);
          if (!injected) {
            throw new Error('Failed to inject content script');
          }
        }
        
        // Send data to content script with retry
        const response = await sendMessageWithRetry(targetTab.id, {
          command: 'processList',
          list: msg.list
        });
        
        console.log('Content script responded:', response);
        sendResponse({ success: true, received: response?.received || msg.list.length });
        
      } catch (error) {
        console.error('Error in messaging process:', error);
        
        if (error.message.includes('Extension context invalidated')) {
          sendResponse({ error: 'Extension context invalidated. Please reload the extension and try again.' });
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
        
        // Inject content script if not already injected
        if (!injectedTabs.has(tabId)) {
          const injected = await injectContentScript(tabId);
          if (!injected) {
            throw new Error('Failed to inject content script');
          }
        }
        
        // Resume the queue with retry
        await sendMessageWithRetry(tabId, {
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
  // Remove from injected tabs set
  injectedTabs.delete(tabId);
  
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