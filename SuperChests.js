// ============================================================
//  SuperChests v1.2 — сундуки + текстуры + крафт
//  Обновление: реальная иконка-сундук + правильные тайлы 3D-блока
// ============================================================

(function () {
  if (window.__superChests) { mc.chat('SuperChests уже активен'); return; }
  window.__superChests = { version: '1.2' };

  // ===== КОНФИГ =====
  const CHEST_ID = 74;
  const SAVE_KEY = 'superchests_v1';
  const PLANK_IDS = [8, 62, 63];

  // Порядок: [+X, -X, +Y(верх), -Y(низ), +Z(перед), -Z(зад)]
  // 17 = craft_side (панель с креплениями — похоже на сундук)
  // 9  = planks (плоское дерево для крышки/дна)
  // Можешь попробовать: [6,6,9,9,6,6] (log_side — текстура коры)
  //                     [9,9,9,9,9,9] (просто доски)
  const CHEST_TILES = [17, 17, 9, 9, 17, 17];

  // ===== РЕГИСТРАЦИЯ =====
  mc.BLOCKS[CHEST_ID] = {
    id: CHEST_ID, name: 'Сундук', tiles: CHEST_TILES,
    solid: true, transparent: false, liquid: false,
    hardness: 1.5, tool: 'axe', minTier: 0,
    drops: CHEST_ID, xp: 0, light: 0
  };
  mc.ITEMS[CHEST_ID] = { id: CHEST_ID, name: 'Сундук' };

  // ===== ИКОНКА-СУНДУК (16×16) =====
  function makeChestIcon() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    // Корпус
    g.fillStyle = '#8b5a2b'; g.fillRect(0, 0, 16, 16);
    // Тёмный контур
    g.fillStyle = '#3a2010';
    g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1);
    g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16);
    // Крышка (верхняя половина чуть темнее)
    g.fillStyle = '#7a4a20'; g.fillRect(1, 1, 14, 5);
    // Разделительная линия
    g.fillStyle = '#2a1a08'; g.fillRect(1, 6, 14, 1);
    // Корпус (нижняя часть)
    g.fillStyle = '#8b5a2b'; g.fillRect(1, 7, 14, 8);
    // Вертикальные доски
    g.fillStyle = '#6b4520';
    g.fillRect(4, 7, 1, 8); g.fillRect(11, 7, 1, 8);
    // Замок (металл)
    g.fillStyle = '#a0a0a0'; g.fillRect(7, 6, 2, 4);
    g.fillStyle = '#d0d0d0'; g.fillRect(7, 6, 2, 1);
    g.fillStyle = '#303030'; g.fillRect(8, 9, 1, 1);
    return c.toDataURL();
  }
  const CHEST_ICON_URL = makeChestIcon();

  // ===== ХРАНИЛИЩЕ =====
  let chestData = {};
  try { const s = localStorage.getItem(SAVE_KEY); if (s) chestData = JSON.parse(s); } catch (e) { }
  let saveTimer = null;
  function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(chestData)); } catch (e) { }
    }, 400);
  }
  function wkey() { return mc.world ? 'w' + mc.world.seed + ':' : 'def:'; }
  function ck(x, y, z) { return wkey() + x + ',' + y + ',' + z; }
  function getChestData(x, y, z) { return chestData[ck(x, y, z)]; }
  function setChestData(x, y, z, d) { chestData[ck(x, y, z)] = d; persist(); }
  function delChestData(x, y, z) { delete chestData[ck(x, y, z)]; persist(); }
  function ensureChest(x, y, z) {
    let d = getChestData(x, y, z);
    if (!d || !d.items) {
      d = { items: new Array(27).fill(null), paired: false };
      setChestData(x, y, z, d);
    }
    return d;
  }

  // ===== ПАРЫ =====
  function findAdjacentChest(x, y, z) {
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      if (mc.getBlock(x + dx, y, z + dz) === CHEST_ID) return [x + dx, y, z + dz];
    }
    return null;
  }
  function tryPair(x, y, z) {
    const d = ensureChest(x, y, z);
    if (d.paired) return;
    const n = findAdjacentChest(x, y, z);
    if (!n) return;
    const nd = ensureChest(n[0], n[1], n[2]);
    if (nd.paired) return;
    d.paired = true; d.pairPos = n;
    nd.paired = true; nd.pairPos = [x, y, z];
    persist();
  }
  function breakPair(x, y, z) {
    const d = getChestData(x, y, z);
    if (!d || !d.paired) return;
    const [px, py, pz] = d.pairPos;
    const p = getChestData(px, py, pz);
    if (p) { p.paired = false; delete p.pairPos; }
    d.paired = false; delete d.pairPos;
    persist();
  }
  function getPairInfo(x, y, z) {
    const d = getChestData(x, y, z);
    if (!d || !d.paired || !d.pairPos) return null;
    const [px, py, pz] = d.pairPos;
    const p = getChestData(px, py, pz);
    if (!p) { d.paired = false; delete d.pairPos; persist(); return null; }
    const isLeft = (x < px) || (x === px && z < pz);
    return {
      left:  isLeft ? { x, y, z, data: d } : { x: px, y: py, z: pz, data: p },
      right: isLeft ? { x: px, y: py, z: pz, data: p } : { x, y, z, data: d }
    };
  }

  // ===== КЭШ ИКОНОК =====
  const iconCache = {};
  function scanIcons() {
    if (!mc.player || !mc.player.inv) return;
    const hotbar = document.getElementById('hotbar');
    if (hotbar) for (let i = 0; i < 9; i++) {
      const img = hotbar.children[i] && hotbar.children[i].querySelector('img');
      const s = mc.player.inv[i];
      if (img && img.src && s && !iconCache[s.id]) iconCache[s.id] = img.src;
    }
    document.querySelectorAll('#invGrid .slot, #invHotbar .slot').forEach(el => {
      if (el.dataset.container !== 'inv') return;
      const img = el.querySelector('img');
      const s = mc.player.inv[+el.dataset.index];
      if (img && img.src && s && !iconCache[s.id]) iconCache[s.id] = img.src;
    });
  }
  setInterval(scanIcons, 400);

  // ===== ПОДМЕНА ИКОНКИ СУНДУКА В DOM =====
  function overrideChestIcons() {
    if (!mc.player) return;
    const swap = (container) => {
      container.querySelectorAll('.slot').forEach(el => {
        let idx = null, inv = null;
        if (el.dataset.i !== undefined && el.parentElement && el.parentElement.id === 'hotbar') {
          idx = +el.dataset.i; inv = mc.player.inv;
        } else if (el.dataset.container === 'inv') {
          idx = +el.dataset.index; inv = mc.player.inv;
        }
        if (idx === null || !inv) return;
        const s = inv[idx];
        if (s && s.id === CHEST_ID) {
          const img = el.querySelector('img');
          if (img && img.src !== CHEST_ICON_URL) img.src = CHEST_ICON_URL;
        }
      });
    };
    ['hotbar', 'invGrid', 'invHotbar', 'creativeInv', 'creativeHotbar'].forEach(id => {
      const el = document.getElementById(id);
      if (el) swap(el);
    });
  }
  setInterval(overrideChestIcons, 150);

  function iconHTML(id) {
    if (!id) return '';
    if (id === CHEST_ID) {
      return '<img src="' + CHEST_ICON_URL + '" style="width:32px;height:32px;image-rendering:pixelated" draggable="false">';
    }
    if (iconCache[id]) {
      return '<img src="' + iconCache[id] + '" style="width:32px;height:32px;image-rendering:pixelated" draggable="false">';
    }
    const def = id < 100 ? mc.BLOCKS[id] : mc.ITEMS[id];
    const name = (def && def.name) || '?';
    const hue = (id * 37) % 360;
    return '<div style="width:30px;height:30px;background:hsl(' + hue + ',40%,50%);border:1px solid #333;border-radius:2px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:9px;font-weight:bold;overflow:hidden;line-height:1">' + name.slice(0, 3) + '</div>';
  }

  // ===== UI =====
  let chestUI = null, curPos = null, curPair = null, cursorStack = null;

  function ensureCursorEl() {
    let el = document.getElementById('scCursor');
    if (!el) {
      el = document.createElement('div');
      el.id = 'scCursor';
      el.style.cssText = 'position:fixed;pointer-events:none;z-index:50;width:40px;height:40px;transform:translate(-50%,-50%);display:none';
      el.innerHTML = '<img style="width:40px;height:40px;image-rendering:pixelated"><span style="position:absolute;right:-4px;bottom:-6px;color:#fff;font-size:15px;font-weight:bold;text-shadow:2px 2px 0 #000"></span>';
      document.body.appendChild(el);
    }
    return el;
  }
  function updateCursor() {
    const el = ensureCursorEl();
    if (!cursorStack) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const img = el.querySelector('img');
    if (iconCache[cursorStack.id]) { img.src = iconCache[cursorStack.id]; img.style.display = ''; }
    else if (cursorStack.id === CHEST_ID) { img.src = CHEST_ICON_URL; img.style.display = ''; }
    else img.style.display = 'none';
    el.querySelector('span').textContent = cursorStack.n > 1 ? cursorStack.n : '';
  }

  function getSlotItem(container, idx) {
    if (container === 'chest') {
      if (curPair) {
        if (idx < 27) return curPair.left.data.items[idx];
        return curPair.right.data.items[idx - 27];
      }
      if (curPos) {
        const d = getChestData(curPos[0], curPos[1], curPos[2]);
        return d ? d.items[idx] : null;
      }
    } else if (container === 'inv') return mc.player.inv[idx];
    return null;
  }
  function setSlotItem(container, idx, item) {
    if (container === 'chest') {
      if (curPair) {
        if (idx < 27) curPair.left.data.items[idx] = item;
        else curPair.right.data.items[idx - 27] = item;
        persist();
      } else if (curPos) {
        const d = getChestData(curPos[0], curPos[1], curPos[2]);
        if (d) { d.items[idx] = item; persist(); }
      }
    } else if (container === 'inv') mc.player.inv[idx] = item;
  }
  function slotHTML(cls, attr, idx) {
    return '<div class="' + cls + '" data-' + attr + '="' + idx + '" style="width:44px;height:44px;background:#8b8b8b;border:2px solid #373737;border-radius:3px;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer"></div>';
  }
  function refreshChestUI() {
    if (!chestUI) return;
    chestUI.querySelectorAll('.chest-slot').forEach(el => {
      const item = getSlotItem('chest', +el.dataset.slot);
      let inner = '';
      if (item) {
        inner = iconHTML(item.id);
        if (item.n > 1) inner += '<span style="position:absolute;right:3px;bottom:1px;color:#fff;font-size:13px;font-weight:bold;text-shadow:2px 2px 0 #000">' + item.n + '</span>';
      }
      el.innerHTML = inner;
    });
    chestUI.querySelectorAll('.chest-inv-slot').forEach(el => {
      const item = getSlotItem('inv', +el.dataset.idx);
      let inner = '';
      if (item) {
        inner = iconHTML(item.id);
        if (item.n > 1) inner += '<span style="position:absolute;right:3px;bottom:1px;color:#fff;font-size:13px;font-weight:bold;text-shadow:2px 2px 0 #000">' + item.n + '</span>';
      }
      el.innerHTML = inner;
    });
    updateCursor();
  }
  function findTargetSlot(container, item, maxSlots) {
    for (let i = 0; i < maxSlots; i++) {
      const s = getSlotItem(container, i);
      if (s && s.id === item.id && !s.maxDur && s.n < 64) return i;
    }
    for (let i = 0; i < maxSlots; i++) if (!getSlotItem(container, i)) return i;
    return -1;
  }
  function onSlotClick(container, idx, button, shift) {
    const item = getSlotItem(container, idx);
    if (shift && item) {
      const dest = container === 'chest' ? 'inv' : 'chest';
      const max = dest === 'chest' ? (curPair ? 54 : 27) : 36;
      while (item.n > 0) {
        const tgt = findTargetSlot(dest, item, max);
        if (tgt < 0) break;
        const cur = getSlotItem(dest, tgt);
        if (cur && cur.id === item.id) {
          const add = Math.min(item.n, 64 - cur.n);
          cur.n += add; item.n -= add;
          if (item.n <= 0) { setSlotItem(container, idx, null); break; }
        } else {
          const st = { id: item.id, n: Math.min(item.n, 64) };
          if (item.maxDur) { st.maxDur = item.maxDur; st.dur = item.dur; }
          if (item.ench) st.ench = item.ench;
          if (item.name) st.name = item.name;
          setSlotItem(dest, tgt, st);
          item.n -= st.n;
          if (item.n <= 0) { setSlotItem(container, idx, null); break; }
        }
      }
      refreshChestUI(); return;
    }
    if (!cursorStack && item) {
      if (button === 2) {
        const half = Math.ceil(item.n / 2);
        cursorStack = { id: item.id, n: half };
        if (item.maxDur) { cursorStack.maxDur = item.maxDur; cursorStack.dur = item.dur; }
        if (item.ench) cursorStack.ench = item.ench;
        if (item.name) cursorStack.name = item.name;
        item.n -= half;
        if (item.n <= 0) setSlotItem(container, idx, null);
      } else { cursorStack = item; setSlotItem(container, idx, null); }
    } else if (cursorStack && !item) {
      if (button === 2) {
        const one = { id: cursorStack.id, n: 1 };
        if (cursorStack.maxDur) { one.maxDur = cursorStack.maxDur; one.dur = cursorStack.dur; }
        if (cursorStack.ench) one.ench = cursorStack.ench;
        if (cursorStack.name) one.name = cursorStack.name;
        setSlotItem(container, idx, one);
        cursorStack.n--;
        if (cursorStack.n <= 0) cursorStack = null;
      } else { setSlotItem(container, idx, cursorStack); cursorStack = null; }
    } else if (cursorStack && item) {
      if (cursorStack.id === item.id && !item.maxDur && item.n < 64) {
        const add = Math.min(cursorStack.n, 64 - item.n);
        item.n += add; cursorStack.n -= add;
        if (cursorStack.n <= 0) cursorStack = null;
      } else { setSlotItem(container, idx, cursorStack); cursorStack = item; }
    }
    refreshChestUI();
  }

  function openChestUI(x, y, z) {
    if (chestUI) closeChestUI();
    curPos = [x, y, z];
    curPair = getPairInfo(x, y, z);
    cursorStack = null;
    const rows = curPair ? 6 : 3;
    const screen = document.createElement('div');
    screen.id = 'chestScreen';
    screen.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:22;display:flex;align-items:center;justify-content:center';
    let h = '<div style="background:#c6c6c6;border:4px solid #555;border-radius:6px;padding:14px;color:#111;max-height:90vh;overflow-y:auto">';
    h += '<h3 style="margin-bottom:8px;font-size:14px">' + (curPair ? 'Двойной сундук' : 'Сундук') + '</h3>';
    h += '<div style="display:grid;grid-template-columns:repeat(9,44px);gap:3px;margin-bottom:14px">';
    for (let i = 0; i < rows * 9; i++) h += slotHTML('chest-slot', 'slot', i);
    h += '</div><h3 style="margin-bottom:8px;font-size:14px">Инвентарь</h3>';
    h += '<div style="display:grid;grid-template-columns:repeat(9,44px);gap:3px;margin-bottom:6px">';
    for (let i = 9; i < 36; i++) h += slotHTML('chest-inv-slot', 'idx', i);
    h += '</div><div style="display:flex;gap:3px">';
    for (let i = 0; i < 9; i++) h += slotHTML('chest-inv-slot', 'idx', i);
    h += '</div><p style="margin-top:8px;font-size:11px;color:#555;text-align:center">ЛКМ — взять · ПКМ — половина · Shift — переместить · Esc — закрыть</p></div>';
    screen.innerHTML = h;
    document.body.appendChild(screen);
    chestUI = screen;
    chestUI.querySelectorAll('.chest-slot').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); onSlotClick('chest', +el.dataset.slot, e.button, e.shiftKey); });
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    chestUI.querySelectorAll('.chest-inv-slot').forEach(el => {
      el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); onSlotClick('inv', +el.dataset.idx, e.button, e.shiftKey); });
      el.addEventListener('contextmenu', e => e.preventDefault());
    });
    refreshChestUI();
    document.exitPointerLock();
  }
  function closeChestUI() {
    if (!chestUI) return;
    if (cursorStack) {
      const slot = findTargetSlot('inv', cursorStack, 36);
      if (slot >= 0) {
        const cur = getSlotItem('inv', slot);
        if (cur && cur.id === cursorStack.id) cur.n = Math.min(64, cur.n + cursorStack.n);
        else if (!cur) setSlotItem('inv', slot, cursorStack);
        else mc.spawnDrop(cursorStack.id, cursorStack.n, mc.player.pos.x, mc.player.pos.y + 1, mc.player.pos.z);
      } else mc.spawnDrop(cursorStack.id, cursorStack.n, mc.player.pos.x, mc.player.pos.y + 1, mc.player.pos.z);
      cursorStack = null;
    }
    chestUI.remove(); chestUI = null; curPos = null; curPair = null;
    ensureCursorEl().style.display = 'none';
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.requestPointerLock();
  }

  document.addEventListener('mousemove', e => {
    if (cursorStack && chestUI) { const el = ensureCursorEl(); el.style.left = e.clientX + 'px'; el.style.top = e.clientY + 'px'; }
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && chestUI) { e.stopImmediatePropagation(); e.preventDefault(); closeChestUI(); }
  }, true);
  document.addEventListener('mousedown', e => {
    if (chestUI && e.target === chestUI) { e.stopImmediatePropagation(); e.preventDefault(); closeChestUI(); }
  }, true);

  // ===== RAYCAST + ПКМ =====
  function lookDir() {
    const cp = Math.cos(mc.player.pitch), sp = Math.sin(mc.player.pitch);
    const cy = Math.cos(mc.player.yaw), sy = Math.sin(mc.player.yaw);
    return { x: -cp * sy, y: sp, z: -cp * cy };
  }
  function raycastBlock(maxDist) {
    const ex = mc.player.pos.x, ey = mc.player.pos.y + 1.62, ez = mc.player.pos.z;
    const d = lookDir();
    let x = Math.floor(ex), y = Math.floor(ey), z = Math.floor(ez);
    const sx = d.x > 0 ? 1 : d.x < 0 ? -1 : 0;
    const sy = d.y > 0 ? 1 : d.y < 0 ? -1 : 0;
    const sz = d.z > 0 ? 1 : d.z < 0 ? -1 : 0;
    const ddx = sx !== 0 ? Math.abs(1 / d.x) : Infinity;
    const ddy = sy !== 0 ? Math.abs(1 / d.y) : Infinity;
    const ddz = sz !== 0 ? Math.abs(1 / d.z) : Infinity;
    let mx = sx !== 0 ? (sx > 0 ? (x + 1 - ex) : (ex - x)) / Math.abs(d.x) : Infinity;
    let my = sy !== 0 ? (sy > 0 ? (y + 1 - ey) : (ey - y)) / Math.abs(d.y) : Infinity;
    let mz = sz !== 0 ? (sz > 0 ? (z + 1 - ez) : (ez - z)) / Math.abs(d.z) : Infinity;
    let t = 0;
    for (let i = 0; i < 100; i++) {
      const b = mc.getBlock(x, y, z);
      if (b !== 0 && !(mc.BLOCKS[b] && mc.BLOCKS[b].liquid)) return { x, y, z, block: b };
      if (mx < my && mx < mz) { x += sx; t = mx; mx += ddx; }
      else if (my < mz) { y += sy; t = my; my += ddy; }
      else { z += sz; t = mz; mz += ddz; }
      if (t > maxDist) break;
    }
    return null;
  }
  document.addEventListener('mousedown', e => {
    if (e.button !== 2 || chestUI || !mc.world) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || document.pointerLockElement !== canvas) return;
    const hit = raycastBlock(5.5);
    if (hit && hit.block === CHEST_ID) {
      e.stopImmediatePropagation(); e.preventDefault();
      ensureChest(hit.x, hit.y, hit.z);
      openChestUI(hit.x, hit.y, hit.z);
    }
  }, true);

  // ===== ХУК setBlock =====
  const hooked = new WeakSet();
  function hookWorld() {
    if (!mc.world || hooked.has(mc.world)) return;
    const w = mc.world;
    hooked.add(w);
    const orig = w.setBlock.bind(w);
    w.setBlock = function (x, y, z, id) {
      const oldId = this.getBlock(x, y, z);
      orig(x, y, z, id);
      const newId = this.getBlock(x, y, z);
      if (newId === CHEST_ID && oldId !== CHEST_ID) {
        ensureChest(x, y, z);
        tryPair(x, y, z);
      } else if (oldId === CHEST_ID && newId !== CHEST_ID) {
        onBreakChest(x, y, z);
      }
    };
  }
  setInterval(hookWorld, 800);
  hookWorld();

  function onBreakChest(x, y, z) {
    const d = getChestData(x, y, z);
    if (!d) return;
    if (d.items) for (const item of d.items) if (item) mc.spawnDrop(item.id, item.n, x + 0.5, y + 0.5, z + 0.5);
    breakPair(x, y, z);
    delChestData(x, y, z);
  }

  // ===== КРАФТ /chest =====
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.code !== 'Enter') return;
      const txt = chatInput.value.trim().toLowerCase();
      if (txt !== '/chest' && txt !== '/craftchest') return;
      e.stopImmediatePropagation(); e.preventDefault();
      let planks = 0;
      for (const p of mc.player.inv) if (p && PLANK_IDS.includes(p.id)) planks += p.n;
      if (planks < 8) { mc.chat('Нужно 8 досок (у вас ' + planks + ')'); }
      else {
        let rem = 8;
        for (let i = 0; i < mc.player.inv.length && rem > 0; i++) {
          const p = mc.player.inv[i];
          if (p && PLANK_IDS.includes(p.id)) {
            const take = Math.min(rem, p.n);
            p.n -= take; rem -= take;
            if (p.n <= 0) mc.player.inv[i] = null;
          }
        }
        mc.give(CHEST_ID, 1);
        mc.chat('§aСундук скрафчен!');
        try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); } catch (err) { }
      }
      chatInput.value = ''; chatInput.blur();
      const cb = document.getElementById('chatBar'); if (cb) cb.classList.remove('show');
      const canvas = document.querySelector('canvas'); if (canvas) canvas.requestPointerLock();
    }, true);
  }

  // ===== ПОДАРОК =====
  let gave = false;
  setInterval(() => {
    if (gave || !mc.world || !mc.player) return;
    gave = true;
    if (!localStorage.getItem('superchests_welcome')) {
      localStorage.setItem('superchests_welcome', '1');
      mc.give(CHEST_ID, 3);
      try { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 1 })); window.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 })); } catch (e) { }
      mc.chat('§aSuperChests: получите 3 сундука для теста!');
    }
  }, 1200);

  mc.chat('§aSuperChests v1.2 — с текстурами!');
  mc.chat('§7ПКМ — открыть · 2 рядом = двойной (54 слота)');
  mc.chat('§7Крафт: §f/chest§7 (8 досок) · или §f/give сундук');
})();
