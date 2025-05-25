function parseFile(file, callback) {
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
      callback(results.data);
    }
  });
}

const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const progressEl = document.getElementById('progress');
let list = [];

fileInput.addEventListener('change', e => {
  parseFile(e.target.files[0], data => {
    // Expect columns: phoneNumber, name, message
    list = data.map(row => ({
      number: row.phoneNumber,
      name: row.name,
      message: row.message.replace('{{name}}', row.name)
    }));
    startBtn.disabled = false;
  });
});

startBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ command: 'startMessaging', list }, resp => {
    if (resp.error) {
      alert(resp.error);
    }
  });
});