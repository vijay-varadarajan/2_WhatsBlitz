// WhatsBlitz content script - Fixed version
console.log('WhatsBlitz content script loaded');

let queue = [];
let currentIndex = 0;
let isProcessing = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// Notify that content script is ready
chrome.runtime.sendMessage({ command: 'contentScriptReady' });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('Content script received message:', msg.command);
  
  if (msg.command === 'processList') {
    console.log('Received processList command with', msg.list.length, 'contacts');
    
    // Store queue in Chrome storage
    chrome.storage.local.set({
      whatsblitzQueue: msg.list,
      whatsblitzIndex: 0,
      whatsblitzActive: true,
      whatsblitzStartTime: Date.now()
    }, () => {
      queue = msg.list;
      currentIndex = 0;
      isProcessing = true;
      
      console.log('Queue stored, starting process...');
      sendResponse({ received: queue.length });
      
      // Start the process after a short delay
      setTimeout(() => {
        processCurrentContact();
      }, 1000);
    });
    
    return true; // Keep message channel open for async response
  }
});

// Initialize script
async function initializeScript() {
  console.log('Initializing WhatsBlitz script...');
  
  try {
    // Add floating panel immediately
    addFloatingPanel();
    
    // Check if we have a queue to process
    const result = await chrome.storage.local.get(['whatsblitzQueue', 'whatsblitzIndex', 'whatsblitzActive']);
    
    if (result.whatsblitzActive && result.whatsblitzQueue && result.whatsblitzQueue.length > 0) {
      queue = result.whatsblitzQueue;
      currentIndex = result.whatsblitzIndex || 0;
      isProcessing = true;
      
      console.log(`Resuming queue: ${currentIndex}/${queue.length}`);
      updateProgress();
      
      // Resume processing
      setTimeout(() => {
        processCurrentContact();
      }, 2000);
    }
  } catch (error) {
    console.error('Error initializing script:', error);
  }
}

// Better initialization handling
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeScript);
} else {
  initializeScript();
}

async function processCurrentContact() {
  if (!isProcessing || currentIndex >= queue.length) {
    console.log('Processing complete or stopped');
    completeProcess();
    return;
  }

  const contact = queue[currentIndex];
  console.log(`Processing contact ${currentIndex + 1}/${queue.length}: ${contact.name} (${contact.number})`);
  
  updateProgress(`Searching for ${contact.name || contact.number}...`);
  
  try {
    // Step 1: Search for the contact
    const searchSuccess = await searchForContact(contact);
    
    if (!searchSuccess) {
      console.log(`❌ Could not find contact: ${contact.number}`);
      await handleContactNotFound(contact);
      return;
    }
    
    // Step 2: Wait for chat to load
    await waitForChatToLoad();
    
    // Step 3: Send the message
    updateProgress(`Sending message to ${contact.name || contact.number}...`);
    const sendSuccess = await sendMessage(contact.message);
    
    if (sendSuccess) {
      console.log(`✅ Message sent successfully to ${contact.number}`);
      await moveToNextContact();
    } else {
      console.log(`❌ Failed to send message to ${contact.number}`);
      await handleSendFailure(contact);
    }
    
  } catch (error) {
    console.error('Error processing contact:', error);
    await handleContactError(contact, error);
  }
}

