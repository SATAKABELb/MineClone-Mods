// ============================================================
//  LAN P2P v4.0 — WebRTC без сервера
//  Работает через Radmin VPN (и даже без интернета)
//
//  Как подключиться:
//   1. Хост: Esc → 🌐 Открыть мир для сети → "Создать приглашение"
//      → копирует КОД 1 → шлёт другу (Telegram/WhatsApp)
//   2. Друг: 🌐 Сетевая игра → "Присоединиться" → вставляет КОД 1
//      → копирует КОД 2 → шлёт хосту
//   3. Хост: вставляет КОД 2 → "Принять"
//   ✓ Готово — соединение установлено, играем!
// ============================================================

(function () {
  if (window.__lanP2P) { mc.chat('LAN P2P уже активен'); return; }
  window.__lanP2P = { version: '4.0' };

  const MY_ID = 'p_' + Math.random().toString(36).slice(2, 8);
  let MY_NAME = localStorage.getItem('mc_lan_name') || '';
  if (!MY_NAME) {
    MY_NAME = prompt('Ваше имя:', 'Player' + Math.floor(Math.random() * 1000)) || 'Player';
    localStorage.setItem('mc_lan_name', MY_NAME);
  }

  let pc = null;
  let dc = null;
  let isHost = false;
  let connected = false;
  let myWorldOpen = false;
  let applyingRemote = false;
  const pendingBlocks = [];
  const peers = new Map();
  const remoteWorlds = new Map();

  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ',70%,55%)';
  }

  // ===== КОДИРОВАНИЕ =====
  function packSDP(sdp) {
    // Сжимаем: убираем лишние строки
    const lines = sdp.split('\r\n').filter(l => l &&
      !l.startsWith('a=extmap') &&
      !l.startsWith('a=rtcp-fb') &&
      !l.startsWith('a=fmtp') &&
      !l.startsWith('a=rtpmap') &&
      !l.startsWith('m=application') === false  // оставляем m=application
    );
    // Проще: используем весь SDP — всё равно ~1.5 КБ в base64
    return btoa(sdp).replace(/=+$/, '');
  }
  function unpackSDP(b64) {
    // Восстанавливаем padding
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return atob(b64 + pad);
  }

  // ===== WEBRTC =====
  function newPC() {
    // Без STUN — работает через Radmin VPN (host candidates)
    return new RTCPeerConnection({ iceServers: [] });
  }

  function waitIceGathered(p) {
    return new Promise(resolve => {
      if (p.iceGatheringState === 'complete') return resolve();
      const t = setTimeout(resolve, 5000);  // таймаут
      p.addEventListener('icegatheringstatechange', () => {
        if (p.iceGatheringState === 'complete') {
          clearTimeout(t);
          resolve();
        }
      });
    });
  }

  function wireDC(channel) {
    dc = channel;
    dc.onopen = () => {
      connected = true;
      mc.chat('§a✓ Соединение установлено!');
      send({ type: 'hello', name: MY_NAME });
      send({ type: 'queryWorlds' });
      updateConnUI();
    };
    dc.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.from === MY_ID) return;
      handleMessage(msg.from, msg);
    };
    dc.onclose = () => {
      connected = false;
      mc.chat('§c✗ Соединение закрыто');
      updateConnUI();
    };
    dc.onerror = () => {};
  }

  function send(msg) {
    msg.from = MY_ID;
    if (msg.type === 'hello' && mc.world) msg.seed = mc.world.seed;
    if (dc && dc.readyState === 'open') {
      try { dc.send(JSON.stringify(msg)); } catch (e) {}
    }
  }

  // Хост: создаёт offer + ждёт answer
  async function hostCreateInvite() {
    if (pc) pc.close();
    pc = newPC();
    isHost = true;
    const channel = pc.createDataChannel('game', { ordered: true });
    wireDC(channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGathered(pc);
    return packSDP(pc.localDescription.sdp);
  }

  async function hostAcceptAnswer(code) {
    if (!pc) throw new Error('Сначала создайте приглашение');
    const sdp = unpackSDP(code);
    if (!sdp.includes('v=0')) throw new Error('Неверный код');
    await pc.setRemoteDescription({ type: 'answer', sdp });
  }

  // Клиент: принимает offer, отдаёт answer
  async function clientAcceptOffer(code) {
    if (pc) pc.close();
    pc = newPC();
    isHost = false;
    pc.ondatachannel = e => wireDC(e.channel);
    const sdp = unpackSDP(code);
    if (!sdp.includes('v=0')) throw new Error('Неверный код');
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceGathered(pc);
    return packSDP(pc.localDescription.sdp);
  }

  // ===== ОБРАБОТКА =====
  function handleMessage(from, msg) {
    if (msg.type === 'hello') {
      if (!peers.has(from)) {
        peers.set(from, {
          id: from, name: msg.name || 'Unknown',
          pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
          lastSeen: Date.now(), color: colorFor(from)
        });
        mc.chat('§a' + (msg.name || 'Unknown') + ' в сети');
        if (networkScreen) renderNetworkScreen();
      }
    } else if (msg.type === 'pos') {
      const p = peers.get(from);
      if (p) { p.pos = msg.pos; p.yaw = msg.yaw; p.pitch = msg.pitch; p.lastSeen = Date.now(); }
    } else if (msg.type === 'block') {
      if (!mc.world) return;
      const c = mc.world.getChunk(msg.x >> 4, msg.z >> 4);
      if (!c) { pendingBlocks.push(msg); return; }
      if (mc.getBlock(msg.x, msg.y, msg.z) !== msg.id) {
        applyingRemote = true;
        mc.world.setBlock(msg.x, msg.y, msg.z, msg.id);
        applyingRemote = false;
      }
    } else if (msg.type === 'chat') {
      mc.chat('§b' + (msg.name || '?') + '§r: ' + msg.text);
    } else if (msg.type === 'worldOpen') {
      remoteWorlds.set(from, {
        hostId: from, hostName: msg.hostName,
        name: msg.name, seed: msg.seed,
        gameMode: msg.gameMode, playerCount: msg.playerCount || 1,
        lastUpdate: Date.now()
      });
      if (networkScreen) renderNetworkScreen();
    } else if (msg.type === 'worldClose') {
      remoteWorlds.delete(from);
      if (networkScreen) renderNetworkScreen();
    } else if (msg.type === 'queryWorlds') {
      if (myWorldOpen) sendWorldStatus();
    } else if (msg.type === 'requestSync') {
      if (myWorldOpen) sendDiffs();
    } else if (msg.type === 'syncChunk') {
      if (!mc.world) return;
      for (const [x, y, z, id] of msg.blocks) {
        const c = mc.world.getChunk(x >> 4, z >> 4);
        if (!c) { pendingBlocks.push({ x, y, z, id }); continue; }
        applyingRemote = true;
        mc.world.setBlock(x, y, z, id);
        applyingRemote = false;
      }
    } else if (msg.type === 'syncDone') {
      mc.chat('§aСинхронизация завершена');
    }
  }

  function sendWorldStatus() {
    if (!mc.world) return;
    send({
      type: 'worldOpen', hostName: MY_NAME,
      name: mc.world.name || 'World', seed: mc.world.seed,
      gameMode: mc.player.gameMode, playerCount: peers.size + 1
    });
  }
  function sendDiffs() {
    if (!mc.world || !mc.world.diffs) return;
    const all = [];
    for (const [chunkKey, cm] of mc.world.diffs) {
      const p = chunkKey.split(',');
      const cx = +p[0], cz = +p[1];
      for (const [idx, id] of cm) {
        const y = (idx >> 8), lz = ((idx >> 4) & 15), lx = (idx & 15);
        all.push([cx * 16 + lx, y, cz * 16 + lz, id]);
      }
    }
    for (let i = 0; i < all.length; i += 500) {
      send({ type: 'syncChunk', blocks: all.slice(i, i + 500) });
    }
    send({ type: 'syncDone' });
  }

  function openWorld() {
    if (!mc.world) { mc.chat('§cСначала загрузите мир'); return; }
    if (!connected) { mc.chat('§cНет соединения'); return; }
    myWorldOpen = true;
    sendWorldStatus();
    mc.chat('§a🌐 Мир открыт для сети');
  }
  function closeWorld() {
    myWorldOpen = false;
    send({ type: 'worldClose' });
    mc.chat('§e🔒 Мир закрыт');
  }

  // ===== ТИКИ =====
  setInterval(() => {
    if (!connected || !myWorldOpen) return;
    sendWorldStatus();
  }, 2000);
  setInterval(() => {
    if (!connected || !mc.player || !mc.world) return;
    send({
      type: 'pos',
      pos: { x: mc.player.pos.x, y: mc.player.pos.y, z: mc.player.pos.z },
      yaw: mc.player.yaw, pitch: mc.player.pitch
    });
  }, 120);
  setInterval(() => {
    if (!mc.world) return;
    for (let i = pendingBlocks.length - 1; i >= 0; i--) {
      const b = pendingBlocks[i];
      const c = mc.world.getChunk(b.x >> 4, b.z >> 4);
      if (!c) continue;
      applyingRemote = true;
      mc.world.setBlock(b.x, b.y, b.z, b.id);
      applyingRemote = false;
      pendingBlocks.splice(i, 1);
    }
  }, 2000);

  // ===== ХУК =====
  const hooked = new WeakSet();
  function hookWorld() {
    if (!mc.world || hooked.has(mc.world)) return;
    const w = mc.world;
    hooked.add(w);
    const orig = w.setBlock.bind(w);
    w.setBlock = function (x, y, z, id) {
      orig(x, y, z, id);
      if (!applyingRemote && connected) send({ type: 'block', x, y, z, id });
    };
  }
  setInterval(hookWorld, 1000);
  hookWorld();

  // ===== ЧАТ =====
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.code !== 'Enter') return;
      const txt = chatInput.value.trim();
      if (txt && !txt.startsWith('/') && connected) send({ type: 'chat', name: MY_NAME, text: txt });
    }, true);
  }

  // ===== UI КНОПКИ =====
  function injectMainMenuButton() {
    const box = document.querySelector('#mainMenu .box');
    if (!box || document.getElementById('btnLanMenu')) return;
    const btn = document.createElement('button');
    btn.id = 'btnLanMenu';
    btn.className = 'menu-btn blue';
    btn.textContent = '🌐 Сетевая игра';
    btn.addEventListener('click', () => { clickSound(); showNetworkScreen('main'); });
    const single = document.getElementById('btnSingle');
    if (single && single.nextSibling) box.insertBefore(btn, single.nextSibling);
    else box.appendChild(btn);
  }
  function injectPauseButton() {
    const box = document.querySelector('#pauseMenu .box');
    if (!box) return;
    if (document.getElementById('pauseLanBtn')) { updatePauseButton(); return; }
    const btn = document.createElement('button');
    btn.id = 'pauseLanBtn';
    btn.className = 'menu-btn';
    btn.addEventListener('click', () => {
      clickSound();
      if (myWorldOpen) { closeWorld(); updatePauseButton(); }
      else showNetworkScreen('pause');
    });
    const settings = document.getElementById('pauseSettings');
    if (settings) box.insertBefore(btn, settings);
    else box.appendChild(btn);
    updatePauseButton();
  }
  function updatePauseButton() {
    const btn = document.getElementById('pauseLanBtn');
    if (!btn) return;
    if (myWorldOpen) {
      btn.textContent = '🔒 Закрыть мир для сети';
      btn.style.background = '#a83a3a'; btn.style.borderColor = '#6b2020';
    } else {
      btn.textContent = '🌐 Открыть мир для сети';
      btn.style.background = '#3a6ea8'; btn.style.borderColor = '#204a6b';
    }
  }

  // ===== ЭКРАН СЕТИ =====
  let networkScreen = null;
  let networkFrom = 'main';
  let flowState = { type: null, code: null };

  function showNetworkScreen(from) {
    networkFrom = from;
    if (networkScreen) networkScreen.remove();
    const mm = document.getElementById('mainMenu');
    const pm = document.getElementById('pauseMenu');
    if (mm) mm.classList.add('hidden');
    if (pm) pm.classList.add('hidden');

    networkScreen = document.createElement('div');
    networkScreen.id = 'lanNetworkScreen';
    networkScreen.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:30;display:flex;flex-direction:column;align-items:center;padding:20px 0;font-family:"Courier New",monospace;overflow-y:auto';
    networkScreen.innerHTML = `
      <h2 style="color:#fff;font-size:26px;letter-spacing:3px;text-shadow:3px 3px 0 #000;margin-top:10px;margin-bottom:16px">СЕТЕВАЯ ИГРА</h2>
      <div style="width:min(700px,90vw);padding:14px;background:rgba(40,40,50,.9);border:2px solid ${connected ? '#4a8f2a' : '#a83a3a'};border-radius:6px;margin-bottom:16px">
        <div style="color:${connected ? '#8fdc5a' : '#ff8888'};font-size:13px;font-weight:bold;margin-bottom:8px">
          ${connected ? '✓ Соединение установлено' : '✗ Нет соединения (P2P)'}
        </div>
        <div style="display:flex;gap:8px">
          <input id="lanName" type="text" value="${escapeHtml(MY_NAME)}" placeholder="Имя" style="flex:1;padding:8px;background:#111;color:#8fdc5a;border:1px solid #555;font-family:inherit;font-size:12px;border-radius:3px">
          <button id="lanSaveName" style="padding:8px 16px;background:#555;border:2px solid #333;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:12px">Сохранить</button>
        </div>
      </div>
      ${!connected ? `
      <div style="width:min(700px,90vw);display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
        <button id="lanHostBtn" style="padding:14px;background:#4a8f2a;border:2px solid #2d5c17;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:bold;letter-spacing:1px">🎮 Создать комнату</button>
        <button id="lanJoinBtn" style="padding:14px;background:#3a6ea8;border:2px solid #204a6b;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:bold;letter-spacing:1px">🔗 Присоединиться</button>
      </div>
      <div id="lanFlowBox" style="width:min(700px,90vw);padding:14px;background:rgba(40,40,50,.9);border:2px solid #555;border-radius:6px;margin-bottom:16px;display:none">
        <div id="lanFlowTitle" style="color:#ffd45e;font-size:13px;font-weight:bold;margin-bottom:8px"></div>
        <textarea id="lanFlowCode" style="width:100%;height:120px;background:#111;color:#8fdc5a;border:1px solid #555;font-size:10px;padding:6px;font-family:monospace;resize:none;margin-bottom:8px" spellcheck="false" readonly></textarea>
        <div style="display:flex;gap:6px">
          <button id="lanFlowCopy" style="flex:1;padding:10px;background:#3a6ea8;border:2px solid #204a6b;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px">📋 Копировать</button>
          <button id="lanFlowNext" style="flex:1;padding:10px;background:#4a8f2a;border:2px solid #2d5c17;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;display:none">→ Далее</button>
          <button id="lanFlowCancel" style="flex:1;padding:10px;background:#a83a3a;border:2px solid #6b2020;color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px">✕ Отмена</button>
        </div>
      </div>` : ''}
      ${mc.world ? `
      <div style="width:min(700px,90vw);padding:14px;background:rgba(40,40,50,.9);border:2px solid ${myWorldOpen ? '#4a8f2a' : '#555'};border-radius:6px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
          <div>
            <div style="color:#8fdc5a;font-size:14px;font-weight:bold;margin-bottom:2px">Мой мир: ${escapeHtml(mc.world.name || 'World')}</div>
            <div style="color:#888;font-size:11px">Сид: ${mc.world.seed} · Игроков: ${peers.size} · ${myWorldOpen ? '🌐 Открыт' : '🔒 Закрыт'}</div>
          </div>
          <button id="lanToggleWorld" style="padding:10px 18px;background:${myWorldOpen ? '#a83a3a' : '#4a8f2a'};border:2px solid ${myWorldOpen ? '#6b2020' : '#2d5c17'};color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;white-space:nowrap">
            ${myWorldOpen ? '🔒 Закрыть' : '🌐 Открыть мир'}
          </button>
        </div>
      </div>` : ''}
      ${connected ? `
      <h3 style="color:#ffd45e;font-size:14px;letter-spacing:2px;margin-bottom:10px;width:min(700px,90vw);text-align:left">Миры в сети:</h3>
      <div id="lanWorldList" style="width:min(700px,90vw);flex:1;overflow-y:auto;max-height:calc(100vh - 500px);padding:0 8px;margin-bottom:20px;min-height:120px"></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:min(700px,90vw);padding:0 8px">
        <button id="lanRefreshBtn" style="padding:14px;font-size:15px;font-family:inherit;letter-spacing:1px;background:#777;border:2px solid #444;color:#fff;border-radius:3px;cursor:pointer">🔄 Обновить</button>
        <button id="lanCloseBtn" style="padding:14px;font-size:15px;font-family:inherit;letter-spacing:1px;background:#555;border:2px solid #333;color:#fff;border-radius:3px;cursor:pointer">← Назад</button>
      </div>
      <div style="margin-top:12px;font-size:11px;color:#666;max-width:700px;text-align:center;padding:0 8px;line-height:1.6">
        Имя: <span style="color:#8fdc5a">${escapeHtml(MY_NAME)}</span> · Игроков: <span style="color:#8fdc5a">${peers.size}</span>
      </div>
    `;
    document.body.appendChild(networkScreen);

    document.getElementById('lanSaveName').onclick = () => {
      const n = document.getElementById('lanName').value.trim();
      if (n) { MY_NAME = n; localStorage.setItem('mc_lan_name', n); send({ type: 'hello', name: MY_NAME }); showNetworkScreen(networkFrom); }
    };
    const hostBtn = document.getElementById('lanHostBtn');
    if (hostBtn) hostBtn.onclick = startHostFlow;
    const joinBtn = document.getElementById('lanJoinBtn');
    if (joinBtn) joinBtn.onclick = startJoinFlow;
    const toggle = document.getElementById('lanToggleWorld');
    if (toggle) toggle.onclick = () => {
      if (myWorldOpen) closeWorld(); else openWorld();
      updatePauseButton();
      showNetworkScreen(networkFrom);
    };
    document.getElementById('lanRefreshBtn').onclick = () => {
      send({ type: 'queryWorlds' });
      renderNetworkScreen();
    };
    document.getElementById('lanCloseBtn').onclick = () => {
      networkScreen.remove(); networkScreen = null;
      if (networkFrom === 'main' && mm) mm.classList.remove('hidden');
      if (networkFrom === 'pause' && pm) pm.classList.remove('hidden');
    };
    send({ type: 'queryWorlds' });
    renderNetworkScreen();
  }

  function renderNetworkScreen() {
    const list = document.getElementById('lanWorldList');
    if (!list) return;
    list.innerHTML = '';
    const now = Date.now();
    for (const [id, w] of Array.from(remoteWorlds)) {
      if (now - w.lastUpdate > 8000) remoteWorlds.delete(id);
    }
    if (remoteWorlds.size === 0) {
      list.innerHTML = '<div style="color:#888;text-align:center;padding:40px 20px;font-size:14px;font-style:italic">Нет открытых миров.<br><span style="font-size:11px;color:#666;margin-top:10px;display:block">Попросите хоста открыть: <b style="color:#8fdc5a">Esc → 🌐 Открыть мир</b></span></div>';
      return;
    }
    for (const [hostId, w] of remoteWorlds) {
      const seedMatch = mc.world && mc.world.seed === w.seed;
      const canJoin = seedMatch || !mc.world;
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(40,40,50,.9);border:2px solid ' + (canJoin ? '#4a8f2a' : '#777') + ';border-radius:6px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px';
      card.innerHTML = `
        <div style="flex:1">
          <div style="color:#8fdc5a;font-size:17px;font-weight:bold;margin-bottom:4px">${escapeHtml(w.name)}</div>
          <div style="color:#aaa;font-size:12px">Хост: <b>${escapeHtml(w.hostName)}</b> · Игроков: ${w.playerCount}</div>
          <div style="color:#666;font-size:11px">Режим: ${w.gameMode === 'creative' ? 'Творческий' : 'Выживание'} · Сид: ${w.seed}${seedMatch ? ' <span style="color:#4a8f2a">✓</span>' : ''}</div>
        </div>
        <button class="lanJoinWorld" data-host="${hostId}" data-seed="${w.seed}" style="padding:10px 20px;background:${canJoin ? '#4a8f2a' : '#555'};border:2px solid ${canJoin ? '#2d5c17' : '#333'};color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;white-space:nowrap">
          ${canJoin ? 'Присоединиться' : 'Сид не совпадает'}
        </button>
      `;
      list.appendChild(card);
    }
    list.querySelectorAll('.lanJoinWorld').forEach(btn => {
      btn.onclick = () => joinWorld(btn.dataset.host, +btn.dataset.seed);
    });
  }

  function joinWorld(hostId, seed) {
    if (!connected) { alert('Нет соединения'); return; }
    if (!mc.world) {
      localStorage.setItem('mc_lan_pendingJoin', JSON.stringify({ seed }));
      alert('Нужен мир с сидом ' + seed + '\n\nОдиночная игра → Создать мир → сид ' + seed);
      return;
    }
    if (mc.world.seed !== seed) { alert('Сид не совпадает. Ваш: ' + mc.world.seed + ', нужен: ' + seed); return; }
    send({ type: 'hello', name: MY_NAME });
    send({ type: 'requestSync' });
    mc.chat('§a🌐 Подключение...');
    if (networkScreen) { networkScreen.remove(); networkScreen = null; }
    const mm = document.getElementById('mainMenu');
    const pm = document.getElementById('pauseMenu');
    if (mm) mm.classList.add('hidden');
    if (pm) pm.classList.add('hidden');
    const c = document.querySelector('canvas');
    if (c) c.requestPointerLock();
  }

  // ===== FLOW: HOST =====
  async function startHostFlow() {
    const box = document.getElementById('lanFlowBox');
    const title = document.getElementById('lanFlowTitle');
    const code = document.getElementById('lanFlowCode');
    const copy = document.getElementById('lanFlowCopy');
    const next = document.getElementById('lanFlowNext');
    const cancel = document.getElementById('lanFlowCancel');
    box.style.display = 'block';
    title.textContent = '⏳ Генерация КОД 1 (2-4 сек)...';
    code.value = ''; next.style.display = 'none';
    try {
      const invite = await hostCreateInvite();
      code.value = invite;
      title.textContent = '① Скопируйте КОД 1 → отправьте другу → ждите от него КОД 2';
      next.style.display = '';
      next.textContent = '② Принять КОД 2';
      copy.onclick = () => {
        code.select(); code.setSelectionRange(0, 999999);
        try { document.execCommand('copy'); mc.chat('§aКОД 1 скопирован'); } catch (e) {}
      };
      next.onclick = async () => {
        code.value = ''; code.placeholder = 'Вставьте сюда КОД 2 от друга...'; code.readOnly = false;
        title.textContent = '② Вставьте КОД 2 в поле и нажмите "Готово"';
        next.textContent = '✓ Готово';
        next.onclick = async () => {
          const ans = code.value.trim();
          if (!ans) { alert('Вставьте КОД 2'); return; }
          title.textContent = '⏳ Установка соединения...';
          try {
            await hostAcceptAnswer(ans);
            box.style.display = 'none';
            mc.chat('§aОжидание P2P-соединения...');
          } catch (e) { title.textContent = 'Ошибка: ' + e.message; }
        };
      };
    } catch (e) { title.textContent = 'Ошибка: ' + e.message; }
    cancel.onclick = () => {
      if (pc) { pc.close(); pc = null; }
      box.style.display = 'none';
    };
  }

  // ===== FLOW: JOIN =====
  async function startJoinFlow() {
    const box = document.getElementById('lanFlowBox');
    const title = document.getElementById('lanFlowTitle');
    const code = document.getElementById('lanFlowCode');
    const copy = document.getElementById('lanFlowCopy');
    const next = document.getElementById('lanFlowNext');
    const cancel = document.getElementById('lanFlowCancel');
    box.style.display = 'block';
    title.textContent = '① Вставьте КОД 1 от хоста в поле ниже';
    code.value = ''; code.placeholder = 'Сюда вставьте КОД 1...'; code.readOnly = false;
    copy.style.display = 'none';
    next.style.display = '';
    next.textContent = '→ Сгенерировать КОД 2';
    next.onclick = async () => {
      const offer = code.value.trim();
      if (!offer) { alert('Вставьте КОД 1'); return; }
      title.textContent = '⏳ Генерация КОД 2 (2-4 сек)...';
      try {
        const answer = await clientAcceptOffer(offer);
        code.value = answer;
        code.readOnly = true;
        title.textContent = '② Скопируйте КОД 2 → отправьте хосту → ждите подключения';
        copy.style.display = '';
        copy.onclick = () => {
          code.select(); code.setSelectionRange(0, 999999);
          try { document.execCommand('copy'); mc.chat('§aКОД 2 скопирован'); } catch (e) {}
        };
        next.style.display = 'none';
      } catch (e) { title.textContent = 'Ошибка: ' + e.message; }
    };
    cancel.onclick = () => {
      if (pc) { pc.close(); pc = null; }
      box.style.display = 'none';
    };
  }

  function updateConnUI() {
    if (networkScreen) showNetworkScreen(networkFrom);
  }

  // ===== ОВЕРЛЕЙ =====
  const overlay = document.createElement('canvas');
  overlay.id = 'lanOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;';
  document.body.appendChild(overlay);
  overlay.width = innerWidth; overlay.height = innerHeight;
  window.addEventListener('resize', () => { overlay.width = innerWidth; overlay.height = innerHeight; });

  function project(pos, camPos, yaw, pitch, fov, aspect) {
    const dx = pos.x - camPos.x, dy = pos.y - (camPos.y + 1.62), dz = pos.z - camPos.z;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y2 = dy * cp + z1 * sp, z2 = -dy * sp + z1 * cp;
    const fwd = -z2;
    if (fwd <= 0.1) return null;
    const t = Math.tan(fov * Math.PI / 360);
    return { x: (x1 / (fwd * t * aspect) * 0.5 + 0.5) * overlay.width, y: (-y2 / (fwd * t) * 0.5 + 0.5) * overlay.height, fwd, scale: 1 / fwd };
  }
  function drawOverlay() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (mc.player && mc.world && mc.player.pos) {
      const aspect = overlay.width / overlay.height;
      const now = Date.now();
      for (const [id, p] of Array.from(peers)) {
        if (now - p.lastSeen > 6000) { peers.delete(id); continue; }
        const pr = project(p.pos, mc.player.pos, mc.player.yaw, mc.player.pitch, 72, aspect);
        if (!pr || pr.fwd > 70) continue;
        const size = Math.min(300, 900 * pr.scale);
        if (size < 3) continue;
        const headS = size * 0.55, bodyW = size * 0.9, bodyH = size * 1.5;
        ctx.fillStyle = p.color;
        ctx.fillRect(pr.x - bodyW / 2, pr.y + headS * 0.1, bodyW, bodyH);
        ctx.fillStyle = '#f0c090';
        ctx.fillRect(pr.x - headS / 2, pr.y - headS / 2, headS, headS);
        ctx.fillStyle = '#000';
        const es = Math.max(1, headS * 0.12);
        ctx.fillRect(pr.x - headS * 0.2, pr.y - headS * 0.05, es, es);
        ctx.fillRect(pr.x + headS * 0.08, pr.y - headS * 0.05, es, es);
        if (pr.fwd < 45) {
          const fs = Math.max(11, Math.min(20, size * 0.28));
          ctx.font = 'bold ' + fs + 'px monospace';
          ctx.textAlign = 'center';
          const nw = ctx.measureText(p.name).width;
          ctx.fillStyle = 'rgba(0,0,0,.7)';
          ctx.fillRect(pr.x - nw / 2 - 6, pr.y - headS / 2 - fs - 10, nw + 12, fs + 4);
          ctx.fillStyle = '#fff';
          ctx.fillText(p.name, pr.x, pr.y - headS / 2 - 6);
        }
      }
    }
    requestAnimationFrame(drawOverlay);
  }
  requestAnimationFrame(drawOverlay);

  function clickSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 500;
      g.gain.setValueAtTime(0.05, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.06);
    } catch (e) {}
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  window.addEventListener('beforeunload', () => {
    if (myWorldOpen) send({ type: 'worldClose' });
    if (dc) dc.close();
  });

  // ===== AUTO-JOIN после создания мира =====
  setInterval(() => {
    if (!mc.world || !connected) return;
    const p = localStorage.getItem('mc_lan_pendingJoin');
    if (!p) return;
    try {
      const d = JSON.parse(p);
      if (mc.world.seed === d.seed) {
        localStorage.removeItem('mc_lan_pendingJoin');
        send({ type: 'hello', name: MY_NAME });
        send({ type: 'requestSync' });
        mc.chat('§a🌐 Авто-подключение');
        ['mainMenu', 'pauseMenu', 'lanNetworkScreen'].forEach(id => {
          const el = document.getElementById(id); if (el) el.classList.add('hidden');
        });
        if (networkScreen) { networkScreen.remove(); networkScreen = null; }
        const c = document.querySelector('canvas'); if (c) c.requestPointerLock();
      }
    } catch (e) {}
  }, 2000);

  // ===== START =====
  injectMainMenuButton();
  injectPauseButton();
  setInterval(() => { injectMainMenuButton(); injectPauseButton(); }, 1000);

  mc.chat('§aLAN P2P v4.0 — без сервера');
  mc.chat('§7Меню → 🌐 Сетевая игра');
  mc.chat('§7Хост: "Создать комнату" → копирует КОД 1');
  mc.chat('§7Друг: "Присоединиться" → вставляет КОД 1 → отдаёт КОД 2');
  mc.chat('§7Хост: принимает КОД 2 → готово!');
})();
