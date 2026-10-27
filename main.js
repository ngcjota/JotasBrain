// Processo principal do Electron: janela do app e presença no Discord.
const { app, BrowserWindow, shell, ipcMain, dialog, session } = require('electron');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let mainWindow = null;
let discordSocket = null;
let discordBuffer = Buffer.alloc(0);
let discordRetryTimer = null;
let discordReady = false;
let shuttingDown = false;
let presenceConfig = null;
let currentView = null;
let currentLeadCount = 0;
let currentLocale = 'pt-BR';
const sessionStartedAt = Date.now();

function loadPresenceConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'discord-presence.json')
    : path.join(__dirname, 'discord-presence.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const clientId = String(config.clientId || '').trim();
    if (!/^\d{17,20}$/.test(clientId)) {
      console.info('[Discord Presence] Configure o clientId em discord-presence.json para ativar.');
      return null;
    }
    return {
      clientId,
      details: String(config.details || 'Prospecção de criadores').slice(0, 128),
      state: String(config.state || 'Jota’s Brain aberto').slice(0, 128),
      largeImage: String(config.largeImage || '').trim().slice(0, 300),
      largeText: String(config.largeText || 'Jota’s Brain').slice(0, 128)
    };
  } catch (error) {
    console.warn('[Discord Presence] Não foi possível ler discord-presence.json:', error.message);
    return null;
  }
}

ipcMain.on('jotas-brain:update-presence', (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !data || typeof data !== 'object') return;
  if (typeof data.viewName === 'string') {
    const cleanViewName = data.viewName.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (cleanViewName) currentView = cleanViewName;
  }
  if (Number.isSafeInteger(data.leadCount) && data.leadCount >= 0) currentLeadCount = data.leadCount;
  currentLocale = data.language === 'en-US' ? 'en-US' : 'pt-BR';
  publishPresence();
});

// ── Invoice → PDF ──
// A página manda o HTML do invoice (o mesmo da prévia). Ele é aberto numa
// janela invisível, sem JavaScript, e impresso em PDF A4 pelo Chromium.
// Depois o usuário escolhe onde salvar e o PDF abre no leitor padrão.
let lastInvoiceDir = null;
// Pasta padrão dos PDFs: Documentos\Jota's Brain\Invoices (criada na hora).
function invoiceFolder() {
  const dir = path.join(app.getPath('documents'), "Jota's Brain", 'Invoices');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function isDir(p) {
  try { return typeof p === 'string' && path.isAbsolute(p) && fs.statSync(p).isDirectory(); } catch (_) { return false; }
}
ipcMain.handle('jotas-brain:save-invoice-pdf', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'invalid sender' };
  const html = data && typeof data.html === 'string' ? data.html : '';
  if (!html || html.length > 8 * 1024 * 1024) return { ok: false, error: 'invalid invoice' };
  let base = String((data && data.fileName) || 'invoice')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'invoice';
  if (!/\.pdf$/i.test(base)) base += '.pdf';
  const tmp = path.join(app.getPath('temp'), `jotas-brain-invoice-${process.pid}-${Date.now()}.html`);
  let win = null;
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    win = new BrowserWindow({
      show: false, width: 794, height: 1123,
      webPreferences: { javascript: false, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    await win.loadFile(tmp);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    const res = await dialog.showSaveDialog(mainWindow, {
      title: String((data && data.dialogTitle) || 'Salvar invoice em PDF').slice(0, 100),
      defaultPath: path.join(isDir(data && data.dir) ? data.dir : (lastInvoiceDir || invoiceFolder()), base),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, pdf);
    lastInvoiceDir = path.dirname(res.filePath);
    return { ok: true, path: res.filePath, dir: lastInvoiceDir };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.rm(tmp, { force: true }, () => {});
  }
});

// Abrir o PDF salvo (ou mostrá-lo selecionado na pasta).
ipcMain.handle('jotas-brain:open-invoice-file', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'invalid sender' };
  const p = String((data && data.path) || '');
  if (!path.isAbsolute(p) || !/\.pdf$/i.test(p) || !fs.existsSync(p)) return { ok: false, error: 'missing' };
  if (data && data.reveal) { shell.showItemInFolder(p); return { ok: true }; }
  const err = await shell.openPath(p);
  return err ? { ok: false, error: err } : { ok: true };
});
// Abrir a pasta dos PDFs (a última usada ou a padrão).
ipcMain.handle('jotas-brain:open-invoice-folder', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'invalid sender' };
  try {
    const dir = isDir(data && data.dir) ? data.dir : (isDir(lastInvoiceDir) ? lastInvoiceDir : invoiceFolder());
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err } : { ok: true, path: dir };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
});

function makeRpcFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function writeRpc(opcode, payload) {
  if (!discordSocket || discordSocket.destroyed) return false;
  try {
    discordSocket.write(makeRpcFrame(opcode, payload));
    return true;
  } catch (_) {
    return false;
  }
}

function publishPresence() {
  if (!discordReady || !presenceConfig) return;
  const activity = {
    details: (currentLocale === 'en-US' ? 'In ' : 'Em ') + (currentView || (currentLocale === 'en-US' ? 'Discover' : 'Descobrir')),
    state: currentLocale === 'en-US'
      ? `${currentLeadCount.toLocaleString('en-US')} ${currentLeadCount === 1 ? 'channel' : 'channels'} in Pipeline`
      : `${currentLeadCount.toLocaleString('pt-BR')} ${currentLeadCount === 1 ? 'canal' : 'canais'} no Pipeline`,
    timestamps: { start: sessionStartedAt }
  };
  if (presenceConfig.largeImage) {
    activity.assets = {
      large_image: presenceConfig.largeImage,
      large_text: presenceConfig.largeText
    };
  }
  writeRpc(1, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity },
    nonce: crypto.randomUUID()
  });
}

function handleRpcMessage(opcode, json) {
  if (opcode === 3) {
    writeRpc(4, json || {});
    return;
  }
  if (opcode === 2) {
    discordSocket?.destroy();
    return;
  }
  if (opcode !== 1 || !json) return;
  if (json.evt === 'READY') {
    discordReady = true;
    publishPresence();
  }
}

function consumeRpcData(socket, chunk) {
  if (socket !== discordSocket) return;
  discordBuffer = Buffer.concat([discordBuffer, chunk]);
  while (discordBuffer.length >= 8) {
    const opcode = discordBuffer.readUInt32LE(0);
    const length = discordBuffer.readUInt32LE(4);
    if (length > 1024 * 1024) {
      socket.destroy();
      return;
    }
    if (discordBuffer.length < 8 + length) return;
    const body = discordBuffer.subarray(8, 8 + length);
    discordBuffer = discordBuffer.subarray(8 + length);
    let json = null;
    try { json = JSON.parse(body.toString('utf8')); } catch (_) {}
    handleRpcMessage(opcode, json);
  }
}

function scheduleDiscordRetry() {
  if (shuttingDown || discordRetryTimer) return;
  discordRetryTimer = setTimeout(() => {
    discordRetryTimer = null;
    connectDiscord();
  }, 5000);
  discordRetryTimer.unref?.();
}

function connectDiscordPipe(index = 0) {
  if (shuttingDown || !presenceConfig) return;
  if (process.platform !== 'win32') {
    console.info('[Discord Presence] A conexão por named pipe está configurada para Windows.');
    return;
  }
  if (index >= 10) {
    scheduleDiscordRetry();
    return;
  }

  const pipePath = `\\\\?\\pipe\\discord-ipc-${index}`;
  const socket = net.createConnection(pipePath);
  let connected = false;
  socket.once('connect', () => {
    connected = true;
    discordSocket = socket;
    discordBuffer = Buffer.alloc(0);
    discordReady = false;
    socket.write(makeRpcFrame(0, { v: 1, client_id: presenceConfig.clientId }));
  });
  socket.on('data', chunk => consumeRpcData(socket, chunk));
  socket.on('error', () => {
    if (!connected) {
      socket.destroy();
      connectDiscordPipe(index + 1);
    }
  });
  socket.on('close', () => {
    if (discordSocket === socket) {
      discordSocket = null;
      discordReady = false;
      discordBuffer = Buffer.alloc(0);
      scheduleDiscordRetry();
    }
  });
}