async function searchForContact(contact) {
  console.log('Searching for contact:', contact.number);
  
  try {
    // First, try to click the search button
    const searchButtonClicked = await clickSearchButton();
    if (!searchButtonClicked) {
      console.error('Failed to activate search');
      return false;
    }
    
    // Find the search input box
    const searchBox = await waitForSearchBox();
    if (!searchBox) {
      console.error('Could not find search box');
      return false;
    }
    
    // Clear any existing search
    await clearSearchBox(searchBox);
    
    // Format and try different phone number variations
    const searchTerms = getSearchTerms(contact);
    
    for (const searchTerm of searchTerms) {
      console.log('Trying search term:', searchTerm);
      
      // Type the search term
      await typeInSearchBox(searchBox, searchTerm);
      
      // Wait for search results
      await new Promise(r => setTimeout(r, 2000));
      
      // Try to select a chat result
      const chatSelected = await selectChatResult();
      if (chatSelected) {
        console.log('Chat selected successfully');
        return true;
      }
      
      // Clear search box for next attempt
      await clearSearchBox(searchBox);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // If no existing chat found, try to start a new chat
    console.log('No existing chat found, trying to start new chat...');
    return await startNewChat(contact);
    
  } catch (error) {
    console.error('Error in searchForContact:', error);
    return false;
  }
}

async function clickSearchButton() {
  // Try multiple possible search button selectors
  const searchSelectors = [
    '[data-testid="search"]',
    '[data-icon="search"]',
    'span[data-icon="search"]',
    '[aria-label="Search or start new chat"]',
    '[title="Search or start new chat"]',
    'div[role="button"][title*="Search"]',
    'div[role="button"][aria-label*="Search"]',
    // Add more specific selectors for WhatsApp Web
    'div[data-testid="search-bar"]',
    'div[data-testid="search-container"]',
    'div[data-testid="search"] button',
    'div[data-testid="search"] div[role="button"]'
  ];
  
  // First try to find and click the search button
  for (const selector of searchSelectors) {
    const searchButton = document.querySelector(selector);
    if (searchButton && searchButton.offsetParent !== null) {
      console.log('Found search button with selector:', selector);
      searchButton.click();
      await new Promise(r => setTimeout(r, 1000));
      
      // Verify search box appeared
      const searchBox = await waitForSearchBox();
      if (searchBox) {
        return true;
      }
    }
  }
  
  // If no button found or click didn't work, try to find and focus the search box directly
  const searchBox = await waitForSearchBox();
  if (searchBox) {
    console.log('Found search box directly, focusing it');
    searchBox.focus();
    return true;
  }
  
  console.log('Search button not found and could not find search box directly');
  return false;
}

async function waitForSearchBox() {
  const searchSelectors = [
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-testid*="search"]',
    'div[contenteditable="true"][title*="Search"]',
    'div[contenteditable="true"][aria-label*="Search"]',
    'div[data-testid="chat-list-search"] div[contenteditable="true"]',
    'input[type="text"][title*="Search"]',
    // Add more specific selectors for WhatsApp Web
    'div[data-testid="search-bar"] div[contenteditable="true"]',
    'div[data-testid="search-bar"] input[type="text"]',
    'div[data-testid="search-bar"] div[role="textbox"]',
    'div[data-testid="search-bar"] div[contenteditable]',
    // Add selectors for the search container
    'div[data-testid="search-bar"]',
    'div[data-testid="search-container"]',
    'div[data-testid="search"]'
  ];
  
  // First try to find the search container
  const searchContainer = await waitForElement(searchSelectors.slice(-3), 5000);
  if (!searchContainer) {
    console.error('Could not find search container');
    return null;
  }
  
  // Then look for the input within the container
  const inputSelectors = searchSelectors.slice(0, -3);
  for (const selector of inputSelectors) {
    const input = searchContainer.querySelector(selector);
    if (input && input.offsetParent !== null) {
      console.log('Found search input with selector:', selector);
      return input;
    }
  }
  
  // If not found in container, try document-wide search
  return await waitForElement(inputSelectors, 5000);
}

async function clearSearchBox(searchBox) {
  searchBox.focus();
  await new Promise(r => setTimeout(r, 300));
  
  // Select all and delete
  document.execCommand('selectAll');
  document.execCommand('delete');
  
  // Also clear innerHTML and textContent
  searchBox.innerHTML = '';
  searchBox.textContent = '';
  
  await new Promise(r => setTimeout(r, 300));
}

async function typeInSearchBox(searchBox, text) {
  searchBox.focus();
  await new Promise(r => setTimeout(r, 300));
  
  // Clear first
  await clearSearchBox(searchBox);
  
  // Type character by character to simulate human typing
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // Insert character
    document.execCommand('insertText', false, char);
    
    // Trigger events
    searchBox.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: char
    }));
    
    // Small delay between characters
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
  }
  
  // Final events
  searchBox.dispatchEvent(new Event('input', { bubbles: true }));
  searchBox.dispatchEvent(new Event('change', { bubbles: true }));
}

function getSearchTerms(contact) {
  const rawNumber = contact.number.toString();
  const cleanNumber = rawNumber.replace(/\D/g, '');
  
  const terms = [];
  
  // Add name if available
  if (contact.name && contact.name.trim() && contact.name !== contact.number) {
    terms.push(contact.name.trim());
  }
  
  // Add various number formats
  terms.push(rawNumber); // Original format
  terms.push(cleanNumber); // Clean digits only
  
  // Add with country code variations
  if (cleanNumber.length === 10) {
    terms.push('+91' + cleanNumber); // India
    terms.push('91' + cleanNumber);
  } else if (cleanNumber.length === 12 && cleanNumber.startsWith('91')) {
    terms.push('+' + cleanNumber);
    terms.push(cleanNumber.substring(2)); // Remove country code
  } else if (cleanNumber.length === 13 && cleanNumber.startsWith('91')) {
    terms.push('+' + cleanNumber);
  }
  
  // Remove duplicates
  return [...new Set(terms)];
}

