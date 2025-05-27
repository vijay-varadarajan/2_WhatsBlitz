// WhatsBlitz popup script
document.addEventListener('DOMContentLoaded', () => {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput');
  const preview = document.getElementById('preview');
  const previewCount = document.getElementById('previewCount');
  const previewTableBody = document.getElementById('previewTableBody');
  const clearBtn = document.getElementById('clearBtn');
  const startBtn = document.getElementById('startBtn');
  const status = document.getElementById('status');
  const statusMessage = document.getElementById('statusMessage');
  
  let contacts = [];
  
  // Drag and drop handlers
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.classList.remove('dragover');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  });
  
  // Click to upload
  uploadArea.addEventListener('click', () => {
    fileInput.click();
  });
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFile(file);
    }
  });
  
  // Clear button
  clearBtn.addEventListener('click', () => {
    contacts = [];
    updatePreview();
    updateButtons();
    hideStatus();
  });
  
  // Start button
  startBtn.addEventListener('click', async () => {
    if (!contacts.length) return;
    
    try {
      // Check if WhatsApp Web is open
      const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      
      if (!tabs.length) {
        showStatus('Please open WhatsApp Web first', 'error');
        return;
      }
      
      // Send contacts to content script
      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        command: 'processList',
        list: contacts
      });
      
      if (response && response.received) {
        showStatus(`Started sending ${response.received} messages`, 'success');
        window.close();
      } else {
        showStatus('Failed to start sending messages', 'error');
      }
    } catch (error) {
      console.error('Error starting process:', error);
      showStatus('Error: ' + error.message, 'error');
    }
  });
  
  // File handling
  function handleFile(file) {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        
        // Parse CSV
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (results.errors.length) {
              showStatus('Error parsing file: ' + results.errors[0].message, 'error');
              return;
            }
            
            // Log the first row to help debug column names
            console.log('First row of CSV:', results.data[0]);
            
            // Validate and process contacts
            contacts = results.data
              .map(row => {
                // Try all possible variations of column names
                const number = row.phoneNumber || row.phone_number || row.phone || row.number || 
                             row.PhoneNumber || row.Phone_Number || row.Phone || row.Number;
                const name = row.name || row.Name || row.firstName || row.first_name || 
                           row.FirstName || row.First_Name;
                const message = row.message || row.Message || row.text || row.Text;
                
                // Log the extracted values for debugging
                console.log('Extracted values:', { number, name, message });
                
                return { number, name, message };
              })
              .filter(contact => {
                if (!contact.number) {
                  showStatus('Missing phone number in some rows', 'error');
                  return false;
                }
                if (!contact.message) {
                  showStatus('Missing message in some rows', 'error');
                  return false;
                }
                return true;
              });
            
            if (contacts.length) {
              updatePreview();
              updateButtons();
              showStatus(`Loaded ${contacts.length} contacts`, 'success');
            } else {
              showStatus('No valid contacts found in file', 'error');
            }
          }
        });
      } catch (error) {
        console.error('Error reading file:', error);
        showStatus('Error reading file: ' + error.message, 'error');
      }
    };
    
    reader.onerror = () => {
      showStatus('Error reading file', 'error');
    };
    
    reader.readAsText(file);
  }
  
  // Update preview table
  function updatePreview() {
    if (!contacts.length) {
      preview.classList.remove('show');
      return;
    }
    
    preview.classList.add('show');
    previewCount.textContent = `${contacts.length} contact${contacts.length === 1 ? '' : 's'}`;
    
    // Show first 5 contacts
    const previewContacts = contacts.slice(0, 5);
    previewTableBody.innerHTML = previewContacts.map(contact => `
      <tr>
        <td>${contact.number}</td>
        <td>${contact.name || '-'}</td>
        <td>${contact.message.length > 50 ? contact.message.substring(0, 50) + '...' : contact.message}</td>
      </tr>
    `).join('');
    
    if (contacts.length > 5) {
      previewTableBody.innerHTML += `
        <tr>
          <td colspan="3" style="text-align: center; color: #666;">
            + ${contacts.length - 5} more contacts
          </td>
        </tr>
      `;
    }
  }
  
  // Update button states
  function updateButtons() {
    const hasContacts = contacts.length > 0;
    clearBtn.disabled = !hasContacts;
    startBtn.disabled = !hasContacts;
  }
  
  // Show status message
  function showStatus(message, type = 'success') {
    status.className = 'status show ' + type;
    statusMessage.textContent = message;
  }
  
  // Hide status message
  function hideStatus() {
    status.className = 'status';
  }
  
  // Check for active process
  chrome.storage.local.get(['whatsblitzActive', 'whatsblitzProgress', 'whatsblitzMessage'], (result) => {
    if (result.whatsblitzActive) {
      showStatus(`Process in progress: ${result.whatsblitzMessage || 'Sending messages...'}`, 'success');
      startBtn.disabled = true;
    }
  });
});