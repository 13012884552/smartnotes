// SmartNotes - Full Offline PWA v2
// ================================

const DB_NAME = 'smartnotes';
const DB_VER = 2;
let db, currentPage = 'notes', currentFolder = null, editingNoteId = null, viewingNoteId = null, ocrResultText = '';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('notes')) d.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('categories')) d.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('reminders')) d.createObjectStore('reminders', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('checkins')) d.createObjectStore('checkins', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('schedule')) d.createObjectStore('schedule', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') { return db.transaction(store, mode).objectStore(store); }
function storePut(store, data) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readwrite').put(data);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function storeGetAll(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function storeGet(store, id) {
  return new Promise((resolve, reject) => {
    const r = tx(store).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function storeDelete(store, id) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readwrite').delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}
function storeClear(store) {
  return new Promise((resolve, reject) => {
    const r = tx(store, 'readwrite').clear();
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

// ============= INIT =============
async function init() {
  await openDB();
  const cats = await storeGetAll('categories');
  if (cats.length === 0) {
    for (const name of ['📝 工作笔记', '👤 个人笔记', '📋 会议记录', '🔌 EMC检测', '📁 项目文件']) {
      await storePut('categories', { name });
    }
  }
  const settings = await storeGetAll('settings');
  if (!settings.find(s => s.key === 'workStartTime')) {
    await storePut('settings', { key: 'workStartTime', value: '08:00' });
  }
  await renderAll();
  updateClock();
  setInterval(updateClock, 30000);
  checkReminders();
  setInterval(checkReminders, 60000);
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// ============= NAVIGATION =============
function switchPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById('page-' + page);
  if (targetPage) targetPage.classList.add('active');

  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = { notes: '📒 笔记', camera: '📷 拍照识别', checkin: '✅ 打卡', reminders: '⏰ 提醒', settings: '⚙️ 设置' };
  document.getElementById('headerTitle').textContent = titles[page] || 'SmartNotes';

  // Show/hide nav and header for detail view
  const isDetail = (page === 'note-detail');
  document.getElementById('nav').style.display = isDetail ? 'none' : 'flex';
  document.getElementById('headerTitle').style.display = isDetail ? 'none' : '';

  const fab = document.getElementById('fab');
  const fabMenu = document.getElementById('fabMenu');
  const fabOverlay = document.getElementById('fabOverlay');
  if (page === 'notes') {
    fab.classList.remove('hidden');
  } else {
    fab.classList.add('hidden');
    if (fabMenu) fabMenu.style.display = 'none';
    if (fabOverlay) fabOverlay.style.display = 'none';
  }
  if (page === 'notes') { currentFolder = null; renderNotes(); }
  if (page === 'checkin') renderCheckin();
  if (page === 'reminders') renderReminders();
  if (page === 'settings') renderSettings();
}

// ============= FOLDERS & NOTES =============
async function getFolders(parentId = null) {
  const all = await storeGetAll('folders');
  return all.filter(f => f.parentId === parentId);
}

async function getNotesInFolder(folderId = null) {
  const all = await storeGetAll('notes');
  return all.filter(n => n.folderId === folderId).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
}

async function renderNotes() {
  const folders = await getFolders(currentFolder);
  const notes = await getNotesInFolder(currentFolder);

  // Breadcrumb
  let breadcrumb = `<span class="tag" onclick="navigateFolder(null)" style="cursor:pointer">🏠 全部</span>`;
  if (currentFolder) {
    const ancestors = await getAncestors(currentFolder);
    ancestors.forEach(f => {
      breadcrumb += ` <span style="color:var(--sub)">›</span> <span class="tag" onclick="navigateFolder(${f.id})" style="cursor:pointer">${esc(f.name)}</span>`;
    });
  }
  document.getElementById('categoryFilter').innerHTML = breadcrumb;

  let html = '';

  // Folders section
  if (folders.length > 0) {
    html += '<div style="font-size:12px;color:var(--sub);margin-bottom:8px">📁 文件夹</div>';
    html += folders.map(f => `
      <div class="card" style="cursor:pointer;display:flex;align-items:center;gap:10px" onclick="navigateFolder(${f.id})">
        <div style="font-size:24px">📁</div>
        <div style="flex:1">
          <div style="font-weight:500">${esc(f.name)}</div>
          <div style="font-size:11px;color:var(--sub)">${f.noteCount || 0} 个笔记</div>
        </div>
        <button style="background:none;border:none;color:var(--red);font-size:16px;padding:8px" onclick="event.stopPropagation();deleteFolder(${f.id})">✕</button>
      </div>
    `).join('');
  }

  // Notes section
  if (notes.length > 0) {
    html += '<div style="font-size:12px;color:var(--sub);margin:12px 0 8px">📝 笔记</div>';
    html += notes.map(n => {
      const imgCount = n.images ? n.images.length : (n.image ? 1 : 0);
      return `
        <div class="card" style="cursor:pointer" onclick="openNoteDetail(${n.id})">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div style="font-weight:600;margin-bottom:4px;flex:1">${esc(n.title) || '无标题'}</div>
          </div>
          <div style="font-size:13px;color:var(--sub);line-height:1.5;max-height:45px;overflow:hidden">${esc((n.content || '').substring(0, 120))}</div>
          ${imgCount > 0 ? `<div style="margin-top:8px;display:flex;gap:4px;overflow-x:auto">${(n.images || (n.image ? [n.image] : [])).slice(0,4).map(img => `<img src="${img}" style="width:50px;height:50px;border-radius:6px;object-fit:cover">`).join('')}${imgCount > 4 ? `<span style="font-size:12px;color:var(--sub);align-self:center">+${imgCount-4}</span>` : ''}</div>` : ''}
          <div style="font-size:11px;color:var(--sub);margin-top:6px">${formatDate(n.updatedAt || n.createdAt)}</div>
        </div>
      `;
    }).join('');
  }

  if (!folders.length && !notes.length) {
    document.getElementById('notesEmpty').style.display = 'block';
    document.getElementById('notesList').innerHTML = '';
  } else {
    document.getElementById('notesEmpty').style.display = 'none';
    document.getElementById('notesList').innerHTML = html;
  }
}

async function getAncestors(folderId) {
  const result = [];
  let current = folderId;
  while (current) {
    const f = await storeGet('folders', current);
    if (!f || !f.parentId) break;
    const parent = await storeGet('folders', f.parentId);
    if (!parent) break;
    result.unshift(parent);
    current = parent.id;
  }
  const self = await storeGet('folders', folderId);
  if (self) result.push(self);
  return result;
}

function navigateFolder(folderId) {
  currentFolder = folderId;
  renderNotes();
}

// ============= FAB MENU =============
function toggleFabMenu() {
  const menu = document.getElementById('fabMenu');
  const overlay = document.getElementById('fabOverlay');
  const isOpen = menu.style.display === 'flex';
  menu.style.display = isOpen ? 'none' : 'flex';
  overlay.style.display = isOpen ? 'none' : 'block';
}

// ============= NEW FOLDER =============
async function showNewFolderSheet() {
  const name = prompt('输入文件夹名称：');
  if (!name || !name.trim()) return;
  await storePut('folders', {
    name: name.trim(),
    parentId: currentFolder,
    createdAt: Date.now(),
  });
  await renderNotes();
}

// ============= DELETE FOLDER =============
async function deleteFolder(id) {
  const subFolders = (await storeGetAll('folders')).filter(f => f.parentId === id);
  const notes = (await storeGetAll('notes')).filter(n => n.folderId === id);
  const total = subFolders.length + notes.length;
  if (total > 0 && !confirm(`此文件夹包含 ${total} 个项目（${subFolders.length} 个子文件夹，${notes.length} 个笔记），确定删除？`)) return;
  for (const f of subFolders) await deleteFolder(f.id);
  for (const n of notes) await storeDelete('notes', n.id);
  await storeDelete('folders', id);
  await renderNotes();
}

// ============= NOTE EDITOR =============
async function showNewNoteSheet() {
  editingNoteId = null;
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  const imgContainer = document.getElementById('noteImages');
  imgContainer.innerHTML = '';
  imgContainer.dataset.images = '[]';
  renderImagePreviews([]);
  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}

function hideNewNoteSheet() {
  document.getElementById('noteOverlay').classList.remove('show');
  document.getElementById('noteSheet').classList.remove('open');
}

function attachImages(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  const container = document.getElementById('noteImages');
  let images = JSON.parse(container.dataset.images || '[]');

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      images.push(ev.target.result);
      container.dataset.images = JSON.stringify(images);
      renderImagePreviews(images);
    };
    reader.readAsDataURL(file);
  });
}

function renderImagePreviews(images) {
  const container = document.getElementById('noteImages');
  container.innerHTML = images.map((img, i) => `
    <div style="position:relative;display:inline-block;margin:4px">
      <img src="${img}" style="width:80px;height:80px;border-radius:8px;object-fit:cover">
      <button onclick="removeImage(${i})" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:11px;background:var(--red);color:#fff;border:none;font-size:12px;cursor:pointer">✕</button>
    </div>
  `).join('');
  container.innerHTML += `
    <label style="display:inline-block;width:80px;height:80px;border:2px dashed var(--sep);border-radius:8px;cursor:pointer;vertical-align:top;text-align:center;line-height:80px;color:var(--sub);font-size:28px;margin:4px">
      +<input type="file" accept="image/*" multiple style="display:none" onchange="attachImages(event)">
    </label>
  `;
}

function removeImage(idx) {
  const container = document.getElementById('noteImages');
  let images = JSON.parse(container.dataset.images || '[]');
  images.splice(idx, 1);
  container.dataset.images = JSON.stringify(images);
  renderImagePreviews(images);
}

async function saveNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  const container = document.getElementById('noteImages');
  const images = JSON.parse(container.dataset.images || '[]');

  const note = {
    title,
    content,
    images: images.length > 0 ? images : undefined,
    folderId: currentFolder,
    createdAt: editingNoteId ? undefined : Date.now(),
    updatedAt: Date.now(),
  };

  if (editingNoteId) {
    const existing = await storeGet('notes', editingNoteId);
    if (existing) {
      note.createdAt = existing.createdAt;
      note.id = editingNoteId;
      await storePut('notes', note);
    }
  } else {
    await storePut('notes', note);
  }

  hideNewNoteSheet();
  await renderNotes();
}

async function editNote(id) {
  const note = await storeGet('notes', id);
  if (!note) return;

  editingNoteId = id;
  document.getElementById('noteTitle').value = note.title || '';
  document.getElementById('noteContent').value = note.content || '';
  const images = note.images || (note.image ? [note.image] : []);
  document.getElementById('noteImages').dataset.images = JSON.stringify(images);
  renderImagePreviews(images);

  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}

async function deleteNote(id) {
  if (!confirm('确定删除这条笔记？')) return;
  await storeDelete('notes', id);
  await renderNotes();
}

// ============= CAMERA / OCR =============
async function handleCamera(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('ocrPreview');
  const url = URL.createObjectURL(file);
  preview.innerHTML = `<img src="${url}" class="photo-preview" style="max-height:250px"><div style="padding:12px;color:var(--sub)">🔍 正在识别文字...</div>`;

  try {
    const worker = await Tesseract.recognize(file, 'chi_sim+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          preview.querySelector('div').textContent = `🔍 识别中... ${Math.round(m.progress * 100)}%`;
        }
      }
    });
    ocrResultText = worker.data.text.trim();
    preview.innerHTML = `
      <img src="${url}" class="photo-preview" style="max-height:120px">
      <div class="ocr-result">${esc(ocrResultText) || '(未识别到文字)'}</div>
      <button class="btn" onclick="saveOCRToFolder()" style="margin-top:8px">📝 保存到当前文件夹</button>
      <button class="btn-outline" onclick="document.getElementById('ocrPreview').innerHTML='';ocrResultText=''" style="margin-top:4px;width:100%">取消</button>
    `;
  } catch (err) {
    preview.innerHTML = `<div style="color:var(--red);padding:12px">识别失败：${esc(err.message)}</div>`;
  }
}