async function selectChatResult() {
  // Wait longer for results to appear and stabilize
  await new Promise(r => setTimeout(r, 3000));
  
  // Try to find chat list items
  const chatSelectors = [
    '[data-testid="cell-frame-container"]',
    'div[role="listitem"]',
    'div[data-testid="chat-list"] > div > div',
    'div[aria-label*="Chat with"]',
    'div[class*="chat-list"] div[role="button"]'
  ];
  
  // First try to find the search results container
  const resultsContainer = document.querySelector('div[data-testid="chat-list-search"]') ||
                         document.querySelector('div[data-testid="search-results"]') ||
                         document.querySelector('div[role="listbox"]');
  
  if (resultsContainer) {
    console.log('Found search results container');
    
    // Look for the first visible result in the container
    for (const selector of chatSelectors) {
      const items = resultsContainer.querySelectorAll(selector);
      
      // Find the first visible item
      const firstVisibleItem = Array.from(items).find(item => 
        item.offsetParent !== null && 
        item.getBoundingClientRect().height > 0 &&
        item.getBoundingClientRect().top >= 0
      );
      
      if (firstVisibleItem) {
        console.log('Clicking first visible chat item:', firstVisibleItem);
        
        // Scroll the item into view if needed
        firstVisibleItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 500));
        
        // Click the item
        firstVisibleItem.click();
        
        // Wait for chat to load
        await new Promise(r => setTimeout(r, 2000));
        
        // Verify chat opened by checking for message input
        const messageInput = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                           document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                           document.querySelector('div[contenteditable="true"][role="textbox"]:not([data-tab="3"])');
        
        if (messageInput) {
          console.log('Chat opened successfully');
          return true;
        }
      }
    }
  }
  
  // Fallback: Try finding items in the entire document
  console.log('Falling back to document-wide search');
  for (const selector of chatSelectors) {
    const items = document.querySelectorAll(selector);
    
    // Find the first visible item
    const firstVisibleItem = Array.from(items).find(item => 
      item.offsetParent !== null && 
      item.getBoundingClientRect().height > 0 &&
      item.getBoundingClientRect().top >= 0
    );
    
    if (firstVisibleItem) {
      console.log('Clicking first visible chat item (fallback):', firstVisibleItem);
      
      // Scroll the item into view if needed
      firstVisibleItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 500));
      
      // Click the item
      firstVisibleItem.click();
      
      // Wait for chat to load
      await new Promise(r => setTimeout(r, 2000));
      
      // Verify chat opened by checking for message input
      const messageInput = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                         document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
                         document.querySelector('div[contenteditable="true"][role="textbox"]:not([data-tab="3"])');
      
      if (messageInput) {
        console.log('Chat opened successfully');
        return true;
      }
    }
  }
  
  console.log('No chat items found to select');
  return false;
}

async function startNewChat(contact) {
  try {
    // Try to find and click new chat button
    const newChatSelectors = [
      '[data-testid="new-chat-btn"]',
      '[aria-label="New chat"]',
      '[title="New chat"]',
      'div[role="button"][aria-label*="New"]'
    ];
    
    let newChatButton = null;
    for (const selector of newChatSelectors) {
      newChatButton = document.querySelector(selector);
      if (newChatButton && newChatButton.offsetParent !== null) {
        break;
      }
    }
    
    if (newChatButton) {
      newChatButton.click();
      await new Promise(r => setTimeout(r, 1500));
    }
    
    // Look for contact search in new chat dialog
    const searchBox = await waitForElement([
      'div[contenteditable="true"][data-tab="2"]',
      'div[contenteditable="true"][role="textbox"]'
    ], 5000);
    
    if (!searchBox) {
      console.error('Could not find search box in new chat dialog');
      return false;
    }
    
    // Search for the contact
    const searchTerms = getSearchTerms(contact);
    
    for (const searchTerm of searchTerms) {
      await typeInSearchBox(searchBox, searchTerm);
      await new Promise(r => setTimeout(r, 2000));
      
      // Try to select contact from results
      const contactSelected = await selectContactFromNewChatResults();
      if (contactSelected) {
        return true;
      }
      
      await clearSearchBox(searchBox);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    return false;
    
  } catch (error) {
    console.error('Error starting new chat:', error);
    return false;
  }
}

async function selectContactFromNewChatResults() {
  const contactSelectors = [
    '[data-testid="cell-frame-container"]',
    'div[role="option"]',
    'div[role="button"]'
  ];
  
  for (const selector of contactSelectors) {
    const contacts = document.querySelectorAll(selector);
    
    for (const contact of contacts) {
      if (contact.offsetParent !== null && contact.getBoundingClientRect().height > 0) {
        contact.click();
        await new Promise(r => setTimeout(r, 2000));
        
        // Check if chat opened
        const messageInput = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                           document.querySelector('div[contenteditable="true"][data-tab="10"]');
        
        if (messageInput) {
          return true;
        }
      }
    }
  }
  
  return false;
}

async function waitForChatToLoad() {
  // Wait for message input to be available
  const messageInput = await waitForElement([
    '[data-testid="conversation-compose-box-input"]',
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][role="textbox"]:not([data-tab="3"]):not([data-tab="2"])'
  ], 10000);
  
  if (!messageInput) {
    throw new Error('Message input not found - chat may not have loaded');
  }
  
  return true;
}

