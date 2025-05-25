// src/content.js
let queue = [];

console.log('WhatsBlitz content script loaded');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.command === 'processList') {
    queue = msg.list;
    sendResponse({ received: queue.length });
    startSending();
  }
});

async function startSending() {
  for (let i = 0; i < queue.length; i++) {
    const { number, message } = queue[i];
    await sendMessageTo(number, message);
    // Update progress panel
    document.getElementById("whatsblitz-progress").innerText = `Sent ${i + 1} of ${queue.length}`;
    // Random delay between 5s and 15s
    const delay = 5000 + Math.random() * 10000;
    await new Promise(r => setTimeout(r, delay));
  }
}

async function sendMessageTo(number, message) {
  // 1. Open chat via URL scheme
  window.location.href = `https://web.whatsapp.com/send?phone=${number}`;
  // 2. Wait for chat to load and input to appear
  let input = null;
  for (let i = 0; i < 30; i++) { // wait up to ~6 seconds
    input = document.querySelector('[contenteditable="true"]');
    if (input && input.offsetParent !== null) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!input) {
    alert('Could not find WhatsApp message input box.');
    return;
  }
  // 3. Set message and dispatch input event
  input.focus();
  document.execCommand('selectAll', false, null); // clear any existing text
  document.execCommand('insertText', false, message);
  // 4. Wait for send button to appear
  let sendBtn = null;
  for (let i = 0; i < 30; i++) {
    sendBtn = document.querySelector('button[data-icon="send"]');
    if (sendBtn && !sendBtn.disabled) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (!sendBtn) {
    alert('Could not find WhatsApp send button.');
    return;
  }
  sendBtn.click();
}

function addFloatingPanel() {
  const panel = document.createElement('div');
  panel.id = 'whatsblitz-panel';
  panel.style = `
    position: fixed;
    top: 20px; right: 20px;
    background: white;
    border: 1px solid #ccc;
    padding: 10px;
    z-index: 9999;
    box-shadow: 0 0 10px rgba(0,0,0,0.1);
  `;
  panel.innerHTML = '<strong>WhatsBlitz Running...</strong><div id="whatsblitz-progress"></div>';
  document.body.appendChild(panel);
}
addFloatingPanel();
