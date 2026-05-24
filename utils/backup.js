const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const pool = require('../config/db');

async function runBackup(type = 'auto') {
  return new Promise(async (resolve, reject) => {
    try {
      const timestamp = Date.now();
      const filename = `backup_${timestamp}.zip`;
      const filepath = path.join('backups', filename);
      const output = fs.createWriteStream(filepath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', async () => {
        const sizeKb = Math.round(archive.pointer() / 1024);
        await pool.query(
          "INSERT INTO backup_logs (filename, size_kb, type, status) VALUES (?, ?, ?, ?)",
          [filename, sizeKb, type, 'success']
        );
        resolve({ filename, sizeKb });
      });

      archive.on('error', err => reject(err));
      archive.pipe(output);

      // Dump tables to JSON
      const tables = ['users', 'applications', 'certificates', 'uploads', 'objections', 'otp_codes', 'action_logs', 'notices'];
      for (const t of tables) {
        const [rows] = await pool.query(`SELECT * FROM ${t}`);
        archive.append(JSON.stringify(rows, null, 2), { name: `${t}.json` });
      }

      // Include uploads folder
      if (fs.existsSync('uploads')) archive.directory('uploads/', 'uploads');

      await archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { runBackup };