function connectDiscord() {
  if (shuttingDown || !presenceConfig || discordSocket) return;
  connectDiscordPipe(0);
}

function stopDiscordPresence() {
  shuttingDown = true;
  if (discordRetryTimer) clearTimeout(discordRetryTimer);
  discordRetryTimer = null;
  if (discordSocket && !discordSocket.destroyed) discordSocket.destroy();
  discordSocket = null;
  discordReady = false;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#08080d',
    title: 'Jota’s Brain — Prospecção de Criadores',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // aba Vagas: o X aparece dentro do app (ver will-attach-webview)
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // Links externos (http/https/mailto) abrem no navegador ou no app de e-mail.
  // Qualquer outro esquema é ignorado, e a janela do app nunca sai do index.html
  // (um link sem target="_blank", como o e-mail no Pipeline, trocaria a página
  // inteira e "sumiria" com o app).
  const openSafely = (url) => {
    if (/^(https?:|mailto:)/i.test(String(url || ''))) shell.openExternal(url);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openSafely(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return;
    event.preventDefault();
    openSafely(url);
  });
  // Aba Vagas: só aceitamos um <webview> do X, isolado, sem acesso ao Node e
  // sem preload. Qualquer outra tentativa de anexar webview é bloqueada.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (params.partition !== X_PARTITION || !isXUrl(params.src)) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; xCloseCollector(); ytCloseCollector(); });
}

// ── Aba Vagas (X dentro do app) ──
// O login fica numa sessão própria e persistente (a pessoa entra uma vez).
// Dentro do painel só navegamos pelo X (e pelas páginas de login do Google/
// Apple, quando a pessoa usa esse tipo de conta). Links para fora abrem no
// navegador padrão.
const X_PARTITION = 'persist:jb-x';
const X_HOSTS = /(^|\.)(x\.com|twitter\.com|twimg\.com)$/i;
const X_LOGIN_HOSTS = /(^|\.)(accounts\.google\.com|appleid\.apple\.com)$/i;
function hostOf(url) { try { return new URL(url).hostname; } catch (_) { return ''; } }
function isXUrl(url) { return /^https:/i.test(String(url || '')) && X_HOSTS.test(hostOf(url)); }
function isXLoginUrl(url) { return /^https:/i.test(String(url || '')) && X_LOGIN_HOSTS.test(hostOf(url)); }
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (isXUrl(url)) { contents.loadURL(url); return { action: 'deny' }; }      // post/perfil abre no próprio painel
    if (isXLoginUrl(url)) return { action: 'allow' };                          // janela de login do Google/Apple
    if (/^https?:/i.test(url)) shell.openExternal(url);                        // links externos (t.co, sites) → navegador
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (isXUrl(url) || isXLoginUrl(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
});