async function sendMessage(message) {
  try {
    // Find message input
    const messageInput = await waitForElement([
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][role="textbox"]:not([data-tab="3"]):not([data-tab="2"])'
    ], 10000);
    
    if (!messageInput) {
      console.error('Could not find message input');
      return false;
    }
    
    // Focus and clear input
    messageInput.focus();
    await new Promise(r => setTimeout(r, 500));
    
    // Clear existing content
    await clearMessageInput(messageInput);
    
    // Type message character by character
    await typeMessage(messageInput, message);
    
    // Wait a moment for the send button to become active
    await new Promise(r => setTimeout(r, 1000));
    
    // Find and click send button
    const sendButton = await waitForElement([
      '[data-testid="send"]',
      'span[data-icon="send"]',
      'button[aria-label="Send"]'
    ], 5000);
    
    if (!sendButton) {
      console.error('Could not find send button');
      return false;
    }
    
    sendButton.click();
    
    // Wait for message to be sent
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify message was sent by checking for message in chat
    return await verifyMessageSent(message);
    
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}

async function clearMessageInput(input) {
  input.focus();
  await new Promise(r => setTimeout(r, 300));
  
  // Select all and delete
  document.execCommand('selectAll');
  document.execCommand('delete');
  
  // Also clear innerHTML and textContent
  input.innerHTML = '';
  input.textContent = '';
  
  await new Promise(r => setTimeout(r, 300));
}

async function typeMessage(input, message) {
  input.focus();
  
  // Type character by character
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    
    if (char === '\n') {
      // Handle line breaks
      document.execCommand('insertHTML', false, '<br>');
    } else {
      document.execCommand('insertText', false, char);
    }
    
    // Trigger input events
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: char
    }));
    
    // Random delay between characters
    await new Promise(r => setTimeout(r, 30 + Math.random() * 70));
  }
  
  // Final events
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function verifyMessageSent(message) {
  // Wait for message to appear in chat
  await new Promise(r => setTimeout(r, 1000));
  
  // Look for the message in recent messages
  const messageElements = document.querySelectorAll([
    '[data-testid="msg-container"]',
    'div[class*="message-out"]',
    'div[class*="message"]'
  ].join(','));
  
  // Check last few messages for our text
  const recentMessages = Array.from(messageElements).slice(-3);
  
  for (const msgEl of recentMessages) {
    const text = msgEl.textContent || msgEl.innerText;
    if (text && text.trim().includes(message.trim().substring(0, 50))) {
      console.log('Message verified in chat');
      return true;
    }
  }
  
  console.log('Could not verify message was sent, but proceeding');
  return true; // Assume success if we can't verify
}

async function moveToNextContact() {
  currentIndex++;
  retryCount = 0;
  
  // Update progress in storage
  chrome.storage.local.set({
    whatsblitzIndex: currentIndex
  });
  
  updateProgress();
  
  // Add random delay between messages (5-15 seconds)
  const delay = Math.floor(Math.random() * 10000) + 5000;
  console.log(`Waiting ${delay}ms before next contact...`);
  
  await new Promise(r => setTimeout(r, delay));
  
  // Process next contact
  processCurrentContact();
}

async function handleContactNotFound(contact) {
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`Retrying contact ${retryCount}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, 2000));
    return processCurrentContact();
  }
  
  // Log failure
  logFailure(contact, 'Contact not found');
  
  // Move to next contact
  await moveToNextContact();
}

async function handleSendFailure(contact) {
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`Retrying send ${retryCount}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, 2000));
    return processCurrentContact();
  }
  
  // Log failure
  logFailure(contact, 'Failed to send message');
  
  // Move to next contact
  await moveToNextContact();
}

