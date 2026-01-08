const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public')); // 静的ファイル用（HTMLフォーム）

// PostgreSQL接続（Renderの環境変数 DATABASE_URL を使用）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // RenderのPostgres用
});

// DBテーブル作成（初回起動時）
pool.query(`
  CREATE TABLE IF NOT EXISTS players (
    fc INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    fc INTEGER,
    old_name TEXT,
    new_name TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS blacklists (
    fc INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
`).catch(err => console.error('Table creation error:', err));

app.post('/api/log', async (req, res) => {
  const { players } = req.body;
  console.log('Received POST request to /api/log');
  console.log('Players data:', players);  // 受信データをログ
  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: 'Invalid data' });
  }
  try {
    for (const player of players) {
      const { fc, name } = player;
      if (!fc || !name) continue;
      const existing = await pool.query('SELECT name FROM players WHERE fc = $1', [fc]);
      if (existing.rows.length > 0) {
        const oldName = existing.rows[0].name;
        if (oldName !== name) {
          await pool.query('INSERT INTO logs (fc, old_name, new_name) VALUES ($1, $2, $3)', [fc, oldName, name]);
          await pool.query('UPDATE players SET name = $1, last_updated = CURRENT_TIMESTAMP WHERE fc = $2', [name, fc]);
        }
      } else {
        await pool.query('INSERT INTO players (fc, name) VALUES ($1, $2)', [fc, name]);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /: リスト表示（HTML）
app.get('/', async (req, res) => {
  try {
    // ブラックリスト取得
    const blacklists = await pool.query('SELECT * FROM blacklists ORDER BY fc ASC');
    // 通常プレイヤー取得（FC昇順）
    const players = await pool.query('SELECT * FROM players ORDER BY fc ASC');
    // ログ取得（最新順）
    const logs = await pool.query('SELECT * FROM logs ORDER BY timestamp DESC');

    let html = `
      <html>
        <head><title>Player Log</title><style>body{font-family:sans-serif;} ul{list-style:none;} .blacklist{color:red;}</style></head>
        <body>
          <h1>Player List</h1>
          <h2>Blacklists</h2>
          <ul>`;
    blacklists.rows.forEach(bl => {
      // ゲーム内名前を探す
      const gamePlayer = players.rows.find(p => p.fc === bl.fc);
      const gameName = gamePlayer ? gamePlayer.name : 'Unknown';
      html += `<li class="blacklist">(${bl.fc}, ${bl.name}): (${gameName})</li>`;
    });
    html += `</ul>
          <h2>Players (sorted by FC)</h2>
          <ul>`;
    players.rows.forEach(p => {
      html += `<li>${p.fc}: ${p.name}</li>`;
    });
    html += `</ul>
          <h2>Change Logs</h2>
          <ul>`;
    logs.rows.forEach(log => {
      html += `<li>${log.fc}: ${log.old_name} → ${log.new_name} (${log.timestamp})</li>`;
    });
    html += `</ul>
          <h2>Add Blacklist</h2>
          <form action="/blacklist" method="POST">
            FC: <input type="number" name="fc" required>
            Name: <input type="text" name="name" required>
            <button type="submit">Add</button>
          </form>
        </body>
      </html>`;
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

// POST /blacklist: ブラックリスト追加（フォームから）
app.post('/blacklist', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  const { fc, name } = req.body;
  if (!fc || !name) {
    return res.status(400).send('Invalid input');
  }

  try {
    await pool.query('INSERT INTO blacklists (fc, name) VALUES ($1, $2) ON CONFLICT (fc) DO UPDATE SET name = $2', [fc, name]);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
