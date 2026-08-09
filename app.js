// SmartNotes PWA v5
const DB_NAME='smartnotes',DB_VER=5;
let db,currentFolder=null,editingNoteId=null,viewingNoteId=null,isEditingDetail=false;
let reminderSwiped=null;
// Drag state
let dragNoteId=null,dragGhost=null,dragStartTime=0,dragLongPressTimer=null;
let dragStartX=0,dragStartY=0,dragCurrentFolder=null;

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VER);r.onupgradeneeded=e=>{const d=e.target.result;['notes','categories','reminders','checkins','schedule','settings','folders'].forEach(s=>{if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:s==='settings'?'key':'id',autoIncrement:s!=='settings'})})};r.onsuccess=e=>{db=e.target.result;resolve(db)};r.onerror=()=>reject(r.error)})}
function tx(s,m='readonly'){return db.transaction(s,m).objectStore(s)}
function sput(s,d){return new Promise((res,rej)=>{const r=tx(s,'readwrite').put(d);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function sall(s){return new Promise((res,rej)=>{const r=tx(s).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function sget(s,id){return new Promise((res,rej)=>{const r=tx(s).get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function sdel(s,id){return new Promise((res,rej)=>{const r=tx(s,'readwrite').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function sclr(s){return new Promise((res,rej)=>{const r=tx(s,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}

async function init(){
  await openDB();
  const cats=await sall('categories');
  if(!cats.length) for(const n of ['📝 工作笔记','👤 个人笔记','📋 会议记录','🔌 EMC检测','📁 项目文件']) await sput('categories',{name:n});
  await renderNotes();
  await renderReminders();
  setInterval(checkReminders,60000);
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
}

function switchPage(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const tp=document.getElementById('page-'+page);if(tp)tp.classList.add('active');
  const nav=document.querySelector('[data-page="'+page+'"]');if(nav)nav.classList.add('active');
  const titles={notes:'📒 笔记',reminders:'⏰ 提醒',settings:'⚙️ 设置'};
  document.getElementById('headerTitle').textContent=titles[page]||'SmartNotes';
  const isDetail=(page==='note-detail');
  document.getElementById('nav').style.display=isDetail?'none':'flex';
  document.getElementById('headerTitle').style.display=isDetail?'none':'';
  const fab=document.getElementById('fabContainer');if(fab)fab.classList.toggle('hidden',page!=='notes');
  if(page==='notes'){currentFolder=null;renderNotes()}
  if(page==='reminders')renderReminders();
  if(page==='settings')renderSettings();
}

// ========= NOTES LIST =========
async function renderNotes(){
  try{
    const folders=(await sall('folders')).filter(f=>f.parentId===currentFolder);
    const allNotes=(await sall('notes')).filter(n=>n.folderId===currentFolder);
    const cats=await sall('categories');
    const query=(document.getElementById('searchInput')?.value||'').trim().toLowerCase();

    // Breadcrumb + Category filter + Back button
    let backBtn='';
    if(currentFolder){
      const cur=await sget('folders',currentFolder);
      const parentId=cur?cur.parentId:null;
      backBtn='<button onclick="navigateToFolder('+(parentId||'null')+')" style="background:var(--card);border:1px solid var(--sep);border-radius:8px;padding:6px 12px;color:var(--accent);font-size:14px;cursor:pointer;margin-right:6px;white-space:nowrap">← 返回</button>';
    }
    let bc='<span class="tag selected" onclick="navigateToFolder(null)">🏠 全部</span>';
    if(currentFolder){
      const ancestors=await getPath(currentFolder);
      ancestors.forEach(f=>{bc+=' <span style="color:var(--sub)">›</span> <span class="tag" onclick="navigateToFolder('+f.id+')">'+esc(f.name)+'</span>'});
    }
    bc=backBtn+bc;
    let catHTML='<div style="display:flex;gap:6px;overflow-x:auto;flex-wrap:wrap">';
    catHTML+=cats.map(c=>'<span class="tag" onclick="filterByCat('+c.id+')">'+esc(c.name)+'</span>').join('');
    catHTML+='</div>';
    document.getElementById('categoryFilter').innerHTML=bc+catHTML;

    // Filter notes by search
    let notes=allNotes;
    if(query){
      notes=notes.filter(n=>(n.title||'').toLowerCase().includes(query)||(n.content||'').toLowerCase().includes(query));
    }
    notes.sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));

    let html='';
    if(folders.length){
      html+='<div style="font-size:12px;color:var(--sub);margin:4px 0 8px">📁 文件夹</div>';
      html+=folders.map(f=>{const fcat=cats.find(c=>c.id===f.categoryId);const fid='f'+f.id;return'<div class="swipe-wrapper" id="swipe-'+fid+'"><div class="swipe-content card folder-card" data-folder-id="'+f.id+'" style="cursor:pointer;display:flex;align-items:center;gap:10px;margin-bottom:0" onclick="navigateToFolder('+f.id+')" ontouchstart="touchStart(event,\''+fid+'\')" ontouchmove="touchMove(event,\''+fid+'\')" ontouchend="touchEnd(event,\''+fid+'\')"><div style="font-size:24px">📁</div><div style="flex:1;font-weight:500">'+esc(f.name)+'</div>'+(fcat?'<span class="tag">'+esc(fcat.name)+'</span>':'')+'</div><div class="swipe-delete" onclick="deleteFolder('+f.id+')">删除</div></div>'}).join('');
    }
    if(notes.length){
      var noteLabel='📝 笔记';
      if(query)noteLabel+=' ('+notes.length+'条)';
      html+='<div style="font-size:12px;color:var(--sub);margin:12px 0 8px">'+noteLabel+'</div>';
      html+=notes.map(n=>{
        const imgs=n.images||(n.image?[n.image]:[]);
        const cat=cats.find(c=>c.id===n.categoryId);
        const hasFile=n.fileName?'📄 ':'';
        return '<div class="swipe-wrapper" id="swipe-'+n.id+'" data-note-id="'+n.id+'"><div class="swipe-content card" style="cursor:pointer;margin-bottom:0" onclick="openNoteDetail('+n.id+')" ontouchstart="touchStart(event,'+n.id+')" ontouchmove="touchMove(event,'+n.id+')" ontouchend="touchEnd(event,'+n.id+')"><div style="display:flex;justify-content:space-between;align-items:start"><div style="font-weight:600;margin-bottom:4px;flex:1">'+hasFile+esc(n.title||'无标题')+'</div>'+(cat?'<span class="tag">'+esc(cat.name)+'</span>':'')+'</div><div style="font-size:13px;color:var(--sub);line-height:1.5;max-height:45px;overflow:hidden">'+esc((n.fileName&&n.fileName.endsWith('.docx')?stripHtml(n.content||''):(n.content||'')).substring(0,120))+'</div>'+(imgs.length?'<div style="margin-top:8px;display:flex;gap:4px;overflow-x:auto">'+imgs.slice(0,4).map(img=>'<img src="'+img+'" style="width:50px;height:50px;border-radius:6px;object-fit:cover">').join('')+(imgs.length>4?'<span style="font-size:12px;color:var(--sub);align-self:center">+'+String(imgs.length-4)+'</span>':'')+'</div>':'')+'<div style="font-size:11px;color:var(--sub);margin-top:6px">'+formatDate(n.updatedAt||n.createdAt)+'</div></div><div class="swipe-delete" onclick="deleteNote('+n.id+')">删除</div></div>';
      }).join('');
    }
    document.getElementById('notesList').innerHTML=html;
    document.getElementById('notesEmpty').style.display=(!folders.length&&!notes.length)?'block':'none';
  }catch(e){console.error(e)}
}

let touchStartX=0,touchCurrentId=null;
function touchStart(e,id){
  touchStartX=e.touches[0].clientX;
  dragStartX=e.touches[0].clientX;
  dragStartY=e.touches[0].clientY;
  touchCurrentId=id;
  dragStartTime=Date.now();
  dragNoteId=null;
  if(dragLongPressTimer)clearTimeout(dragLongPressTimer);
  dragLongPressTimer=setTimeout(()=>{
    // Long press triggered — start drag mode
    startDrag(id,dragStartX,dragStartY);
  },500);
}
function touchMove(e,id){
  const dx=e.touches[0].clientX-touchStartX;
  const dy=e.touches[0].clientY-dragStartY;
  const dist=Math.abs(dx)+Math.abs(dy);

  if(dragNoteId){
    // Drag mode: move ghost, highlight folder targets
    e.preventDefault();
    updateDrag(e.touches[0].clientX,e.touches[0].clientY);
    return;
  }

  // Not in drag mode yet — if moved enough, cancel long-press
  if(dist>15&&dragLongPressTimer){
    clearTimeout(dragLongPressTimer);dragLongPressTimer=null;
  }

  // Standard swipe-to-delete (horizontal only)
  if(dragLongPressTimer){
    // Still waiting for long-press, don't swipe yet
    const el2=document.getElementById('swipe-'+id);if(el2)el2.querySelector('.swipe-content').style.transform='translateX(0)';
    return;
  }
  const el=document.getElementById('swipe-'+id);if(!el)return;
  if(dx<-20){el.querySelector('.swipe-content').style.transform='translateX(-80px)'}
  else{el.querySelector('.swipe-content').style.transform='translateX(0)'}
}
function touchEnd(e,id){
  if(dragLongPressTimer){clearTimeout(dragLongPressTimer);dragLongPressTimer=null;}

  if(dragNoteId){
    // End drag: move note to target folder if any
    endDrag();
    return;
  }

  // Standard swipe-to-delete
  const el=document.getElementById('swipe-'+id);if(!el)return;
  const dx=(e.changedTouches[0]?.clientX||0)-touchStartX;
  if(dx<-60){el.querySelector('.swipe-content').style.transform='translateX(-80px)'}
  else{el.querySelector('.swipe-content').style.transform='translateX(0)'}
}

// ========= DRAG HELPERS =========
function startDrag(id,x,y){
  if(dragLongPressTimer){clearTimeout(dragLongPressTimer);dragLongPressTimer=null;}
  dragNoteId=id;
  const wrapper=document.getElementById('swipe-'+id);
  if(!wrapper)return;
  const card=wrapper.querySelector('.swipe-content');
  // Reset any swipe translation
  card.style.transform='translateX(0)';
  // Dim the original
  card.classList.add('note-dragging');
  // Create ghost
  const rect=card.getBoundingClientRect();
  const ghost=card.cloneNode(true);
  ghost.className='note-ghost';
  ghost.style.width=rect.width+'px';
  ghost.style.left=(x-rect.width/2)+'px';
  ghost.style.top=(y-rect.height/2)+'px';
  document.body.appendChild(ghost);
  dragGhost=ghost;
  dragCurrentFolder=null;
  if(navigator.vibrate)navigator.vibrate(10);
}
function updateDrag(x,y){
  if(!dragGhost)return;
  const rect=dragGhost.getBoundingClientRect();
  dragGhost.style.left=(x-rect.width/2)+'px';
  dragGhost.style.top=(y-rect.height/2)+'px';
  // Hit-test for folder targets
  dragGhost.style.display='none';
  const el=document.elementFromPoint(x,y);
  dragGhost.style.display='';
  // Find nearest folder card ancestor
  let folderCard=el?el.closest('.folder-card'):null;
  // Clear previous highlights
  document.querySelectorAll('.folder-drop-target').forEach(f=>f.classList.remove('folder-drop-target'));
  if(folderCard){
    folderCard.classList.add('folder-drop-target');
    dragCurrentFolder=parseInt(folderCard.getAttribute('data-folder-id'));
  }else{
    dragCurrentFolder=null;
  }
}
async function endDrag(){
  if(dragGhost){dragGhost.remove();dragGhost=null;}
  const wrapper=document.getElementById('swipe-'+dragNoteId);
  if(wrapper){
    const card=wrapper.querySelector('.swipe-content');
    if(card)card.classList.remove('note-dragging');
  }
  // Clear folder highlights
  document.querySelectorAll('.folder-drop-target').forEach(f=>f.classList.remove('folder-drop-target'));
  // Move note if dropped on a folder
  if(dragCurrentFolder!==null&&dragNoteId){
    const note=await sget('notes',dragNoteId);
    if(note){
      note.folderId=dragCurrentFolder;
      note.updatedAt=Date.now();
      await sput('notes',note);
    }
    await renderNotes();
  }
  dragNoteId=null;dragCurrentFolder=null;
}

async function deleteNote(id){if(!confirm('确定删除这条笔记？'))return;await sdel('notes',id);await renderNotes()}

async function filterByCat(catId){
  const folders=(await sall('folders')).filter(f=>f.categoryId===catId&&f.parentId===currentFolder);
  const notes=(await sall('notes')).filter(n=>n.categoryId===catId&&n.folderId===currentFolder).sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  const cats=await sall('categories');const cat=cats.find(c=>c.id===catId);
  let html='<div style="font-size:12px;color:var(--sub);margin:8px 0">筛选：'+esc(cat?cat.name:'')+' <span class="tag" onclick="renderNotes()">✕ 清除</span></div>';
  if(folders.length){
    html+='<div style="font-size:12px;color:var(--sub);margin:4px 0 8px">📁 文件夹</div>';
    html+=folders.map(f=>{const fcat=cats.find(c=>c.id===f.categoryId);return'<div class="swipe-wrapper"><div class="swipe-content card folder-card" data-folder-id="'+f.id+'" style="cursor:pointer;display:flex;align-items:center;gap:10px;margin-bottom:0" onclick="navigateToFolder('+f.id+')"><div style="font-size:24px">📁</div><div style="flex:1;font-weight:500">'+esc(f.name)+'</div>'+(fcat?'<span class="tag">'+esc(fcat.name)+'</span>':'')+'</div></div>'}).join('');
  }
  if(notes.length){
    html+=notes.map(n=>{const imgs=n.images||[];return'<div class="card" style="cursor:pointer" onclick="openNoteDetail('+n.id+')"><div style="font-weight:600">'+esc(n.title||'无标题')+'</div><div style="font-size:13px;color:var(--sub);line-height:1.5">'+esc((n.fileName&&n.fileName.endsWith('.docx')?stripHtml(n.content||''):(n.content||'')).substring(0,120))+'</div></div>'}).join('');
  }
  if(!folders.length&&!notes.length)html+='<div class="empty-state"><p>该分类下暂无内容</p></div>';
  document.getElementById('notesList').innerHTML=html;
  document.getElementById('notesEmpty').style.display='none';
}

function navigateToFolder(id){currentFolder=id;renderNotes()}
async function getPath(fid){const r=[];let c=fid;while(c){const f=await sget('folders',c);if(!f||!f.parentId)break;const p=await sget('folders',f.parentId);if(!p)break;r.unshift(p);c=p.id}const s=await sget('folders',fid);if(s)r.push(s);return r}

// ========= FOLDERS =========
async function newFolder(){
  document.getElementById('folderName').value='';
  folderCatSelected=null;
  renderFolderCatPicker();
  document.getElementById('folderOverlay').classList.add('show');
  document.getElementById('folderSheet').classList.add('open');
  setTimeout(()=>document.getElementById('folderName').focus(),300);
}
let folderCatSelected=null;
async function renderFolderCatPicker(){
  const cats=await sall('categories');
  document.getElementById('folderCatPicker').innerHTML=cats.map(c=>'<span class="tag '+(c.id===folderCatSelected?'selected':'')+'" onclick="folderCatSelected='+c.id+';renderFolderCatPicker()">'+esc(c.name)+'</span>').join('');
}
function hideFolderSheet(){
  document.getElementById('folderOverlay').classList.remove('show');
  document.getElementById('folderSheet').classList.remove('open');
}
async function saveFolder(){
  const name=document.getElementById('folderName').value.trim();
  if(!name)return;
  await sput('folders',{name:name,parentId:currentFolder,categoryId:folderCatSelected,createdAt:Date.now()});
  hideFolderSheet();
  await renderNotes();
}
async function deleteFolder(id){const subs=(await sall('folders')).filter(f=>f.parentId===id);const notes=(await sall('notes')).filter(n=>n.folderId===id);if((subs.length+notes.length)>0&&!confirm('包含'+subs.length+'个子文件夹和'+notes.length+'个笔记，确定删除？'))return;for(const f of subs)await deleteFolder(f.id);for(const n of notes)await sdel('notes',n.id);await sdel('folders',id);await renderNotes()}

// ========= NOTE EDITOR =========
async function newNote(){
  editingNoteId=null;
  document.getElementById('noteTitle').value='';
  document.getElementById('noteContent').value='';
  document.getElementById('noteImages').innerHTML='';
  document.getElementById('noteImages').setAttribute('data-images','[]');
  document.getElementById('noteFileInfo').textContent='';
  document.getElementById('noteFileInfo').setAttribute('data-file','');
  showImagePicker();
  await renderCatPicker(null);
  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}
function hideNoteSheet(){
  document.getElementById('noteOverlay').classList.remove('show');
  document.getElementById('noteSheet').classList.remove('open');
}
async function renderCatPicker(selectedId){
  const cats=await sall('categories');
  document.getElementById('noteCategorySelect').innerHTML=cats.map(c=>'<span class="tag '+(c.id===selectedId?'selected':'')+'" data-cid="'+c.id+'" onclick="pickCat(this)">'+esc(c.name)+'</span>').join('');
}
function pickCat(el){document.querySelectorAll('#noteCategorySelect .tag').forEach(t=>t.classList.remove('selected'));el.classList.add('selected')}
function showImagePicker(images){
  images=images||[];const c=document.getElementById('noteImages');
  c.setAttribute('data-images',JSON.stringify(images));
  c.innerHTML=images.map((img,i)=>'<div style="position:relative;display:inline-block;margin:4px"><img src="'+img+'" style="width:80px;height:80px;border-radius:8px;object-fit:cover"><button onclick="removePic('+i+')" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:11px;background:var(--red);color:#fff;border:none;font-size:12px;cursor:pointer">✕</button></div>').join('');
  c.innerHTML+='<label style="display:inline-block;width:80px;height:80px;border:2px dashed var(--sep);border-radius:8px;cursor:pointer;text-align:center;line-height:80px;color:var(--sub);font-size:28px;margin:4px">+<input type="file" accept="image/*" multiple style="display:none" onchange="addPics(event)"></label>';
}
function addPics(e){const files=Array.from(e.target.files);if(!files.length)return;const c=document.getElementById('noteImages');let images=JSON.parse(c.getAttribute('data-images')||'[]');let loaded=0;files.forEach(file=>{const r=new FileReader();r.onload=ev=>{images.push(ev.target.result);loaded++;if(loaded===files.length)showImagePicker(images)};r.readAsDataURL(file)})}
function removePic(i){const c=document.getElementById('noteImages');let images=JSON.parse(c.getAttribute('data-images')||'[]');images.splice(i,1);showImagePicker(images)}

// File attachment (Word/PDF) - extract text inline
function attachFile(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
    const info=document.getElementById('noteFileInfo');
    const sizeMB=(file.size/1024/1024).toFixed(1);
    const base64=ev.target.result;
    info.textContent='📄 '+file.name+' ('+sizeMB+' MB) - 正在提取内容...';
    info.setAttribute('data-file',JSON.stringify({name:file.name,type:file.type,data:base64,size:file.size}));

    // Extract text from Word/PDF for inline display
    try{
      if(file.name.endsWith('.docx')&&typeof mammoth!=='undefined'){
        const raw=atob(base64.split(',')[1]);const bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        const result=await mammoth.extractRawText({arrayBuffer:bytes.buffer});
        const text=result.value.trim();
        if(text){
          const content=document.getElementById('noteContent');
          content.value=(content.value+'\\n\\n--- '+file.name+' ---\\n'+text).trim();
          info.textContent='📄 '+file.name+' ('+sizeMB+' MB) - 内容已提取到正文';
        }
      }else if(file.name.endsWith('.pdf')){
        // For PDF, show preview in detail; text extraction needs pdf.js
        info.textContent='📄 '+file.name+' ('+sizeMB+' MB) - PDF已附加，点击笔记查看';
      }
    }catch(ex){
      info.textContent='📄 '+file.name+' ('+sizeMB+' MB) - 已附加（内容提取失败）';
    }
  };
  reader.readAsDataURL(file);
}

async function saveNote(){
  const title=document.getElementById('noteTitle').value.trim();
  const content=document.getElementById('noteContent').value.trim();
  const images=JSON.parse(document.getElementById('noteImages').getAttribute('data-images')||'[]');
  const fileInfo=document.getElementById('noteFileInfo').getAttribute('data-file');
  const sel=document.querySelector('#noteCategorySelect .tag.selected');
  const catId=sel?parseInt(sel.dataset.cid):null;
  const fileData=fileInfo?JSON.parse(fileInfo):null;
  const note={title,content,images:images.length>0?images:undefined,folderId:currentFolder,categoryId:catId,updatedAt:Date.now()};
  if(fileData){note.fileName=fileData.name;note.fileType=fileData.type;note.fileData=fileData.data;note.fileSize=fileData.size}
  if(editingNoteId){const ex=await sget('notes',editingNoteId);if(ex){note.createdAt=ex.createdAt;note.id=editingNoteId;await sput('notes',note)}}
  else{note.createdAt=Date.now();await sput('notes',note)}
  hideNoteSheet();await renderNotes();
}

async function editNote(id){
  const note=await sget('notes',id);if(!note)return;
  editingNoteId=id;
  document.getElementById('noteTitle').value=note.title||'';
  document.getElementById('noteContent').value=note.content||'';
  showImagePicker(note.images||(note.image?[note.image]:[]));
  if(note.fileName){document.getElementById('noteFileInfo').textContent='📄 '+note.fileName;document.getElementById('noteFileInfo').setAttribute('data-file',JSON.stringify({name:note.fileName,type:note.fileType,data:note.fileData,size:note.fileSize}))}
  else{document.getElementById('noteFileInfo').textContent='';document.getElementById('noteFileInfo').setAttribute('data-file','')}
  await renderCatPicker(note.categoryId);
  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}

// ========= NOTE DETAIL (bottom toolbar) =========
async function openNoteDetail(id){
  try{
    const note=await sget('notes',id);if(!note){alert('笔记不存在');return}
    viewingNoteId=id;isEditingDetail=false;
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    const dp=document.getElementById('page-note-detail');dp.style.display='block';dp.classList.add('active');
    document.getElementById('nav').style.display='none';
    document.getElementById('headerTitle').style.display='none';
    const fab=document.getElementById('fabContainer');if(fab)fab.classList.add('hidden');
    renderDetailView(note);
  }catch(e){
    alert('打开笔记出错: '+e.message);
    console.error(e);
  }
}
function renderDetailView(note){
  try{
    const isDocx=note.fileName&&note.fileName.endsWith('.docx');
    const isPdf=note.fileName&&note.fileName.endsWith('.pdf');
    document.getElementById('noteDetailMeta').textContent=formatDate(note.updatedAt||note.createdAt);
    document.getElementById('noteDetailTitle').textContent=note.title||'无标题';
    document.getElementById('noteDetailTitle').contentEditable='false';
    const body=document.getElementById('noteDetailBody');
    const imgsDiv=document.getElementById('noteDetailImages');
    const fileDiv=document.getElementById('noteDetailFile');
    const toolbar=document.getElementById('detailToolbar');

    if(isPdf){
      // PDF: show button to open in native viewer
      body.style.display='none';
      imgsDiv.style.display='none';
      document.getElementById('noteDetailTitle').style.display='none';
      document.getElementById('noteDetailMeta').style.display='none';
      try{
        const raw=atob(note.fileData.split(',')[1]||'');
        const bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        const blob=new Blob([bytes],{type:'application/pdf'});
        const url=URL.createObjectURL(blob);
        // Store URL on the button element so onclick can access it
        fileDiv.innerHTML='<div class="pdf-viewer-btn" id="pdfOpenBtn" data-pdf-url="'+url+'"><div class="pdf-icon">📄</div><div class="pdf-name">'+esc(note.fileName)+'</div><div class="pdf-hint">👆 点击使用系统阅读器全屏查看</div></div>';
        document.getElementById('pdfOpenBtn').onclick=function(){
          const a=document.createElement('a');
          a.href=this.getAttribute('data-pdf-url');
          a.target='_blank';
          a.rel='noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        };
        toolbar.innerHTML='<button style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;padding:10px 20px" onclick="deleteFromDetail()">🗑️ 删除</button>';
        toolbar.style.display='flex';
        return;
      }catch(e){
        fileDiv.innerHTML='<div style="color:var(--sub);padding:20px">📄 '+esc(note.fileName)+' - 无法预览</div>';
      }
    }else{
      // Restore normal layout for non-PDF notes
      body.style.display='';
      imgsDiv.style.display='';
      document.getElementById('noteDetailTitle').style.display='';
      document.getElementById('noteDetailMeta').style.display='';
      // Reset toolbar
      toolbar.innerHTML='<button style="background:none;border:none;color:var(--blue);font-size:14px;cursor:pointer;padding:10px 20px" onclick="toggleEditDetail()">✏️ 编辑</button><button style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;padding:10px 20px" onclick="deleteFromDetail()">🗑️ 删除</button>';
    }

    // Render body for non-PDF
    if(!isPdf){
      const isHtml=note.content&&note.content.includes('<');
      if(isHtml){
        body.className=isDocx?'word-content':'';
        body.style.whiteSpace='normal';
        body.innerHTML=note.content;
      } else {
        body.className='';
        body.style.whiteSpace='pre-wrap';
        body.textContent=note.content||'(无内容)';
      }
      body.contentEditable='false';
      const imgs=note.images||(note.image?[note.image]:[]);
      imgsDiv.innerHTML=imgs.length?imgs.map(img=>'<img src="'+img+'" onclick="fullImg(this.src)" style="width:100%;border-radius:12px;margin:6px 0;max-height:400px;object-fit:contain;background:#111;cursor:pointer">').join(''):'';
    }

    // File preview for non-PDF notes
    if(!isPdf&&note.fileName&&note.fileData){
      try{
        if(isDocx){
          fileDiv.innerHTML='<div style="border-top:1px solid var(--sep);margin:16px 0 8px;padding-top:12px;display:flex;align-items:center;gap:8px"><span style="font-size:13px;color:var(--sub)">📄 原始文件: '+esc(note.fileName)+'</span><button class="btn-sm" onclick="downloadFile('+note.id+')" style="font-size:12px">⬇ 下载</button></div>';
        } else {
          fileDiv.innerHTML='<div style="color:var(--sub);padding:8px 0">📄 '+esc(note.fileName)+' <button class="btn-sm" onclick="downloadFile('+note.id+')" style="font-size:12px">⬇ 下载</button></div>';
        }
      }catch(e){
        fileDiv.innerHTML='<div style="color:var(--sub)">📄 '+esc(note.fileName)+'</div>';
      }
    }else if(!isPdf&&note.fileName){
      fileDiv.innerHTML='<div style="color:var(--sub)">📄 '+esc(note.fileName)+'</div>';
    }else if(!isPdf){
      fileDiv.innerHTML='';
    }

    toolbar.style.display='flex';
  }catch(e){
    console.error('renderDetailView error:',e);
    document.getElementById('noteDetailBody').textContent='(渲染出错: '+e.message+')';
  }
}
async function toggleEditDetail(){
  if(!viewingNoteId)return;
  if(isEditingDetail){
    const note=await sget('notes',viewingNoteId);if(!note)return;
    note.title=document.getElementById('noteDetailTitle').textContent.trim();
    const isHtmlNote=note.content&&note.content.includes('<');
    note.content=isHtmlNote?document.getElementById('noteDetailBody').innerHTML.trim():document.getElementById('noteDetailBody').textContent.trim();
    note.updatedAt=Date.now();
    await sput('notes',note);
    isEditingDetail=false;
    document.getElementById('noteDetailTitle').contentEditable='false';
    document.getElementById('noteDetailBody').contentEditable='false';
    renderDetailView(note);
    renderNotes();
  }else{
    isEditingDetail=true;
    document.getElementById('noteDetailTitle').contentEditable='true';
    document.getElementById('noteDetailBody').contentEditable='true';
    document.getElementById('noteDetailTitle').focus();
  }
}
function closeNoteDetail(){
  viewingNoteId=null;isEditingDetail=false;
  document.getElementById('page-note-detail').style.display='none';
  document.getElementById('page-note-detail').classList.remove('active');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-notes');if(pg)pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const navItem=document.querySelector('[data-page="notes"]');if(navItem)navItem.classList.add('active');
  // Restore elements that PDF view hides
  document.getElementById('noteDetailTitle').style.display='';
  document.getElementById('noteDetailMeta').style.display='';
  const body=document.getElementById('noteDetailBody');
  body.style.display='';body.className='';body.style.whiteSpace='pre-wrap';
  document.getElementById('noteDetailImages').style.display='';
  document.getElementById('noteDetailFile').innerHTML='';
  document.getElementById('detailToolbar').innerHTML='<button style="background:none;border:none;color:var(--blue);font-size:14px;cursor:pointer;padding:10px 20px" onclick="toggleEditDetail()">✏️ 编辑</button><button style="background:none;border:none;color:var(--red);font-size:14px;cursor:pointer;padding:10px 20px" onclick="deleteFromDetail()">🗑️ 删除</button>';
  document.getElementById('headerTitle').textContent='📒 笔记';
  document.getElementById('nav').style.display='flex';
  document.getElementById('headerTitle').style.display='';
  const fab=document.getElementById('fabContainer');if(fab)fab.classList.remove('hidden');
  renderNotes(); // preserve currentFolder context
}
function deleteFromDetail(){if(viewingNoteId&&confirm('确定删除？')){sdel('notes',viewingNoteId);viewingNoteId=null;closeNoteDetail()}}
function fullImg(src){const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;display:flex;align-items:center;justify-content:center';d.innerHTML='<img src="'+src+'" style="max-width:100%;max-height:100%;object-fit:contain">';d.onclick=()=>d.remove();document.body.appendChild(d)}
async function downloadFile(id){const note=await sget('notes',id);if(!note||!note.fileData)return;const a=document.createElement('a');a.href=note.fileData;a.download=note.fileName||'file';a.click()}

// ========= REMINDERS (Task-style, no time) =========
async function renderReminders(){
  const reminders=await sall('reminders');
  document.getElementById('remindersEmpty').style.display=reminders.length?'none':'block';
  document.getElementById('remindersList').innerHTML=reminders.length?reminders.map(r=>'<div class="reminder-row" id="rem-'+r.id+'"><div class="check-circle'+(r.done?' done':'')+'" onclick="toggleReminder('+r.id+')"></div><span class="reminder-text'+(r.done?' done':'')+'">'+esc(r.title)+'</span><button style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:4px 8px" onclick="deleteReminder('+r.id+')">✕</button></div>').join(''):'';
}
async function addReminder(){
  const title=prompt('输入任务内容：');
  if(!title||!title.trim())return;
  await sput('reminders',{title:title.trim(),done:false,createdAt:Date.now()});
  await renderReminders();
}
async function toggleReminder(id){
  const r=await sget('reminders',id);if(!r)return;
  r.done=!r.done;await sput('reminders',r);
  await renderReminders();
}
async function deleteReminder(id){await sdel('reminders',id);await renderReminders()}
async function completeAllReminders(){
  if(!confirm('确定将所有任务标记为未完成？'))return;
  const reminders=await sall('reminders');
  for(const r of reminders){r.done=false;await sput('reminders',r)}
  await renderReminders();
}
function hideReminderSheet(){document.getElementById('reminderOverlay').classList.remove('show');document.getElementById('reminderSheet').classList.remove('open')}
async function saveReminder(){
  const title=document.getElementById('reminderTitle').value.trim();
  if(!title)return;
  await sput('reminders',{title,done:false,createdAt:Date.now()});
  hideReminderSheet();await renderReminders();
}

function checkReminders(){/* simplified - no time-based notifications needed */}

// ========= WORD/PDF IMPORT =========
async function importWordDocs(e){
  const files=Array.from(e.target.files);if(!files.length)return;
  const status=document.getElementById('wordImportStatus');
  const total=files.length;let done=0,failed=0;
  status.textContent='⏳ 正在导入 0/'+total+' ...';
  for(const file of files){
    try{
      const isDocx=file.name.endsWith('.docx');
      const isPdf=file.name.endsWith('.pdf');
      if(!isDocx&&!isPdf){failed++;done++;continue}
      const buf=await file.arrayBuffer();
      let content='';
      if(isDocx){
        try{
          if(typeof mammoth!=='undefined'){
            const options={
              styleMap: [
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh",
                "r[style-name='Strong'] => strong",
                "r[style-name='Emphasis'] => em",
                "r[style-name='Underline'] => u",
                "p[style-name='List Paragraph'] => p.list-paragraph:fresh"
              ]
            };
            if(mammoth.images&&mammoth.images.imgElement){
              options.convertImage=mammoth.images.imgElement(function(image){
                return image.read("base64").then(function(buf){
                  return {src:"data:"+image.contentType+";base64,"+buf};
                });
              });
            }
            const result=await mammoth.convertToHtml({arrayBuffer:buf},options);
            content=result.value.trim();
          }
        }catch(ex){}
      }
      // PDF: don't extract text, just store the file for full-screen viewing
      const base64=await new Promise((res,rej)=>{
        const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);
      });
      const title=file.name.replace(/\.(docx|pdf)$/i,'');
      await sput('notes',{
        title:title,
        content:content||(isDocx?'<p>(未能提取文档内容)</p>':''),
        fileName:file.name,
        fileType:isDocx?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf',
        fileData:base64,
        fileSize:file.size,
        folderId:null,
        categoryId:null,
        createdAt:Date.now(),
        updatedAt:Date.now()
      });
      done++;
      status.textContent='⏳ 正在导入 '+done+'/'+total+' ...';
    }catch(ex){
      failed++;done++;
      status.textContent='⏳ 正在导入 '+done+'/'+total+' (已有'+failed+'个失败)...';
    }
  }
  const ok=total-failed;
  status.textContent='✅ 成功导入 '+ok+' 条笔记'+(failed?'，'+failed+' 个失败':'')+'！';
  await renderNotes();
  e.target.value='';
}
// ========= UNIFIED FILE IMPORT (notes page quick button) =========
async function importFilesQuick(e){
  const files=Array.from(e.target.files);if(!files.length)return;
  let done=0,failed=0;const total=files.length;
  for(const file of files){
    try{
      const name=file.name.toLowerCase();
      const isDocx=name.endsWith('.docx');
      const isPdf=name.endsWith('.pdf');
      const isExcel=name.endsWith('.xlsx')||name.endsWith('.xls')||name.endsWith('.csv');
      if(!isDocx&&!isPdf&&!isExcel){failed++;done++;continue}
      const buf=await file.arrayBuffer();
      let content='',fileType='',fileName=file.name;

      if(isDocx){
        fileType='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        try{
          if(typeof mammoth!=='undefined'){
            const options={
              styleMap:[
                "p[style-name='Title'] => h1:fresh",
                "p[style-name='Subtitle'] => h2:fresh",
                "p[style-name='Heading 1'] => h1:fresh",
                "p[style-name='Heading 2'] => h2:fresh",
                "p[style-name='Heading 3'] => h3:fresh",
                "p[style-name='Heading 4'] => h4:fresh",
                "p[style-name='Heading 5'] => h5:fresh",
                "p[style-name='Heading 6'] => h6:fresh",
                "r[style-name='Strong'] => strong",
                "r[style-name='Emphasis'] => em",
                "r[style-name='Underline'] => u",
                "p[style-name='List Paragraph'] => p.list-paragraph:fresh"
              ]
            };
            if(mammoth.images&&mammoth.images.imgElement){
              options.convertImage=mammoth.images.imgElement(function(image){
                return image.read("base64").then(function(buf){
                  return {src:"data:"+image.contentType+";base64,"+buf};
                });
              });
            }
            const result=await mammoth.convertToHtml({arrayBuffer:buf},options);
            content=result.value.trim();
          }
        }catch(ex){}
        if(!content)content='<p>(未能提取文档内容)</p>';
      }else if(isPdf){
        fileType='application/pdf';
        content='';
      }else if(isExcel){
        fileType=name.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        try{
          if(typeof XLSX!=='undefined'){
            const wb=XLSX.read(buf,{type:'array'});
            let tables='';
            const sns=wb.SheetNames;
            if(sns.length>1){
              // Generate tab bar
              tables+='<div class="excel-tabs">';
              sns.forEach((sn,i)=>{
                tables+='<button class="excel-tab'+(i===0?' active':'')+'" onclick="switchExcelSheet(event,\''+esc(sn)+'\')">'+esc(sn)+'</button>';
              });
              tables+='</div>';
            }
            for(let i=0;i<sns.length;i++){
              const ws=wb.Sheets[sns[i]];
              const tbl=XLSX.utils.sheet_to_html(ws,{id:'tbl-'+sns[i],editable:false});
              if(sns.length>1){
                tables+='<div class="excel-sheet'+(i===0?' active':'')+'" data-sheet="'+esc(sns[i])+'">';
              }
              if(sns.length===1)tables+='<h3>📊 '+esc(sns[i])+'</h3>';
              tables+=tbl;
              if(sns.length>1)tables+='</div>';
            }
            content=tables;
          }
        }catch(ex){}
        if(!content)content='<p>(未能解析表格)</p>';
      }

      const base64=await new Promise((res,rej)=>{
        const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);
      });
      const title=file.name.replace(/\.(docx|pdf|xlsx|xls|csv)$/i,'');
      const note={title,content,folderId:currentFolder,categoryId:null,createdAt:Date.now(),updatedAt:Date.now()};
      if(isDocx||isPdf){note.fileName=fileName;note.fileType=fileType;note.fileData=base64;note.fileSize=file.size}
      await sput('notes',note);
      done++;
    }catch(ex){failed++;done++}
  }
  e.target.value='';
  await renderNotes();
  const ok=total-failed;
  if(ok)alert('✅ 已导入 '+ok+' 条笔记'+(failed?'，'+failed+' 个失败':''));
}

// ========= EXCEL SHEET SWITCHER =========
function switchExcelSheet(e,name){
  if(e){e.stopPropagation();e.preventDefault()}
  // Update tabs
  const tabs=document.querySelectorAll('.excel-tab');
  tabs.forEach(t=>t.classList.remove('active'));
  if(e&&e.target)e.target.classList.add('active');
  // Show/hide sheets
  const sheets=document.querySelectorAll('.excel-sheet');
  sheets.forEach(s=>{
    s.style.display=s.getAttribute('data-sheet')===name?'block':'none';
  });
}

// ========= SETTINGS =========
async function renderSettings(){
  const cats=await sall('categories');
  document.getElementById('categoryList').innerHTML=cats.map(c=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--sep);font-size:14px"><span>'+esc(c.name)+'</span><button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px" onclick="sdel(\'categories\','+c.id+').then(()=>renderSettings())">✕</button></div>').join('');
}
async function addCategory(){const n=document.getElementById('newCategoryInput').value.trim();if(!n)return;await sput('categories',{name:n});document.getElementById('newCategoryInput').value='';await renderSettings();await renderNotes()}
async function exportData(){const data={notes:await sall('notes'),folders:await sall('folders'),reminders:await sall('reminders'),exportedAt:new Date().toISOString()};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='smartnotes-backup.json';a.click()}
async function clearAll(){for(const s of['notes','reminders','folders'])await sclr(s);alert('已清除');location.reload()}

// ========= HELPERS =========
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function stripHtml(s){if(!s)return'';const d=document.createElement('div');d.innerHTML=s;return d.textContent||''}
function formatDate(ts){if(!ts)return'';const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
init();
