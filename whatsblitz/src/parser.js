import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export function parseFile(file, callback) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    Papa.parse(file, {
      header: true,
      complete: (results) => callback(results.data)
    });

  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws);
      callback(data);
    };
    reader.readAsBinaryString(file);

  } else {
    alert('Unsupported file type');
  }
}