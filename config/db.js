const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create or connect to the local SQLite database file
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('SQLite connection error:', err);
});

// Wrapper to mimic mysql2/promise pool.query()
const pool = {
  query: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      // Replace MySQL's "INSERT IGNORE" and other specific syntax if needed,
      // but standard INSERT works well. 
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('SHOW');
      
      if (isSelect) {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          // Return an array where the first element is the rows (mimicking MySQL [rows, fields])
          else resolve([rows]);
        });
      } else {
        db.run(sql, params, function(err) {
          if (err) {
            // Map SQLite UNIQUE constraint error to MySQL ER_DUP_ENTRY for compatibility with excel bulk upload
            if (err.message.includes('UNIQUE constraint failed')) {
              err.code = 'ER_DUP_ENTRY';
            }
            reject(err);
          } else {
            // Return an array where the first element is the result object
            resolve([{ insertId: this.lastID, affectedRows: this.changes }]);
          }
        });
      }
    });
  }
};

module.exports = pool;