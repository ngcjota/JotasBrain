const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jotasBrain', {
  // Aba Vagas: login do X (<webview>) e coletor que roda escondido.
  canEmbedX: true,
  xStatus() { return ipcRenderer.invoke('jotas-brain:x-status'); },
  xLogout() { return ipcRenderer.invoke('jotas-brain:x-logout'); },
  xCollect(data) {
    return ipcRenderer.invoke('jotas-brain:x-collect', {
      query: data && typeof data.query === 'string' ? data.query.slice(0, 900) : '',
      mode: data && data.mode === 'top' ? 'top' : 'live',
      scrolls: data && Number.isInteger(data.scrolls) ? data.scrolls : 0
    });
  },
  xSetToken(token) { return ipcRenderer.invoke('jotas-brain:x-set-token', { token: typeof token === 'string' ? token.slice(0, 200) : '' }); },
  // IA alternativa (Groq): a chamada sai pelo processo principal
  aiGroq(data) {
    return ipcRenderer.invoke('jotas-brain:ai-groq', {
      key: data && typeof data.key === 'string' ? data.key.slice(0, 200) : '',
      body: data && data.body && typeof data.body === 'object' ? JSON.parse(JSON.stringify(data.body)) : null
    });
  },
  // YTJobs: lista pública de vagas (sem login)
  ytjobsCollect(data) { return ipcRenderer.invoke('jotas-brain:ytjobs-collect', { pages: data && Number.isInteger(data.pages) ? data.pages : 1 }); },
  ytjobsDetail(id) { return ipcRenderer.invoke('jotas-brain:ytjobs-detail', { id: String(id || '').slice(0, 12) }); },
  // Reddit: conta oficial (OAuth) ou feed público. Tokens nunca passam por aqui.
  redditStatus() { return ipcRenderer.invoke('jotas-brain:reddit-status'); },
  redditConnect(data) { return ipcRenderer.invoke('jotas-brain:reddit-connect', { clientId: data && typeof data.clientId === 'string' ? data.clientId.slice(0, 60) : '' }); },
  redditDisconnect() { return ipcRenderer.invoke('jotas-brain:reddit-disconnect'); },
  redditCollect(data) { return ipcRenderer.invoke('jotas-brain:reddit-collect', { rss: !!(data && data.rss) }); },
  // Segundo plano: iniciar com o Windows, bandeja e notificações
  bgGet() { return ipcRenderer.invoke('jotas-brain:bg-get'); },
  bgSet(data) {
    const d = {};
    if (data && typeof data.openAtLogin === 'boolean') d.openAtLogin = data.openAtLogin;
    if (data && typeof data.keepInTray === 'boolean') d.keepInTray = data.keepInTray;
    return ipcRenderer.invoke('jotas-brain:bg-set', d);
  },
  notify(data) {
    return ipcRenderer.invoke('jotas-brain:notify', {
      title: data && typeof data.title === 'string' ? data.title.slice(0, 120) : '',
      body: data && typeof data.body === 'string' ? data.body.slice(0, 300) : '',
      jobId: data && typeof data.jobId === 'string' ? data.jobId.slice(0, 40) : '',
      silent: !!(data && data.silent)
    });
  },
  onOpenJob(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, d) => callback({ id: d && typeof d.id === 'string' ? d.id.slice(0, 40) : '' });
    ipcRenderer.on('jotas-brain:open-job', handler);
    return () => ipcRenderer.removeListener('jotas-brain:open-job', handler);
  },
  onTrayCollect(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    ipcRenderer.on('jotas-brain:tray-collect', handler);
    return () => ipcRenderer.removeListener('jotas-brain:tray-collect', handler);
  },
  onXAuth(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, d) => callback({ loggedIn: !!(d && d.loggedIn) });
    ipcRenderer.on('jotas-brain:x-auth', handler);
    return () => ipcRenderer.removeListener('jotas-brain:x-auth', handler);
  },
  updatePresence(data) {
    if (!data || typeof data !== 'object') return;
    ipcRenderer.send('jotas-brain:update-presence', {
      viewName: typeof data.viewName === 'string' ? data.viewName.slice(0, 80) : '',
      leadCount: Number.isSafeInteger(data.leadCount) && data.leadCount >= 0 ? data.leadCount : 0,
      language: data.language === 'en-US' ? 'en-US' : 'pt-BR'
    });
  },
  // Gera o PDF do invoice no processo principal e abre "Salvar como".
  saveInvoicePdf(data) {
    return ipcRenderer.invoke('jotas-brain:save-invoice-pdf', {
      html: data && typeof data.html === 'string' ? data.html : '',
      fileName: data && typeof data.fileName === 'string' ? data.fileName.slice(0, 160) : 'invoice',
      dialogTitle: data && typeof data.dialogTitle === 'string' ? data.dialogTitle.slice(0, 100) : '',
      dir: data && typeof data.dir === 'string' ? data.dir.slice(0, 1000) : ''
    });
  },
  // Abre o PDF salvo (reveal: true mostra o arquivo selecionado na pasta).
  openInvoiceFile(data) {
    return ipcRenderer.invoke('jotas-brain:open-invoice-file', {
      path: data && typeof data.path === 'string' ? data.path.slice(0, 1000) : '',
      reveal: !!(data && data.reveal)
    });
  },
  // Abre a pasta dos PDFs de invoice.
  openInvoiceFolder(data) {
    return ipcRenderer.invoke('jotas-brain:open-invoice-folder', {
      dir: data && typeof data.dir === 'string' ? data.dir.slice(0, 1000) : ''
    });
  }
});