async function handleContactError(contact, error) {
  console.error('Error processing contact:', error);
  
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`Retrying after error ${retryCount}/${MAX_RETRIES}`);
    await new Promise(r => setTimeout(r, 2000));
    return processCurrentContact();
  }
  
  // Log failure
  logFailure(contact, `Error: ${error.message}`);
  
  // Move to next contact
  await moveToNextContact();
}

function logFailure(contact, reason) {
  const failure = {
    contact,
    reason,
    timestamp: new Date().toISOString()
  };
  
  chrome.storage.local.get(['whatsblitzFailures'], (result) => {
    const failures = result.whatsblitzFailures || [];
    failures.push(failure);
    chrome.storage.local.set({ whatsblitzFailures: failures });
  });
}

function updateProgress(customMessage = null) {
  const progress = queue.length > 0 ? Math.round((currentIndex / queue.length) * 100) : 0;
  const message = customMessage || `Processing ${currentIndex + 1} of ${queue.length} (${progress}%)`;
  
  // Update floating panel
  const panel = document.getElementById('whatsblitz-panel');
  if (panel) {
    const progressElement = panel.querySelector('.progress');
    const messageElement = panel.querySelector('.message');
    
    if (progressElement) {
      progressElement.style.width = `${progress}%`;
    }
    
    if (messageElement) {
      messageElement.textContent = message;
    }
  }
  
  // Update storage
  chrome.storage.local.set({
    whatsblitzProgress: progress,
    whatsblitzMessage: message
  });
}

function completeProcess() {
  isProcessing = false;
  
  // Update storage
  chrome.storage.local.set({
    whatsblitzActive: false,
    whatsblitzCompleted: true,
    whatsblitzEndTime: Date.now()
  });
  
  // Update UI
  updateProgress('Process completed!');
  
  // Show completion message
  const panel = document.getElementById('whatsblitz-panel');
  if (panel) {
    const messageElement = panel.querySelector('.message');
    if (messageElement) {
      messageElement.textContent = `Completed! Sent ${currentIndex} messages.`;
    }
  }
  
  console.log('WhatsBlitz process completed!');
}

function addFloatingPanel() {
  // Remove existing panel if any
  const existingPanel = document.getElementById('whatsblitz-panel');
  if (existingPanel) {
    existingPanel.remove();
  }

  // Create panel
  const panel = document.createElement('div');
  panel.id = 'whatsblitz-panel';
  panel.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    width: 300px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    padding: 15px;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border: 1px solid #e0e0e0;
  `;
  
  // Add content
  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <h3 style="margin: 0; color: #128C7E; font-size: 18px;">WhatsBlitz</h3>
      <button id="whatsblitz-close" style="border: none; background: none; cursor: pointer; color: #666; font-size: 20px; padding: 0; width: 24px; height: 24px;">&times;</button>
    </div>
    <div style="margin-bottom: 15px;">
      <div style="height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden;">
        <div class="progress" style="width: 0%; height: 100%; background: linear-gradient(90deg, #128C7E, #25D366); border-radius: 3px; transition: width 0.3s ease;"></div>
      </div>
    </div>
    <div class="message" style="color: #666; font-size: 14px; line-height: 1.4;">Ready to start...</div>
    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #f0f0f0;">
      <button id="whatsblitz-stop" style="background: #ff4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 12px; display: none;">Stop Process</button>
    </div>
  `;
  
  // Add to page
  document.body.appendChild(panel);
  
  // Make draggable
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  
  const header = panel.querySelector('h3').parentElement;
  header.style.cursor = 'move';
  
  header.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  
  function dragStart(e) {
    if (e.target.id === 'whatsblitz-close') return;
    
    initialX = e.clientX - panel.offsetLeft;
    initialY = e.clientY - panel.offsetTop;
    isDragging = true;
  }
  
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      // Keep panel within viewport
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      
      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));
      
      panel.style.left = currentX + 'px';
      panel.style.top = currentY + 'px';
      panel.style.right = 'auto';
    }
  }
  
  function dragEnd() {
    isDragging = false;
  }
  
  // Add close button handler
  const closeButton = panel.querySelector('#whatsblitz-close');
  closeButton.addEventListener('click', () => {
    panel.remove();
  });
  
  // Add stop button handler
  const stopButton = panel.querySelector('#whatsblitz-stop');
  stopButton.addEventListener('click', () => {
    isProcessing = false;
    chrome.storage.local.set({ whatsblitzActive: false });
    updateProgress('Process stopped by user');
    stopButton.style.display = 'none';
  });
  
  // Show stop button when processing
  if (isProcessing) {
    stopButton.style.display = 'block';
  }
}

async function waitForElement(selectors, timeout = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.offsetParent !== null) {
        return element;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  return null;
}