// ── Coletor de vagas do X (roda escondido, sem mostrar a interface do X) ──
// Uma janela invisível, na mesma sessão logada, abre a busca do X. As
// respostas que o próprio site recebe (SearchTimeline) são lidas pelo
// protocolo de depuração do Chromium e viram uma lista simples de posts.
// O ritmo é de uma pessoa: uma busca por vez, com pausa entre elas.
let xCollector = null;
let xCollectBusy = false;
function xCloseCollector() {
  if (xCollector && !xCollector.isDestroyed()) xCollector.destroy();
  xCollector = null;
}
function xCollectorWindow() {
  if (xCollector && !xCollector.isDestroyed()) return xCollector;
  xCollector = new BrowserWindow({
    show: false, width: 1280, height: 2200, skipTaskbar: true,
    webPreferences: {
      partition: X_PARTITION, contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false,
      // renderiza fora da tela: para o X a página está "visível" (algumas
      // partes do site só carregam quando a aba está à vista)
      offscreen: true
    }
  });
  try { xCollector.webContents.setFrameRate(2); } catch (_) {}
  xCollector.webContents.setAudioMuted(true);
  xCollector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  xCollector.on('closed', () => { xCollector = null; });
  return xCollector;
}
async function xLoggedIn() {
  try {
    const cookies = await session.fromPartition(X_PARTITION).cookies.get({ name: 'auth_token' });
    return cookies.some(c => /(^|\.)(x|twitter)\.com$/i.test(String(c.domain || '').replace(/^\./, '')) && c.value);
  } catch (_) { return false; }
}
function xText(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function xNum(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; }
// Transforma um "tweet" do JSON do X num objeto pequeno e previsível.
function xNormalizeTweet(node) {
  const L = node.legacy || {};
  if (L.retweeted_status_result) return null;
  const u = (node.core && node.core.user_results && node.core.user_results.result) || {};
  const ul = u.legacy || {}; const uc = u.core || {};
  const note = node.note_tweet && node.note_tweet.note_tweet_results && node.note_tweet.note_tweet_results.result;
  let text = (note && typeof note.text === 'string' && note.text) || L.full_text || '';
  const ents = (note && note.entity_set) || L.entities || {};
  for (const e of (ents.urls || [])) if (e && e.url && e.expanded_url) text = text.split(e.url).join(e.expanded_url);
  for (const e of ((L.entities && L.entities.media) || [])) if (e && e.url) text = text.split(e.url).join('');
  const handle = xText(uc.screen_name || ul.screen_name, 40);
  const id = String(node.rest_id || '');
  if (!/^\d{5,25}$/.test(id) || !handle) return null;
  const created = Date.parse(L.created_at);
  return {
    id, handle,
    name: xText(uc.name || ul.name, 80),
    avatar: xText((u.avatar && u.avatar.image_url) || ul.profile_image_url_https, 300),
    followers: xNum(ul.followers_count),
    text: text.trim().slice(0, 4000),
    created: Number.isFinite(created) ? created : Date.now(),
    likes: xNum(L.favorite_count), replies: xNum(L.reply_count), reposts: xNum(L.retweet_count),
    views: xNum(node.views && node.views.count),
    lang: xText(L.lang, 8),
    isReply: !!L.in_reply_to_status_id_str,
    media: !!(L.extended_entities && Array.isArray(L.extended_entities.media) && L.extended_entities.media.length) || !!(L.entities && Array.isArray(L.entities.media) && L.entities.media.length)
  };
}
function xExtractTweets(node, out, depth) {
  if (!node || typeof node !== 'object' || depth > 60) return;
  if (Array.isArray(node)) { for (const n of node) xExtractTweets(n, out, depth + 1); return; }
  if (node.rest_id && node.legacy && typeof node.legacy.full_text === 'string') {
    const t = xNormalizeTweet(node);
    if (t) out.set(t.id, t);
    return; // não desce no post citado (ele não é a vaga)
  }
  for (const k of Object.keys(node)) xExtractTweets(node[k], out, depth + 1);
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// nada do coletor pode travar o app: toda etapa tem prazo
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timeout')), ms))]);
ipcMain.handle('jotas-brain:x-status', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { loggedIn: false };
  return { loggedIn: await xLoggedIn() };
});
ipcMain.handle('jotas-brain:x-logout', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  xCloseCollector();
  try { await session.fromPartition(X_PARTITION).clearStorageData(); } catch (_) {}
  return { ok: true };
});
ipcMain.handle('jotas-brain:x-set-token', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  const token = data && typeof data.token === 'string' ? data.token.trim().replace(/^auth_token=/, '').replace(/;.*$/, '') : '';
  if (!/^[a-f0-9]{30,64}$/i.test(token)) return { ok: false, error: 'format' };
  const ses = session.fromPartition(X_PARTITION);
  try {
    const expirationDate = Math.floor(Date.now() / 1000) + 365 * 86400;
    await ses.cookies.set({ url: 'https://x.com', domain: '.x.com', path: '/', name: 'auth_token', value: token, secure: true, httpOnly: true, sameSite: 'no_restriction', expirationDate });
    await ses.cookies.flushStore();
    return { ok: true };
  } catch (error) { return { ok: false, error: String(error && error.message || error).slice(0, 120) }; }
});
// ── YTJobs (ytjobs.co): quadro de vagas público, não precisa de login ──
// Abre a lista de vagas numa janela invisível, clica em "Load More" algumas
// vezes e lê os cards da página. As respostas da API do próprio site, quando
// vêm, completam com a data de publicação e a descrição.
const YT_PARTITION = 'persist:jb-ytjobs';
let ytCollector = null;
let ytBusy = false;
function ytCloseCollector() {
  if (ytCollector && !ytCollector.isDestroyed()) ytCollector.destroy();
  ytCollector = null;
}
function ytWindow() {
  if (ytCollector && !ytCollector.isDestroyed()) return ytCollector;
  ytCollector = new BrowserWindow({
    show: false, width: 1280, height: 2400, skipTaskbar: true,
    webPreferences: { partition: YT_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true }
  });
  try { ytCollector.webContents.setFrameRate(2); } catch (_) {}
  ytCollector.webContents.setAudioMuted(true);
  ytCollector.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ytCollector.on('closed', () => { ytCollector = null; });
  return ytCollector;
}
const YT_EXTRACT = `(() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/job/"]')) {
    const m = (a.getAttribute('href') || '').match(/\\/job\\/(\\d+)/);
    if (!m || seen.has(m[1])) continue;
    const q = (s) => { const e = a.querySelector(s); return e ? e.textContent.trim() : ''; };
    const t = a.querySelector('.card-job-title, h4, h3');
    const lines = (a.innerText || '').split('\\n').map(x => x.trim()).filter(Boolean);
    const title = t ? (t.getAttribute('title') || t.textContent).trim() : (lines[0] || '');
    if (!title || title.length < 3) continue;
    seen.add(m[1]);
    const img = a.querySelector('.thumbnail-container img, img');
    const subsLine = lines.find(l => /\\bsubs\\b|subscribers/i.test(l)) || '';
    const payLine = lines.find(l => /\\$|per project|per month|per hour|full-time|part-time|per video/i.test(l)) || '';
    out.push({
      id: m[1], title,
      pay: q('.card-job-type') || payLine,
      location: q('.card-job-location') || (lines.find(l => /remote|hybrid|on-?site/i.test(l)) || ''),
      channel: q('.thumbnail-container .name') || (img && img.alt) || '',
      subs: q('.thumbnail-container .subscribers') || subsLine,
      avatar: img ? img.src : '',
      more: q('.styles-categories')
    });
  }
  return out;
})()`;
function ytPick(obj, rx) { for (const k of Object.keys(obj)) if (rx.test(k) && obj[k] != null && obj[k] !== '') return obj[k]; return undefined; }
function ytNames(v) {
  if (!Array.isArray(v)) return [];
  return v.map(x => typeof x === 'string' ? x : (x && (x.name || x.title || x.label || x.value)) || '').filter(s => typeof s === 'string' && s).slice(0, 12);
}
// procura no JSON da API objetos com o mesmo id dos cards e tira data, descrição e categorias
function ytEnrich(json, byId, depth) {
  if (!json || typeof json !== 'object' || depth > 12) return;
  if (Array.isArray(json)) { for (const x of json) ytEnrich(x, byId, depth + 1); return; }
  const id = json.id != null ? String(json.id) : '';
  if (id && byId.has(id)) {
    const job = byId.get(id);
    let d = ytPick(json, /^(published_at|publishedAt|posted_at|postedAt|created_at|createdAt|approved_at|approvedAt|date)$/);
    if (d == null) d = ytPick(json, /(publish|posted|creat|approv|date|_at$|At$)/i);
    let ts = typeof d === 'number' ? (d < 1e12 ? d * 1000 : d) : d ? Date.parse(d) : NaN;
    if (!(ts > Date.parse('2020-01-01'))) ts = NaN;
    if (Number.isFinite(ts) && ts <= Date.now() + 864e5) job.created = ts;
    const desc = ytPick(json, /^(description|desc|body|content|about)$/i);
    if (typeof desc === 'string') job.desc = desc.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
    const tags = [];
    for (const k of Object.keys(json)) if (/categor|style|format|skill|role|type/i.test(k)) tags.push(...ytNames(json[k]));
    if (tags.length) job.tags = [...new Set(tags)].slice(0, 15);
  }
  for (const k of Object.keys(json)) if (json[k] && typeof json[k] === 'object') ytEnrich(json[k], byId, depth + 1);
}
ipcMain.handle('jotas-brain:ytjobs-collect', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'forbidden' };
  if (ytBusy) return { ok: false, error: 'busy' };
  ytBusy = true;
  const pages = Math.max(1, Math.min(4, Number(data && data.pages) || 1));
  const bodies = []; let pending = 0; let wc = null; let onMessage = null;
  try {
    const win = ytWindow(); wc = win.webContents; const dbg = wc.debugger;
    if (!wc.getURL()) await withTimeout(wc.loadURL('about:blank'), 10000, 'blank');
    if (!dbg.isAttached()) dbg.attach('1.3');
    await withTimeout(dbg.sendCommand('Network.enable'), 10000, 'network');
    const watched = new Set();
    onMessage = (_e, method, params) => {
      if (method === 'Network.responseReceived' && /ytjobs\.co\/api\/.*jobs/i.test(params.response.url)) watched.add(params.requestId);
      else if (method === 'Network.loadingFinished' && watched.has(params.requestId)) {
        watched.delete(params.requestId); pending++;
        withTimeout(dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId }), 8000, 'body')
          .then(r => { try { bodies.push(JSON.parse(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body)); } catch (_) {} })
          .catch(() => {}).finally(() => { pending--; });
      }
    };
    dbg.on('message', onMessage);
    await withTimeout(wc.loadURL('https://ytjobs.co/job/search'), 30000, 'load').catch(() => {});
    const count = () => withTimeout(wc.executeJavaScript('[...document.querySelectorAll(\'a[href*="/job/"]\')].filter(a => /\\/job\\/\\d+/.test(a.getAttribute(\'href\') || \'\')).length', true), 5000, 'count').catch(() => 0);
    let n = 0; const t0 = Date.now();
    while (Date.now() - t0 < 20000) { n = await count(); if (n > 0) break; await wait(400); }
    for (let i = 1; i < pages && n > 0; i++) {
      const clicked = await withTimeout(wc.executeJavaScript(`(() => { const b = [...document.querySelectorAll('button, a, div, span')].filter(e => /^\\s*load more\\s*$/i.test(e.textContent || '')).pop(); if (!b) return false; b.scrollIntoView(); b.click(); return true; })()`, true), 5000, 'more').catch(() => false);
      if (!clicked) break;
      const before = n; const t1 = Date.now();
      while (Date.now() - t1 < 8000) { await wait(400); n = await count(); if (n > before) break; }
      if (n <= before) break;
      await wait(700 + Math.random() * 900);
    }
    const t2 = Date.now(); while (pending > 0 && Date.now() - t2 < 3000) await wait(100);
    const cards = await withTimeout(wc.executeJavaScript(YT_EXTRACT, true), 8000, 'extract').catch(() => []);
    const jobs = (Array.isArray(cards) ? cards : []).slice(0, 120);
    const byId = new Map(jobs.map(j => [String(j.id), j]));
    for (const b of bodies) ytEnrich(b, byId, 0);
    const sample = bodies[0] && typeof bodies[0] === 'object' ? Object.keys(bodies[0]).slice(0, 10) : [];
    return { ok: jobs.length > 0, jobs, diag: { at: wc.getURL().slice(0, 80), cards: jobs.length, api: bodies.length, apiKeys: sample, dated: jobs.filter(j => j.created).length } };
  } catch (error) {
    ytCloseCollector();
    return { ok: false, jobs: [], error: String(error && error.message || error).slice(0, 200) };
  } finally {
    if (wc && onMessage && !wc.isDestroyed()) wc.debugger.removeListener('message', onMessage);
    if (wc && !wc.isDestroyed()) withTimeout(wc.loadURL('about:blank'), 10000, 'blank').catch(() => {});
    ytBusy = false;
  }
});
// Descrição completa de uma vaga (abre a página dela escondido, só quando a pessoa clica)
ipcMain.handle('jotas-brain:ytjobs-detail', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  const id = String(data && data.id || '');
  if (!/^\d{1,9}$/.test(id)) return { ok: false };
  if (ytBusy) return { ok: false, error: 'busy' };
  ytBusy = true;
  try {
    const wc = ytWindow().webContents;
    await withTimeout(wc.loadURL('https://ytjobs.co/job/' + id), 30000, 'load').catch(() => {});
    let text = ''; const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      text = String(await withTimeout(wc.executeJavaScript('(document.querySelector("main")||document.body).innerText', true), 5000, 'text').catch(() => '') || '');
      if (/Posted on:|Job Type|Salary/i.test(text)) break;
      await wait(500);
    }
    const posted = (text.match(/Posted on:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/) || [])[1] || '';
    const cut = text.search(/\n(?:Skills and Expertise|Hire a |More .* jobs|Apply\nPosted by)/);
    return { ok: !!text, text: (cut > 0 ? text.slice(0, cut) : text).slice(0, 6000), posted: posted ? Date.parse(posted) || 0 : 0 };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error).slice(0, 120) };
  } finally {
    const wc = ytCollector && !ytCollector.isDestroyed() ? ytCollector.webContents : null;
    if (wc) withTimeout(wc.loadURL('about:blank'), 10000, 'blank').catch(() => {});
    ytBusy = false;
  }
});