async function saveOCRToFolder() {
  if (!ocrResultText) return;
  await storePut('notes', {
    title: ocrResultText.substring(0, 40),
    content: ocrResultText,
    folderId: currentFolder,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  ocrResultText = '';
  document.getElementById('ocrPreview').innerHTML = '<div style="color:var(--green);padding:20px">✅ 笔记已保存！</div>';
  await renderNotes();
}

// ============= CHECK-IN =============
async function renderCheckin() {
  updateClock();
  const settings = await storeGetAll('settings');
  const workTime = settings.find(s => s.key === 'workStartTime')?.value || '08:00';
  const today = new Date().toISOString().split('T')[0];
  const checkins = await storeGetAll('checkins');
  const todayCheckin = checkins.filter(c => c.date === today);

  const status = document.getElementById('checkinStatus');
  const btn = document.getElementById('checkinBtn');

  if (todayCheckin.length > 0) {
    const ci = todayCheckin[0];
    const onTime = ci.time <= workTime;
    status.innerHTML = `<span class="checkin-dot ${onTime ? 'ok' : 'late'}"></span> 今日已打卡 ${ci.time} ${onTime ? '✅ 准时' : '⚠️ 迟到'}`;
    btn.textContent = '✅ 已打卡'; btn.style.background = 'var(--green)'; btn.disabled = true;
  } else {
    const [h, m] = workTime.split(':');
    const d = new Date(); d.setHours(parseInt(h), parseInt(m), 0);
    if (new Date() > d) {
      status.innerHTML = '<span class="checkin-dot miss"></span> ⚠️ 已过上班时间，请尽快打卡';
    } else {
      status.innerHTML = '<span style="color:var(--sub)">还未打卡</span>';
    }
    btn.textContent = '✅ 上班打卡'; btn.style.background = 'var(--accent)'; btn.disabled = false;
  }

  const recent = checkins.sort((a, b) => b.timestamp - a.timestamp).slice(0, 7);
  document.getElementById('checkinHistory').innerHTML = recent.length === 0
    ? '<div style="color:var(--sub);font-size:13px">暂无记录</div>'
    : recent.map(c => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--sep);font-size:14px"><span>${c.date} ${c.dayOfWeek}</span><span style="color:${c.time <= workTime ? 'var(--green)' : 'var(--orange)'}">${c.time}</span></div>`).join('');
  renderTodaySchedule();
}

async function renderTodaySchedule() {
  const schedule = await storeGetAll('schedule');
  const todayStr = new Date().toISOString().split('T')[0];
  const items = schedule.filter(s => {
    try { return new Date(s.date).toISOString().split('T')[0] === todayStr; } catch(e) { return false; }
  });
  document.getElementById('todaySchedule').innerHTML = items.length === 0
    ? '<div style="color:var(--sub);font-size:13px">暂无今日排班，请先导入排班表</div>'
    : items.map(s => `<div class="schedule-day"><div style="font-weight:500">📍 ${esc(s.location || '未指定')}</div><div style="font-size:12px;color:var(--sub);margin-top:2px">🕐 ${esc(s.shift || '')} | 🔧 ${esc(s.task || '')}</div></div>`).join('');
}

async function doCheckin() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const settings = await storeGetAll('settings');
  const workTime = settings.find(s => s.key === 'workStartTime')?.value || '08:00';
  await storePut('checkins', { date, time, dayOfWeek: days[now.getDay()], timestamp: now.getTime(), onTime: time <= workTime });
  await renderCheckin();
}

function updateClock() {
  const now = new Date();
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const timeEl = document.getElementById('currentTime');
  const dateEl = document.getElementById('currentDate');
  if (timeEl) timeEl.textContent = now.toTimeString().slice(0, 5);
  if (dateEl) dateEl.textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${days[now.getDay()]}`;
}

// ============= REMINDERS =============
async function renderReminders() {
  const reminders = await storeGetAll('reminders');
  const list = document.getElementById('remindersList');
  const empty = document.getElementById('remindersEmpty');
  if (reminders.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    list.innerHTML = reminders.map(r => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-weight:500">${esc(r.title)}</div><div style="font-size:12px;color:var(--sub)">🕐 ${r.time} · ${r.type === 'daily' ? '每天' : r.type === 'weekday' ? '工作日' : '一次性'}</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:${r.enabled ? 'var(--green)' : 'var(--sub)'}">${r.enabled ? '开' : '关'}</span>
          <button class="btn-sm" style="background:var(--red);font-size:11px;padding:4px 10px" onclick="deleteReminder(${r.id})">✕</button>
        </div>
      </div>`).join('');
  }
}

