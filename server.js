const express = require('express');
const fs = require('fs');
const multer = require('multer');
const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = 'your-secret-token';  // 変更推奨、環境変数に

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));  // HTML/CSS用フォルダ (後述)

// データファイル
const DATA_FILE = 'players.json';
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ players: [], blacklist: [], logs: [] }));
}

// データ読み込み/保存ヘルパー
function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data));
}

// POST /log: プレイヤー情報受信
app.post('/log', (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) return res.status(400).send('Invalid data');

  const data = loadData();
  const playerMap = new Map(data.players.map(p => [p.fc, p]));

  players.forEach(newPlayer => {
    const { fc, name } = newPlayer;
    const existing = playerMap.get(fc);
    if (existing) {
      if (existing.name !== name) {
        data.logs.push(`${fc}: ${existing.name} → ${name}`);
        existing.name = name;
      }
      // 一致時は何もしない
    } else {
      data.players.push({ fc, name });
    }
  });

  // ソート: FC昇順
  data.players.sort((a, b) => a.fc - b.fc);

  saveData(data);
  res.send('Logged');
});

// GET /log: ログ表示 (HTML)
app.get('/', (req, res) => {
  const data = loadData();

  // ブラックリストを一番上に
  let html = '<h1>Player Logs</h1><ul>';
  data.blacklist.forEach(bl => {
    const gamePlayer = data.players.find(p => p.fc === bl.fc);
    const gameName = gamePlayer ? gamePlayer.name : 'Unknown';
    html += `<li><strong>Blacklist:</strong> ${bl.fc} (${bl.name}): ${gameName}</li>`;
  });

  // 他のプレイヤー (FC昇順)
  data.players.forEach(p => {
    if (!data.blacklist.some(bl => bl.fc === p.fc)) {
      html += `<li>${p.fc}: ${p.name}</li>`;
    }
  });

  // 変更ログ
  html += '</ul><h2>Change Logs</h2><ul>';
  data.logs.forEach(log => {
    html += `<li>${log}</li>`;
  });
  html += '</ul><button onclick="downloadLog()">Download Log</button>';
  html += '<form action="/upload" method="post" enctype="multipart/form-data"><input type="file" name="logFile"><button type="submit">Upload Log</button></form>';

  res.send(`
    <html>
    <head><title>Player Log</title><script>function downloadLog(){window.location.href='/download';}</script></head>
    <body>${html}</body>
    </html>
  `);
});

// POST /blacklist: ブラックリスト追加 (Adminのみ)
app.post('/blacklist', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Unauthorized');

  const { fc, name } = req.body;
  if (!fc || !name) return res.status(400).send('Invalid data');

  const data = loadData();
  if (!data.blacklist.some(bl => bl.fc === parseInt(fc))) {
    data.blacklist.push({ fc: parseInt(fc), name });
    saveData(data);
  }
  res.send('Blacklist added');
});

// GET /admin: ブラックリスト入力フォーム
app.get('/admin', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send('Unauthorized');
  res.send(`
    <html>
    <body>
      <h1>Add Blacklist</h1>
      <form action="/blacklist?token=${ADMIN_TOKEN}" method="post">
        FC: <input type="number" name="fc"><br>
        Name: <input type="text" name="name"><br>
        <button type="submit">Add</button>
      </form>
    </body>
    </html>
  `);
});

// GET /download: ログダウンロード
app.get('/download', (req, res) => {
  const data = loadData();
  res.json(data);  // JSONとしてダウンロード
});

// POST /upload: ログアップロード・マージ
app.post('/upload', upload.single('logFile'), (req, res) => {
  if (!req.file) return res.status(400).send('No file uploaded');

  const uploadedData = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
  fs.unlinkSync(req.file.path);  // .temp削除

  const data = loadData();

  // マージ: players上書き/追加、logs追加、blacklist上書き
  uploadedData.players.forEach(up => {
    const idx = data.players.findIndex(p => p.fc === up.fc);
    if (idx !== -1) {
      if (data.players[idx].name !== up.name) {
        data.logs.push(`${up.fc}: ${data.players[idx].name} → ${up.name}`);
      }
      data.players[idx] = up;
    } else {
      data.players.push(up);
    }
  });

  data.logs = [...new Set([...data.logs, ...uploadedData.logs])];  // 重複除去
  data.blacklist = uploadedData.blacklist || data.blacklist;  // 上書き

  // ソート
  data.players.sort((a, b) => a.fc - b.fc);

  saveData(data);
  res.send('Uploaded and merged');
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
