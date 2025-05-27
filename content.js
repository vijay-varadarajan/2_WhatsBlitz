// Enhanced content.js with improved WhatsApp Web automation
console.log('WhatsBlitz content script loaded');

let queue = [];
let currentIndex = 0;
let isProcessing = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
function initializeScript() {
  console.log('Initializing WhatsBlitz script...');
  
  // Add floating panel immediately
    addFloatingPanel();
    
    // Check if we have a queue to process
    chrome.storage.local.get(['whatsblitzQueue', 'whatsblitzIndex', 'whatsblitzActive'], async (result) => {
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
    });
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
    // Click on search icon first
    const searchIcon = await waitForElement([
      '[data-testid="search"]',
      '[data-icon="search"]',
      'span[data-icon="search"]',
      'button[aria-label="Search"]'
    ]);
    
    if (!searchIcon) {
      console.error('Could not find search icon');
      return false;
    }
    
    searchIcon.click();
    await new Promise(r => setTimeout(r, 1000));
    
    // Find search box
    const searchBox = await waitForElement([
      '[data-testid="search-input"]',
      '[data-testid="chat-list-search"]',
      'div[contenteditable="true"][role="combobox"]',
      'div[title="Search input textbox"]',
      '[placeholder*="Search"]',
      'div[aria-label="Search input textbox"]',
    ]);
    
    if (!searchBox) {
      console.error('Could not find search box');
      return false;
    }
    
    // Clear search box
    searchBox.focus();
    await new Promise(r => setTimeout(r, 500));
    
    // Clear existing content
    searchBox.innerHTML = '';
    searchBox.textContent = '';
    
    // Format phone number
    const formattedNumber = formatPhoneNumber(contact.number);
    
    // Try different search terms
    const searchTerms = [
      formattedNumber,
      contact.number.replace(/^\+/, ''),
      contact.number.replace(/\D/g, ''),
      contact.name
    ].filter(term => term && term.trim());
    
    for (const searchTerm of searchTerms) {
      console.log('Trying search term:', searchTerm);
      
      // Clear and type search term
      searchBox.innerHTML = '';
      searchBox.textContent = '';
      searchBox.innerHTML = searchTerm;
      
      // Trigger input events
      searchBox.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        inputType: 'insertText', 
        data: searchTerm 
      }));
      
      // Wait for results
      await new Promise(r => setTimeout(r, 2000));
      
      // Look for chat results
      const chatFound = await selectFirstChatResult();
      if (chatFound) {
        return true;
      }
    }
    
    // If still no results, try creating new chat
    console.log('No existing chat found, trying to create new chat...');
    return await tryCreateNewChat(contact);
    
  } catch (error) {
    console.error('Error in searchForContact:', error);
    return false;
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

function formatPhoneNumber(number) {
  // Remove all non-digit characters
  const cleaned = number.replace(/\D/g, '');
  
  // Add country code if missing
  if (cleaned.length === 10) {
    return '91' + cleaned; // Default to India
  }
  
  return cleaned;
}

async function selectFirstChatResult() {
  // Wait for search results
  await new Promise(r => setTimeout(r, 1500));
  
  // Try to find the first chat result
  const chatList = await waitForElement([
    '[data-testid="chat-list"]',
    '[role="list"]'
  ]);
  
  if (!chatList) {
    console.error('Could not find chat list');
    return false;
  }
  
  // Find all chat items
  const chatItems = chatList.querySelectorAll([
    '[data-testid="cell-frame-container"]',
    '[data-testid="cell-frame-title"]',
    '[role="row"]',
    '[role="button"]'
  ].join(','));
  
  if (!chatItems.length) {
    console.error('No chat items found');
    return false;
  }
  
  // Click the first visible chat item
  for (const item of chatItems) {
    if (item.offsetParent !== null) {
      console.log('Found chat item:', item);
      item.click();
      
      // Wait for chat to open
      await new Promise(r => setTimeout(r, 1500));
      
      // Verify chat opened
      const chatHeader = await waitForElement([
        '[data-testid="conversation-header"]',
        '[data-testid="chat-header"]'
      ], 5000);
      
      if (chatHeader) {
        console.log('Chat opened successfully');
        return true;
      }
    }
  }
  
  return false;
}

async function tryCreateNewChat(contact) {
  // Click new chat button
  const newChatButton = await waitForElement([
    '[data-testid="new-chat"]',
    '[title="New chat"]',
    '[aria-label="New chat"]'
  ]);
  
  if (!newChatButton) {
    console.error('Could not find new chat button');
    return false;
  }
  
  newChatButton.click();
  await new Promise(r => setTimeout(r, 1000));
  
  return await searchInNewChatDialog(contact);
}

async function searchInNewChatDialog(contact) {
  const searchBox = await waitForElement([
    '[data-testid="search-input"]',
    '[data-testid="chat-list-search"]',
    'div[contenteditable="true"][role="combobox"]'
  ]);
  
  if (!searchBox) {
    console.error('Could not find search box in new chat dialog');
    return false;
  }
  
  // Clear and type phone number
  searchBox.innerHTML = '';
  searchBox.textContent = '';
  searchBox.innerHTML = formatPhoneNumber(contact.number);
  
  // Trigger input events
  searchBox.dispatchEvent(new InputEvent('input', { 
        bubbles: true, 
        inputType: 'insertText', 
    data: formatPhoneNumber(contact.number)
      }));
      
  // Wait for results
      await new Promise(r => setTimeout(r, 2000));
      
  // Look for contact in results
  const contactResult = await waitForElement([
    '[data-testid="cell-frame-container"]',
    '[data-testid="cell-frame-title"]',
    '[role="row"]'
  ]);
  
  if (contactResult) {
    contactResult.click();
        return true;
  }
  
  return false;
}

async function waitForChatToLoad() {
  // Wait for chat header to appear
  const chatHeader = await waitForElement([
    '[data-testid="conversation-header"]',
    '[data-testid="chat-header"]'
  ]);
  
  if (!chatHeader) {
    throw new Error('Chat header not found');
  }
  
  // Wait for message input to be ready
  const messageInput = await waitForElement([
    '[data-testid="conversation-compose-box-input"]',
    '[data-testid="msg-input"]',
    'div[contenteditable="true"][role="textbox"]'
  ]);
  
  if (!messageInput) {
    throw new Error('Message input not found');
  }
  
  return true;
}

async function sendMessage(message) {
  try {
    // Wait for message input
    const messageInput = await waitForElement([
      '[data-testid="conversation-compose-box-input"]',
      '[data-testid="msg-input"]',
      'div[contenteditable="true"][role="textbox"]'
    ], 10000);
    
    if (!messageInput) {
      console.error('Could not find message input');
      return false;
    }
    
    // Focus and clear input
    messageInput.focus();
    await new Promise(r => setTimeout(r, 500));
    
    // Clear existing content
    messageInput.innerHTML = '';
    messageInput.textContent = '';
    
    // Type message
    messageInput.innerHTML = message;
    
    // Trigger input events
    messageInput.dispatchEvent(new InputEvent('input', {
      bubbles: true, 
      inputType: 'insertText', 
      data: message 
    }));
    
    // Wait for send button to become active
    await new Promise(r => setTimeout(r, 1000));
    
    // Find send button
    const sendButton = await waitForElement([
      '[data-testid="send"]',
      '[data-icon="send"]',
      'span[data-icon="send"]'
    ], 5000);
    
    if (!sendButton) {
      console.error('Could not find send button');
      return false;
    }
    
    // Click send button
    sendButton.click();
    
    // Wait for message to be sent
    await new Promise(r => setTimeout(r, 2000));
    
    // Verify message was sent
    const messageContainer = await waitForElement([
      '[data-testid="msg-container"]',
      '[data-pre-plain-text]'
    ], 5000);
    
    if (!messageContainer) {
      console.error('Could not verify message was sent');
      return false;
    }
    
    console.log('Message sent successfully');
    return true;
    
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}

async function moveToNextContact() {
  currentIndex++;
  retryCount = 0;
  
  // Update progress in storage
  chrome.storage.local.set({
    whatsblitzIndex: currentIndex
  });
  
  // Add random delay between messages (5-15 seconds)
  const delay = Math.floor(Math.random() * 10000) + 5000;
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
  const progress = Math.round((currentIndex / queue.length) * 100);
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
      messageElement.textContent = 'Process completed!';
    }
  }
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
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    padding: 15px;
    z-index: 9999;
    font-family: Arial, sans-serif;
  `;
  
  // Add content
  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <h3 style="margin: 0; color: #128C7E;">WhatsBlitz</h3>
      <button id="whatsblitz-close" style="border: none; background: none; cursor: pointer; color: #666;">×</button>
    </div>
    <div style="margin-bottom: 10px;">
      <div style="height: 4px; background: #eee; border-radius: 2px;">
        <div class="progress" style="width: 0%; height: 100%; background: #128C7E; border-radius: 2px; transition: width 0.3s;"></div>
      </div>
    </div>
    <div class="message" style="color: #666; font-size: 14px;">Ready to start...</div>
  `;
  
  // Add to page
  document.body.appendChild(panel);
  
  // Make draggable
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  
  panel.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);
  
  function dragStart(e) {
    if (e.target.id === 'whatsblitz-close') return;
    
    initialX = e.clientX - panel.offsetLeft;
    initialY = e.clientY - panel.offsetTop;
    
    if (e.target === panel || panel.contains(e.target)) {
      isDragging = true;
    }
  }
  
  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      panel.style.left = currentX + 'px';
      panel.style.top = currentY + 'px';
    }
  }
  
  function dragEnd() {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }
  
  // Add close button handler
  const closeButton = panel.querySelector('#whatsblitz-close');
  closeButton.addEventListener('click', () => {
    panel.remove();
  });
}