function addReminderSheet() {
  document.getElementById('reminderTitle').value = '';
  document.getElementById('reminderTime').value = '08:00';
  document.getElementById('reminderOverlay').classList.add('show');
  document.getElementById('reminderSheet').classList.add('open');
}

function hideReminderSheet() {
  document.getElementById('reminderOverlay').classList.remove('show');
  document.getElementById('reminderSheet').classList.remove('open');
}

async function saveReminder() {
  const title = document.getElementById('reminderTitle').value.trim();
  if (!title) return;
  await storePut('reminders', { title, time: document.getElementById('reminderTime').value, type: document.getElementById('reminderType').value, enabled: document.getElementById('reminderEnabled').checked });
  hideReminderSheet();
  await renderReminders();
}

async function deleteReminder(id) { await storeDelete('reminders', id); await renderReminders(); }

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date(), timeStr = now.toTimeString().slice(0, 5), day = now.getDay();
  storeGetAll('reminders').then(reminders => {
    reminders.filter(r => r.enabled && r.time === timeStr).forEach(r => {
      const should = r.type === 'daily' || (r.type === 'weekday' && day >= 1 && day <= 5) || r.type === 'once';
      if (should) {
        new Notification('SmartNotes', { body: r.title, icon: 'icon-192.png', tag: 'r-' + r.id });
        if (r.type === 'once') storePut('reminders', { ...r, enabled: false });
      }
    });
  });
}