ipcMain.handle('jotas-brain:x-collect', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false, error: 'forbidden' };
  const query = data && typeof data.query === 'string' ? data.query.trim().slice(0, 900) : '';
  if (!query) return { ok: false, error: 'empty' };
  if (xCollectBusy) return { ok: false, error: 'busy' };
  if (!(await xLoggedIn())) return { ok: false, needLogin: true };
  const scrolls = Math.max(0, Math.min(4, Number(data.scrolls) || 0));
  const mode = data.mode === 'top' ? 'top' : 'live';
  const url = 'https://x.com/search?q=' + encodeURIComponent(query) + '&src=typed_query&f=' + mode;
  xCollectBusy = true;
  const tweets = new Map();
  let responses = 0; let status = 0; let pendingBodies = 0;
  const watched = new Set();
  const ops = new Set(); // nomes das chamadas que o X fez (para o diagnóstico)
  let apiErrors = '';
  let wc = null; let onMessage = null;
  try {
    const win = xCollectorWindow();
    wc = win.webContents;
    const dbg = wc.debugger;
    // o depurador só responde depois que a janela tem uma página carregada
    if (!wc.getURL()) await withTimeout(wc.loadURL('about:blank'), 10000, 'blank');
    if (!dbg.isAttached()) dbg.attach('1.3');
    await withTimeout(dbg.sendCommand('Network.enable', { maxResourceBufferSize: 20e6, maxTotalBufferSize: 60e6 }), 10000, 'network');
    onMessage = (_e, method, params) => {
      if (method === 'Network.responseReceived') {
        const u = params.response.url;
        const op = (u.match(/\/i\/api\/(?:graphql\/[^/]+\/)?([A-Za-z0-9_./]+)/) || [])[1];
        if (op && ops.size < 25) ops.add(op.slice(0, 40) + ':' + params.response.status);
        if (/\/i\/api\/(graphql\/[^/]+\/\w*Search\w*|2\/search\/)/.test(u)) {
          watched.add(params.requestId); status = params.response.status;
        }
      } else if (method === 'Network.loadingFinished' && watched.has(params.requestId)) {
        watched.delete(params.requestId); pendingBodies++;
        withTimeout(dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId }), 8000, 'body').then(r => {
          const body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
          try {
            const json = JSON.parse(body);
            if (json && Array.isArray(json.errors) && json.errors.length) apiErrors = json.errors.map(e => e && (e.code + ' ' + e.message)).join('; ').slice(0, 200);
            xExtractTweets(json, tweets, 0); responses++;
          } catch (_) {}
        }).catch(() => {}).finally(() => { pendingBodies--; });
      }
    };
    dbg.on('message', onMessage);
    await withTimeout(wc.loadURL(url), 30000, 'load').catch(() => {});
    // espera a primeira página de resultados (ou o X mandar para o login)
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (responses > 0 || status === 429) break;
      if (/\/(i\/flow\/login|login|account\/access)/.test(wc.getURL())) break;
      await wait(250);
    }
    for (let i = 0; i < scrolls && responses > 0 && status !== 429; i++) {
      const before = responses;
      await withTimeout(wc.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight); 1', true), 5000, 'scroll').catch(() => {});
      const t1 = Date.now();
      while (Date.now() - t1 < 4000 && responses === before) await wait(250);
      await wait(600 + Math.random() * 900);
    }
    const t2 = Date.now();
    while (pendingBodies > 0 && Date.now() - t2 < 3000) await wait(100);
    const at = wc.getURL();
    const needLogin = /\/(i\/flow\/login|login)/.test(at) || !(await xLoggedIn());
    const locked = /account\/access/.test(at);
    let pageText = '';
    try { pageText = String(await withTimeout(wc.executeJavaScript('(document.body&&document.body.innerText||"").slice(0,300)', true), 4000, 'text')); } catch (_) {}
    const diag = {
      at: at.replace(/\?.*$/, '').slice(0, 80), status, responses, tweets: tweets.size,
      ops: [...ops].slice(0, 12), apiErrors, page: pageText.replace(/\s+/g, ' ').trim().slice(0, 200),
      chrome: process.versions.chrome, electron: process.versions.electron
    };
    return { ok: responses > 0, tweets: [...tweets.values()], needLogin, locked, rateLimited: status === 429, status, diag };
  } catch (error) {
    xCloseCollector(); // recomeça do zero na próxima busca
    const msg = String(error && error.message || error).slice(0, 200);
    return { ok: false, error: msg, tweets: [...tweets.values()], diag: { error: msg, ops: [...ops].slice(0, 12), chrome: process.versions.chrome, electron: process.versions.electron } };
  } finally {
    if (wc && onMessage && !wc.isDestroyed()) wc.debugger.removeListener('message', onMessage);
    if (wc && !wc.isDestroyed()) withTimeout(wc.loadURL('about:blank'), 10000, 'blank').catch(() => {});
    xCollectBusy = false;
  }
});

