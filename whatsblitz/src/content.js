// src/content.js
let queue = [];

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
    // Random delay between 5s and 15s
    const delay = 5000 + Math.random() * 10000;
    await new Promise(r => setTimeout(r, delay));
    // TODO: update progress via chrome.runtime.sendMessage
  }
}

async function sendMessageTo(number, message) {
  // 1. Open chat via URL scheme
  window.location.href = `https://web.whatsapp.com/send?phone=${number}`;
  // 2. Wait for chat to load
  await new Promise(r => setTimeout(r, 3000));
  // 3. Find input and paste message
  const input = document.querySelector('[contenteditable]');
  input.innerText = message;
  // 4. Click send button
  document.querySelector('button[data-icon="send"]').click();
}