// ============= SCHEDULE IMPORT =============
async function importSchedule(e) {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('scheduleStatus');
  status.textContent = '正在解析...';
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    status.textContent = `已读取 ${wb.SheetNames.length} 个工作表`;
    await storeClear('schedule');
    let imported = 0;

    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) continue;

      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        for (let j = 0; j < rows[i].length; j++) {
          if (typeof rows[i][j] === 'number' && rows[i][j] > 40000 && rows[i][j] < 50000) {
            const d = XLSX.SSF.parse_date_code(rows[i][j]);
            const dateStr = `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
            for (let k = i + 1; k < rows.length; k++) {
              const taskCell = String(rows[k][j] || '');
              if (taskCell && taskCell !== '周末' && taskCell !== '休息') {
                const rowLabel = String(rows[k][0] || '');
                await storePut('schedule', {
                  date: dateStr, sheet: name,
                  location: name.split('-')[0] || '未分类',
                  shift: rowLabel.includes('夜班') ? '夜班' : rowLabel.includes('中班') ? '中班' : '白班',
                  task: taskCell.substring(0, 200),
                });
                imported++;
              }
            }
          }
        }
      }
    }
    status.textContent = `✅ 成功导入 ${imported} 条记录！`;
    setTimeout(() => renderCheckin(), 500);
  } catch (err) {
    status.textContent = `❌ 解析失败：${err.message}`;
  }
}

// ============= SETTINGS =============
async function renderSettings() {
  const cats = await storeGetAll('categories');
  document.getElementById('categoryList').innerHTML = cats.map(c => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--sep);font-size:14px">
      <span>${esc(c.name)}</span>
      <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px" onclick="deleteCategory(${c.id})">✕</button>
    </div>`).join('');

  const settings = await storeGetAll('settings');
  const wt = settings.find(s => s.key === 'workStartTime');
  if (wt) document.getElementById('workStartTime').value = wt.value;

  const schedule = await storeGetAll('schedule');
  document.getElementById('scheduleStatus').textContent = schedule.length > 0 ? `已导入 ${schedule.length} 条记录` : '尚未导入';
}