// ── IA alternativa: Groq (grátis com chave, compatível com a API da OpenAI) ──
ipcMain.handle('jotas-brain:ai-groq', async (event, data) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { status: 0, json: null };
  const key = data && typeof data.key === 'string' ? data.key.trim() : '';
  const body = data && data.body && typeof data.body === 'object' ? data.body : null;
  if (!key || !body) return { status: 0, json: null };
  try {
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 45000);
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    clearTimeout(tm);
    let json = null; try { json = await r.json(); } catch (_) {}
    return { status: r.status, json };
  } catch (_) { return { status: 0, json: null, net: true }; }
});

app.whenReady().then(() => {
  // Avisa a página quando a pessoa entra ou sai da conta do X.
  // (o X às vezes troca o cookie — remove e cria de novo —, então esperamos
  // um instante e conferimos o estado real antes de avisar)
  let xAuthTimer = null;
  try {
    session.fromPartition(X_PARTITION).cookies.on('changed', (_e, cookie) => {
      if (!cookie || cookie.name !== 'auth_token') return;
      clearTimeout(xAuthTimer);
      xAuthTimer = setTimeout(async () => {
        const loggedIn = await xLoggedIn();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('jotas-brain:x-auth', { loggedIn });
      }, 700);
    });
  } catch (_) {}
  // O X às vezes trata navegadores "Electron" de forma diferente; o painel se
  // apresenta como o Chrome em que ele é baseado.
  try {
    const os = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
    session.fromPartition(X_PARTITION).setUserAgent(`Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`);
  } catch (_) {}
  presenceConfig = loadPresenceConfig();
  createWindow();
  connectDiscord();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', stopDiscordPresence);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});




