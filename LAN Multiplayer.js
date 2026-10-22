// ============================================================
//  LAN Menu v2.0 — UI как в Minecraft
//  • Кнопка "🌐 Сетевая игра" в главном меню
//  • Список миров друзей, доступных в сети
//  • Esc → "🌐 Открыть мир для сети"
//  • Авто-синхронизация блоков, позиций, чата
//  • При подключении — полная синхронизация diffs
// ============================================================

(function () {
  if (window.__lanMenu) { mc.chat('LAN Menu уже активен'); return; }
  window.__lanMenu = { version: '2.0' };

  // ==== ИДЕНТИЧНОСТЬ ====
  const MY_ID = 'p_' + Math.random().toString(36).slice(2, 8);
  let MY_NAME = localStorage.getItem('mc_lan_name') || '';
  if (!MY_NAME) {
    MY_NAME = prompt('Ваше имя для сети:', 'Player' + Math.floor(Math.random() * 1000)) ||
              ('Player' + Math.floor(Math.random() * 1000));
    localStorage.setItem('mc_lan_name', MY_NAME);
  }

  const CHANNEL = 'mc_lan_v1';
  const peers = new Map();
  const remoteWorlds = new Map();
  let myWorldOpen = false;
  let bc = null;
  let applyingRemote = false;
  const pendingBlocks = [];

  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return 'hsl(' + (Math.abs(h) % 360) + ',70%,55%)';
  }

  function broadcast(msg) {
    msg.from = MY_ID;
    if (bc) try { bc.postMessage(msg); } catch (e) {}
  }

  function initBC() {
    try {
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = e => {
        const msg = e.data;
        if (!msg || msg.from === MY_ID) return;
        handleMessage(msg.from, msg);
      };
      broadcast({ type: 'hello', name: MY_NAME });
      broadcast({ type: 'queryWorlds' });
    } catch (e) {
      mc.chat('§cBroadcastChannel недоступен — ' + e.message);
    }
  }

  function sendWorldStatus() {
    if (!mc.world) return;
    broadcast({
      type: 'worldOpen', hostName: MY_NAME,
      name: mc.world.name || 'World', seed: mc.world.seed,
      worldType: 'normal', gameMode: mc.player.gameMode,
      playerCount: peers.size + 1
    });
  }

  function sendWorldDiffs() {
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
      broadcast({ type: 'syncChunk', blocks: all.slice(i, i + 500) });
    }
    broadcast({ type: 'syncDone' });
  }

  function handleMessage(from, msg) {
    if (msg.type === 'hello') {
      if (!peers.has(from)) {
        peers.set(from, {
          id: from, name: msg.name || 'Unknown',
          pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
          lastSeen: Date.now(), color: colorFor(from)
        });
        mc.chat('§a' + (msg.name || 'Unknown') + ' в сети');
      }
    } else if (msg.type === 'pos') {
      const p = peers.get(from);
      if (p) { p.pos = msg.pos; p.yaw = msg.yaw; p.pitch = msg.pitch; p.lastSeen = Date.now(); }
    } else if (msg.type === 'block') {
      if (!mc.world) return;
      const c = mc.world.getChunk(msg.x >> 4, msg.z >> 4);
      if (!c) { pendingBlocks.push({ x: msg.x, y: msg.y, z: msg.z, id: msg.id }); return; }
      const cur = mc.getBlock(msg.x, msg.y, msg.z);
      if (cur !== msg.id) {
        applyingRemote = true;
        mc.world.setBlock(msg.x, msg.y, msg.z, msg.id);
        applyingRemote = false;
      }
    } else if (msg.type === 'chat') {
      mc.chat('§b' + (msg.name || '?') + '§r: ' + msg.text);
    } else if (msg.type === 'worldOpen') {
      remoteWorlds.set(from, {
        hostId: from, hostName: msg.hostName,
        name: msg.name, seed: msg.seed, worldType: msg.worldType,
        gameMode: msg.gameMode, playerCount: msg.playerCount || 1,
        lastUpdate: Date.now()
      });
      if (networkScreen) renderNetworkWorlds();
    } else if (msg.type === 'worldClose') {
      remoteWorlds.delete(from);
      if (networkScreen) renderNetworkWorlds();
    } else if (msg.type === 'queryWorlds') {
      if (myWorldOpen) sendWorldStatus();
    } else if (msg.type === 'bye') {
      peers.delete(from); remoteWorlds.delete(from);
      if (networkScreen) renderNetworkWorlds();
    } else if (msg.type === 'requestSync') {
      if (myWorldOpen) sendWorldDiffs();
    } else if (msg.type === 'syncChunk') {
      if (!mc.world) return;
      for (const [x, y, z, id] of msg.blocks) {
        const c = mc.world.getChunk(x >> 4, z >> 4);
        if (!c) { pendingBlocks.push({ x, y, z, id }); continue; }
        applyingRemote = true;
        mc.world.setBlock(x, y, z, id);
        applyingRemote = false;
      }
      mc.chat('§aСинхронизировано ' + msg.blocks.length + ' блоков');
    } else if (msg.type === 'syncDone') {
      mc.chat('§aСинхронизация завершена');
    }
  }

  // ==== ОТКРЫТИЕ МИРА ====
  function openMyWorld() {
    if (!mc.world) { mc.chat('§cСначала загрузите мир'); return; }
    myWorldOpen = true;
    sendWorldStatus();
    mc.chat('§a🌐 Мир открыт: ' + (mc.world.name || 'World') + ' (сид ' + mc.world.seed + ')');
    updatePauseButton();
  }
  function closeMyWorld() {
    myWorldOpen = false;
    broadcast({ type: 'worldClose' });
    mc.chat('§e🔒 Мир закрыт для сети');
    updatePauseButton();
  }

  // ==== ТАЙМЕРЫ ====
  setInterval(() => { if (myWorldOpen && mc.world) sendWorldStatus(); }, 2000);
  setInterval(() => {
    if (mc.player && mc.world) {
      broadcast({
        type: 'pos',
        pos: { x: mc.player.pos.x, y: mc.player.pos.y, z: mc.player.pos.z },
        yaw: mc.player.yaw, pitch: mc.player.pitch
      });
    }
  }, 100);
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
  }, 1500);

  // Авто-подключение после создания мира из pending
  setInterval(() => {
    if (!mc.world) return;
    const pending = localStorage.getItem('mc_lan_pendingJoin');
    if (!pending) return;
    try {
      const p = JSON.parse(pending);
      if (mc.world.seed === p.seed) {
        localStorage.removeItem('mc_lan_pendingJoin');
        broadcast({ type: 'hello', name: MY_NAME });
        broadcast({ type: 'requestSync' });
        mc.chat('§a🌐 Автоподключение к сети (сид ' + p.seed + ')');
        ['mainMenu', 'pauseMenu', 'lanNetworkScreen'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.classList.add('hidden');
        });
        if (networkScreen) { networkScreen.remove(); networkScreen = null; }
        const canvas = document.querySelector('canvas');
        if (canvas) canvas.requestPointerLock();
      }
    } catch (e) {}
  }, 2000);

  // ==== HOOK setBlock ====
  const hooked = new WeakSet();
  function hookWorld() {
    if (!mc.world || hooked.has(mc.world)) return;
    const w = mc.world;
    hooked.add(w);
    const orig = w.setBlock.bind(w);
    w.setBlock = function (x, y, z, id) {
      orig(x, y, z, id);
      if (!applyingRemote) broadcast({ type: 'block', x, y, z, id });
    };
  }
  setInterval(hookWorld, 800);
  hookWorld();

  // ==== ЧАТ ====
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.code !== 'Enter') return;
      const txt = chatInput.value.trim();
      if (txt && !txt.startsWith('/')) broadcast({ type: 'chat', name: MY_NAME, text: txt });
    }, true);
  }

  // ==== UI: ГЛАВНОЕ МЕНЮ ====
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

  // ==== UI: ПАУЗА ====
  function injectPauseButton() {
    const box = document.querySelector('#pauseMenu .box');
    if (!box) return;
    if (document.getElementById('pauseLanBtn')) { updatePauseButton(); return; }
    const btn = document.createElement('button');
    btn.id = 'pauseLanBtn';
    btn.className = 'menu-btn';
    btn.addEventListener('click', () => { clickSound(); showNetworkScreen('pause'); });
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
      btn.style.background = '#a83a3a';
      btn.style.borderColor = '#6b2020';
    } else {
      btn.textContent = '🌐 Открыть мир для сети';
      btn.style.background = '#3a6ea8';
      btn.style.borderColor = '#204a6b';
    }
  }

  // ==== UI: ЭКРАН СЕТИ ====
  let networkScreen = null;
  let networkFrom = 'main';

  function showNetworkScreen(from) {
    networkFrom = from;
    if (networkScreen) networkScreen.remove();
    const mm = document.getElementById('mainMenu');
    const pm = document.getElementById('pauseMenu');
    if (mm) mm.classList.add('hidden');
    if (pm) pm.classList.add('hidden');

    networkScreen = document.createElement('div');
    networkScreen.id = 'lanNetworkScreen';
    networkScreen.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:30;display:flex;flex-direction:column;align-items:center;padding:20px 0;font-family:"Courier New",monospace';

    const mySection = mc.world ? `
      <div style="width:min(700px,90vw);padding:14px;background:rgba(40,40,50,.9);border:2px solid ${myWorldOpen ? '#4a8f2a' : '#555'};border-radius:6px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:20px">
          <div>
            <div style="color:#8fdc5a;font-size:14px;font-weight:bold;margin-bottom:2px">Мой мир: ${(mc.world.name || 'World')}</div>
            <div style="color:#888;font-size:11px">Сид: ${mc.world.seed} · Игроков: ${peers.size} · ${myWorldOpen ? '🌐 Открыт' : '🔒 Закрыт'}</div>
          </div>
          <button id="lanToggleMyWorld" style="padding:10px 18px;background:${myWorldOpen ? '#a83a3a' : '#4a8f2a'};border:2px solid ${myWorldOpen ? '#6b2020' : '#2d5c17'};color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:1px;white-space:nowrap">
            ${myWorldOpen ? '🔒 Закрыть' : '🌐 Открыть для сети'}
          </button>
        </div>
      </div>` : '';

    networkScreen.innerHTML = `
      <h2 style="color:#fff;font-size:26px;letter-spacing:3px;text-shadow:3px 3px 0 #000;margin-top:10px;margin-bottom:16px">СЕТЕВАЯ ИГРА</h2>
      ${mySection}
      <h3 style="color:#ffd45e;font-size:14px;letter-spacing:2px;margin-bottom:10px;width:min(700px,90vw);text-align:left">Миры друзей в сети:</h3>
      <div id="lanWorldList" style="width:min(700px,90vw);flex:1;overflow-y:auto;max-height:calc(100vh - 380px);padding:0 8px;margin-bottom:20px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:min(700px,90vw);padding:0 8px">
        <button id="lanRefreshBtn" style="padding:14px;font-size:15px;font-family:inherit;letter-spacing:1px;background:#777;border:2px solid #444;color:#fff;border-radius:3px;cursor:pointer">🔄 Обновить</button>
        <button id="lanCloseBtn" style="padding:14px;font-size:15px;font-family:inherit;letter-spacing:1px;background:#555;border:2px solid #333;color:#fff;border-radius:3px;cursor:pointer">← Назад</button>
      </div>
      <div style="margin-top:12px;font-size:11px;color:#666;max-width:700px;text-align:center;padding:0 8px;line-height:1.6">
        Ваше имя: <span style="color:#8fdc5a">${MY_NAME}</span> · Игроков в сети: <span style="color:#8fdc5a">${peers.size}</span><br>
        <span style="color:#888">BroadcastChannel · работает между вкладками одного браузера</span>
      </div>
    `;
    document.body.appendChild(networkScreen);

    const toggle = document.getElementById('lanToggleMyWorld');
    if (toggle) toggle.onclick = () => {
      if (myWorldOpen) closeMyWorld(); else openMyWorld();
      showNetworkScreen(networkFrom);
    };
    document.getElementById('lanRefreshBtn').onclick = () => {
      broadcast({ type: 'queryWorlds' });
      renderNetworkWorlds();
    };
    document.getElementById('lanCloseBtn').onclick = () => {
      networkScreen.remove();
      networkScreen = null;
      if (networkFrom === 'main' && mm) mm.classList.remove('hidden');
      if (networkFrom === 'pause' && pm) pm.classList.remove('hidden');
    };
    broadcast({ type: 'queryWorlds' });
    renderNetworkWorlds();
  }

  function renderNetworkWorlds() {
    const list = document.getElementById('lanWorldList');
    if (!list) return;
    list.innerHTML = '';
    const now = Date.now();
    for (const [hostId, w] of Array.from(remoteWorlds)) {
      if (now - w.lastUpdate > 8000) remoteWorlds.delete(hostId);
    }
    if (remoteWorlds.size === 0) {
      list.innerHTML = '<div style="color:#888;text-align:center;padding:40px 20px;font-size:14px;font-style:italic">В сети нет доступных миров.<br><span style="font-size:11px;color:#666;margin-top:10px;display:block">Попросите друга: <b style="color:#8fdc5a">Esc → 🌐 Открыть мир для сети</b></span></div>';
      return;
    }
    for (const [hostId, w] of remoteWorlds) {
      const seedMatch = mc.world && mc.world.seed === w.seed;
      const noWorld = !mc.world;
      const canJoin = seedMatch || noWorld;
      const card = document.createElement('div');
      card.style.cssText = 'background:rgba(40,40,50,.9);border:2px solid ' + (canJoin ? '#4a8f2a' : '#777') + ';border-radius:6px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px';
      card.innerHTML = `
        <div style="flex:1">
          <div style="color:#8fdc5a;font-size:17px;font-weight:bold;margin-bottom:4px">${w.name || 'World'}</div>
          <div style="color:#aaa;font-size:12px">Хост: <b>${w.hostName}</b> · Игроков: ${w.playerCount}/20</div>
          <div style="color:#666;font-size:11px">Режим: ${w.gameMode === 'creative' ? 'Творческий' : 'Выживание'} · Сид: ${w.seed}${seedMatch ? ' <span style="color:#4a8f2a">✓</span>' : ''}</div>
        </div>
        <button class="lanJoinWorld" data-host="${hostId}" data-seed="${w.seed}" style="padding:10px 20px;background:${canJoin ? '#4a8f2a' : '#555'};border:2px solid ${canJoin ? '#2d5c17' : '#333'};color:#fff;border-radius:3px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:1px;white-space:nowrap">
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
    const w = remoteWorlds.get(hostId);
    if (!w) return;
    if (!mc.world) {
      localStorage.setItem('mc_lan_pendingJoin', JSON.stringify({ hostId, seed }));
      alert(
        'Для присоединения нужен мир с сидом ' + seed + '\n\n' +
        '1. Закройте это окно\n' +
        '2. Одиночная игра → Создать мир\n' +
        '3. Введите сид: ' + seed + '\n' +
        '4. После загрузки мод автоматически подключится'
      );
      return;
    }
    if (mc.world.seed !== seed) {
      alert(
        'Сид не совпадает.\n\nВаш: ' + mc.world.seed + '\nНужен: ' + seed + '\n\n' +
        'Создайте новый мир с нужным сидом или попросите хоста открыть ваш.'
      );
      return;
    }
    broadcast({ type: 'hello', name: MY_NAME });
    broadcast({ type: 'requestSync' });
    mc.chat('§a🌐 Подключение к миру ' + w.hostName + '...');
    if (networkScreen) { networkScreen.remove(); networkScreen = null; }
    const mm = document.getElementById('mainMenu');
    const pm = document.getElementById('pauseMenu');
    if (mm) mm.classList.add('hidden');
    if (pm) pm.classList.add('hidden');
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
  }

  // ==== ЗВУК ====
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

  // ==== ОВЕРЛЕЙ (спрайты игроков) ====
  const overlay = document.createElement('canvas');
  overlay.id = 'lanOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;';
  document.body.appendChild(overlay);
  function resizeOverlay() { overlay.width = innerWidth; overlay.height = innerHeight; }
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);

  function project(pos, camPos, yaw, pitch, fov, aspect) {
    const dx = pos.x - camPos.x, dy = pos.y - (camPos.y + 1.62), dz = pos.z - camPos.z;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const x1 = dx * cy - dz * sy, z1 = dx * sy + dz * cy;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const y2 = dy * cp + z1 * sp, z2 = -dy * sp + z1 * cp;
    const fwd = -z2;
    if (fwd <= 0.1) return null;
    const t = Math.tan(fov * Math.PI / 360);
    return {
      x: (x1 / (fwd * t * aspect) * 0.5 + 0.5) * overlay.width,
      y: (-y2 / (fwd * t) * 0.5 + 0.5) * overlay.height,
      fwd, scale: 1 / fwd
    };
  }

  function drawOverlay() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (mc.player && mc.world && mc.player.pos) {
      const now = Date.now();
      const aspect = overlay.width / overlay.height;
      const fov = 72;
      for (const [id, p] of Array.from(peers)) {
        if (now - p.lastSeen > 6000) { peers.delete(id); continue; }
        const pr = project(p.pos, mc.player.pos, mc.player.yaw, mc.player.pitch, fov, aspect);
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

  // ==== BEFORE UNLOAD ====
  window.addEventListener('beforeunload', () => {
    if (myWorldOpen) broadcast({ type: 'worldClose' });
    broadcast({ type: 'bye' });
  });

  // ==== СТАРТ ====
  initBC();
  injectMainMenuButton();
  injectPauseButton();
  setInterval(() => { injectMainMenuButton(); injectPauseButton(); }, 1000);

  mc.chat('§aLAN Menu v2.0 — сетевая игра');
  mc.chat('§7Главное меню → 🌐 Сетевая игра');
  mc.chat('§7В игре: Esc → 🌐 Открыть мир для сети');
  mc.chat('§7Имя: §f' + MY_NAME + '§7 (сменить: localStorage.mc_lan_name)');
})();