async function addCategory() {
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if (!name) return;
  await storePut('categories', { name });
  input.value = '';
  await renderSettings();
}

async function deleteCategory(id) {
  await storeDelete('categories', id);
  await renderSettings();
}

async function saveSettings() {
  await storePut('settings', { key: 'workStartTime', value: document.getElementById('workStartTime').value });
}

async function exportData() {
  const notes = await storeGetAll('notes');
  const checkins = await storeGetAll('checkins');
  const schedule = await storeGetAll('schedule');
  const folders = await storeGetAll('folders');
  const blob = new Blob([JSON.stringify({ notes, checkins, schedule, folders, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'smartnotes-backup.json';
  a.click();
}

async function clearAll() {
  for (const s of ['notes', 'checkins', 'reminders', 'schedule', 'folders']) await storeClear(s);
  await renderAll();
}

async function renderAll() {
  await renderNotes();
  await renderCheckin();
  await renderReminders();
  await renderSettings();
}

// ============= NOTE DETAIL VIEW (like Apple Notes) =============
async function openNoteDetail(id) {
  const note = await storeGet('notes', id);
  if (!note) return;
  viewingNoteId = id;

  // Show detail page, hide nav
  switchPage('note-detail');
  const detailPage = document.getElementById('page-note-detail');
  detailPage.style.display = 'block';
  detailPage.classList.add('active');

  document.getElementById('noteDetailDate').textContent = formatDate(note.updatedAt || note.createdAt);

  const images = note.images || (note.image ? [note.image] : []);
  const imgHTML = images.length > 0 ? images.map((img, i) => `
    <img src="${img}" class="note-detail-img" onclick="viewFullImage(${i})" style="max-height:400px;object-fit:contain;background:#111">
  `).join('') : '';

  document.getElementById('noteDetailContent').innerHTML = `
    <div class="note-detail-title">${esc(note.title) || '无标题'}</div>
    <div class="note-detail-body">${esc(note.content || '') || '<span style="color:var(--sub)">暂无内容</span>'}</div>
    ${imgHTML}
    ${images.length > 0 ? `<div style="font-size:12px;color:var(--sub);margin-top:8px">📎 ${images.length} 张图片</div>` : ''}
  `;
}

function closeNoteDetail() {
  const detailPage = document.getElementById('page-note-detail');
  detailPage.style.display = 'none';
  detailPage.classList.remove('active');
  document.getElementById('nav').style.display = 'flex';
  document.getElementById('headerTitle').style.display = '';
  viewingNoteId = null;
  switchPage('notes');
}

async function editNoteFromDetail() {
  if (!viewingNoteId) return;
  closeNoteDetail();
  await editNote(viewingNoteId);
}

async function deleteNoteFromDetail() {
  if (!viewingNoteId) return;
  if (!confirm('确定删除这条笔记？')) return;
  await storeDelete('notes', viewingNoteId);
  viewingNoteId = null;
  closeNoteDetail();
}

// Full-screen image viewer (simple)
function viewFullImage(idx) {
  const container = document.getElementById('noteDetailContent');
  const imgs = container.querySelectorAll('.note-detail-img');
  if (imgs[idx]) {
    const src = imgs[idx].src;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain" onclick="this.parentElement.remove()">`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
  }
}

// ============= CHECK-OUT (下班签退) =============
async function doCheckout() {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().slice(0, 5);

  // Update today's checkin record with checkout time
  const checkins = await storeGetAll('checkins');
  const todayCheckin = checkins.find(c => c.date === date);

  if (todayCheckin) {
    todayCheckin.checkoutTime = time;
    await storePut('checkins', todayCheckin);
  }
  await renderCheckin();
}

async function renderCheckin() {
  updateClock();
  const settings = await storeGetAll('settings');
  const workTime = settings.find(s => s.key === 'workStartTime')?.value || '08:00';
  const today = new Date().toISOString().split('T')[0];
  const checkins = await storeGetAll('checkins');
  const todayCheckin = checkins.filter(c => c.date === today);

  const status = document.getElementById('checkinStatus');
  const inBtn = document.getElementById('checkinBtn');
  const outBtn = document.getElementById('checkoutBtn');
  const workInfo = document.getElementById('todayWorkTime');

  if (todayCheckin.length > 0) {
    const ci = todayCheckin[0];
    const onTime = ci.time <= workTime;

    if (ci.checkoutTime) {
      // Both check-in and check-out done
      status.innerHTML = `<span class="checkin-dot ok"></span> ✅ 今日已完成`;
      inBtn.textContent = '✅ 上班 ' + ci.time;
      inBtn.style.background = 'var(--green)';
      inBtn.disabled = true;
      outBtn.textContent = '🏠 下班 ' + ci.checkoutTime;
      outBtn.style.background = 'var(--green)';
      outBtn.style.display = 'block';
      outBtn.disabled = true;

      // Calculate work duration
      const [inH, inM] = ci.time.split(':').map(Number);
      const [outH, outM] = ci.checkoutTime.split(':').map(Number);
      const mins = (outH * 60 + outM) - (inH * 60 + inM);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      workInfo.textContent = `⏱ 今日工时：${hours}小时${remainMins}分钟`;
    } else {
      // Checked in but not out yet
      status.innerHTML = `<span class="checkin-dot ${onTime ? 'ok' : 'late'}"></span> 已上班打卡 ${ci.time} ${onTime ? '✅ 准时' : '⚠️ 迟到'}`;
      inBtn.textContent = '✅ 已打卡 ' + ci.time;
      inBtn.style.background = 'var(--green)';
      inBtn.disabled = true;
      outBtn.textContent = '🏠 下班签退';
      outBtn.style.background = 'var(--blue)';
      outBtn.style.display = 'block';
      outBtn.disabled = false;

      const [inH, inM] = ci.time.split(':').map(Number);
      const now = new Date();
      const mins = (now.getHours() * 60 + now.getMinutes()) - (inH * 60 + inM);
      const hours = Math.floor(mins / 60);
      const remainMins = mins % 60;
      workInfo.textContent = `⏱ 已工作：${hours}小时${remainMins}分钟`;
    }
  } else {
    // Not checked in yet
    const [h, m] = workTime.split(':');
    const d = new Date(); d.setHours(parseInt(h), parseInt(m), 0);
    if (new Date() > d) {
      status.innerHTML = '<span class="checkin-dot miss"></span> ⚠️ 已过上班时间，请尽快打卡';
    } else {
      status.innerHTML = '<span style="color:var(--sub)">还未打卡</span>';
    }
    inBtn.textContent = '✅ 上班打卡';
    inBtn.style.background = 'var(--accent)';
    inBtn.disabled = false;
    outBtn.style.display = 'none';
    workInfo.textContent = '';
  }

  // Recent checkins
  const recent = checkins.sort((a, b) => b.timestamp - a.timestamp).slice(0, 7);
  document.getElementById('checkinHistory').innerHTML = recent.length === 0
    ? '<div style="color:var(--sub);font-size:13px">暂无记录</div>'
    : recent.map(c => {
        const line = `${c.date} ${c.dayOfWeek} 上班 ${c.time}` + (c.checkoutTime ? ` → 下班 ${c.checkoutTime}` : '');
        const onTime = c.time <= workTime;
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--sep);font-size:14px"><span>${line}</span><span style="color:${onTime ? 'var(--green)' : 'var(--orange)'};font-size:12px">${onTime ? '准时' : '迟到'}</span></div>`;
      }).join('');
  renderTodaySchedule();
}

// ============= HELPERS =============
function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
