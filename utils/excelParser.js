const xlsx = require('xlsx');

function parseExcel(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

function validateApplicationNo(no) {
  // Format: UP12345/25
  return /^UP\d{4,6}\/\d{2}$/.test(String(no).trim());
}

module.exports = { parseExcel, validateApplicationNo };