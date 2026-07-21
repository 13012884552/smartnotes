// SmartNotes PWA v3
const DB_NAME='smartnotes',DB_VER=3;
let db,currentFolder=null,editingNoteId=null,viewingNoteId=null,ocrResultText='';

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
  const st=await sall('settings');
  if(!st.find(s=>s.key==='workStartTime')) await sput('settings',{key:'workStartTime',value:'08:00'});
  await renderNotes();
  updateClock();setInterval(updateClock,30000);
  checkReminders();setInterval(checkReminders,60000);
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
}

function switchPage(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const tp=document.getElementById('page-'+page);
  if(tp)tp.classList.add('active');
  const nav=document.querySelector('[data-page="'+page+'"]');
  if(nav)nav.classList.add('active');
  const titles={notes:'📒 笔记',camera:'📷 拍照识别',checkin:'✅ 打卡',reminders:'⏰ 提醒',settings:'⚙️ 设置'};
  document.getElementById('headerTitle').textContent=titles[page]||'SmartNotes';
  const isDetail=(page==='note-detail');
  document.getElementById('nav').style.display=isDetail?'none':'flex';
  document.getElementById('headerTitle').style.display=isDetail?'none':'';
  const fab=document.getElementById('fabContainer');
  if(page==='notes'){if(fab)fab.classList.remove('hidden');currentFolder=null;renderNotes()}
  else{if(fab)fab.classList.add('hidden')}
  if(page==='checkin')renderCheckin();
  if(page==='reminders')renderReminders();
  if(page==='settings')renderSettings();
}

// (FAB is now two standalone buttons - no toggle needed)

// ========= FOLDERS & NOTES LIST =========
async function renderNotes(){
  try{
    const folders=(await sall('folders')).filter(f=>f.parentId===currentFolder);
    const notes=(await sall('notes')).filter(n=>n.folderId===currentFolder).sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
    // Breadcrumb
    let bc='<span class="tag selected" onclick="navigateToFolder(null)" style="cursor:pointer">🏠 全部</span>';
    if(currentFolder){
      const ancestors=await getPath(currentFolder);
      ancestors.forEach(f=>{bc+=' <span style="color:var(--sub)">›</span> <span class="tag" onclick="navigateToFolder('+f.id+')" style="cursor:pointer">'+esc(f.name)+'</span>'});
    }
    document.getElementById('categoryFilter').innerHTML=bc;

    // Category quick filter
    const cats=await sall('categories');
    let catHTML='<div style="display:flex;gap:6px;overflow-x:auto;padding:8px 0;flex-wrap:wrap" id="catTags">';
    catHTML+=cats.map(c=>'<span class="tag" style="cursor:pointer;white-space:nowrap" onclick="quickFilterCat(\''+esc(c.name)+'\')">'+esc(c.name)+'</span>').join('');
    catHTML+='</div>';
    document.getElementById('categoryFilter').innerHTML+=catHTML;

    let html='';
    // Folders
    if(folders.length){
      html+='<div style="font-size:12px;color:var(--sub);margin:4px 0 8px">📁 文件夹</div>';
      html+=folders.map(f=>'<div class="card" style="cursor:pointer;display:flex;align-items:center;gap:10px" onclick="navigateToFolder('+f.id+')"><div style="font-size:24px">📁</div><div style="flex:1"><div style="font-weight:500">'+esc(f.name)+'</div></div><button style="background:none;border:none;color:var(--red);font-size:16px;padding:8px" onclick="event.stopPropagation();deleteFolder('+f.id+')">✕</button></div>').join('');
    }
    // Notes
    if(notes.length){
      html+='<div style="font-size:12px;color:var(--sub);margin:12px 0 8px">📝 笔记</div>';
      html+=notes.map(n=>{
        const imgs=n.images||(n.image?[n.image]:[]);
        const imgCount=imgs.length;
        return '<div class="card" style="cursor:pointer" onclick="openNoteDetail('+n.id+')"><div style="font-weight:600;margin-bottom:4px">'+esc(n.title||'无标题')+'</div><div style="font-size:13px;color:var(--sub);line-height:1.5;max-height:45px;overflow:hidden">'+esc((n.content||'').substring(0,120))+'</div>'+(imgCount>0?'<div style="margin-top:8px;display:flex;gap:4px;overflow-x:auto">'+imgs.slice(0,4).map(img=>'<img src="'+img+'" style="width:50px;height:50px;border-radius:6px;object-fit:cover">').join('')+(imgCount>4?'<span style="font-size:12px;color:var(--sub);align-self:center">+'+String(imgCount-4)+'</span>':'')+'</div>':'')+'<div style="font-size:11px;color:var(--sub);margin-top:6px">'+formatDate(n.updatedAt||n.createdAt)+'</div></div>';
      }).join('');
    }
    document.getElementById('notesList').innerHTML=html;
    document.getElementById('notesEmpty').style.display=(!folders.length&&!notes.length)?'block':'none';
  }catch(e){console.error('renderNotes error:',e)}
}

function navigateToFolder(id){currentFolder=id;renderNotes()}
async function getPath(fid){const r=[];let c=fid;while(c){const f=await sget('folders',c);if(!f||!f.parentId)break;const p=await sget('folders',f.parentId);if(!p)break;r.unshift(p);c=p.id}const s=await sget('folders',fid);if(s)r.push(s);return r}

function quickFilterCat(name){
  const notes=document.querySelectorAll('#notesList .card');
  // Filter notes by creating a temporary note with category name and searching
  alert('搜索分类: '+name+'\n(完整搜索功能需将分类关联到笔记)');
}

// ========= NEW FOLDER =========
async function newFolder(){
  const name=prompt('输入文件夹名称：');
  if(!name||!name.trim())return;
  await sput('folders',{name:name.trim(),parentId:currentFolder,createdAt:Date.now()});
  await renderNotes();
}

async function deleteFolder(id){
  const subs=(await sall('folders')).filter(f=>f.parentId===id);
  const notes=(await sall('notes')).filter(n=>n.folderId===id);
  if((subs.length+notes.length)>0&&!confirm('此文件夹包含'+subs.length+'个子文件夹和'+notes.length+'个笔记，确定删除？'))return;
  for(const f of subs)await deleteFolder(f.id);
  for(const n of notes)await sdel('notes',n.id);
  await sdel('folders',id);
  await renderNotes();
}

// ========= NEW NOTE =========
async function newNote(){
  editingNoteId=null;
  document.getElementById('noteTitle').value='';
  document.getElementById('noteContent').value='';
  document.getElementById('noteImages').innerHTML='';
  document.getElementById('noteImages').setAttribute('data-images','[]');
  showImagePicker();
  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}

function hideNoteSheet(){
  document.getElementById('noteOverlay').classList.remove('show');
  document.getElementById('noteSheet').classList.remove('open');
}

function showImagePicker(images){
  images=images||[];
  const c=document.getElementById('noteImages');
  c.setAttribute('data-images',JSON.stringify(images));
  let h=images.map((img,i)=>'<div style="position:relative;display:inline-block;margin:4px"><img src="'+img+'" style="width:80px;height:80px;border-radius:8px;object-fit:cover"><button onclick="removePic('+i+')" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:11px;background:var(--red);color:#fff;border:none;font-size:12px;cursor:pointer">✕</button></div>').join('');
  h+='<label style="display:inline-block;width:80px;height:80px;border:2px dashed var(--sep);border-radius:8px;cursor:pointer;text-align:center;line-height:80px;color:var(--sub);font-size:28px;margin:4px">+<input type="file" accept="image/*" multiple style="display:none" onchange="addPics(event)"></label>';
  c.innerHTML=h;
}

function addPics(e){
  const files=Array.from(e.target.files);
  if(!files.length)return;
  const c=document.getElementById('noteImages');
  let images=JSON.parse(c.getAttribute('data-images')||'[]');
  let loaded=0;
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=ev=>{images.push(ev.target.result);loaded++;if(loaded===files.length){showImagePicker(images)}};
    reader.readAsDataURL(file);
  });
}

function removePic(i){
  const c=document.getElementById('noteImages');
  let images=JSON.parse(c.getAttribute('data-images')||'[]');
  images.splice(i,1);
  showImagePicker(images);
}

async function saveNote(){
  const title=document.getElementById('noteTitle').value.trim();
  const content=document.getElementById('noteContent').value.trim();
  const images=JSON.parse(document.getElementById('noteImages').getAttribute('data-images')||'[]');
  const note={title,content,images:images.length>0?images:undefined,folderId:currentFolder,updatedAt:Date.now()};
  if(editingNoteId){
    const ex=await sget('notes',editingNoteId);
    if(ex){note.createdAt=ex.createdAt;note.id=editingNoteId;await sput('notes',note)}
  }else{note.createdAt=Date.now();await sput('notes',note)}
  hideNoteSheet();await renderNotes();
}

async function editNote(id){
  const note=await sget('notes',id);
  if(!note)return;
  editingNoteId=id;
  document.getElementById('noteTitle').value=note.title||'';
  document.getElementById('noteContent').value=note.content||'';
  showImagePicker(note.images||(note.image?[note.image]:[]));
  document.getElementById('noteOverlay').classList.add('show');
  document.getElementById('noteSheet').classList.add('open');
}

// ========= NOTE DETAIL =========
async function openNoteDetail(id){
  const note=await sget('notes',id);
  if(!note)return;
  viewingNoteId=id;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const dp=document.getElementById('page-note-detail');
  dp.style.display='block';dp.classList.add('active');
  document.getElementById('nav').style.display='none';
  document.getElementById('headerTitle').style.display='none';
  const f=document.getElementById('fabContainer');if(f)f.classList.add('hidden');
  document.getElementById('noteDetailDate').textContent=formatDate(note.updatedAt||note.createdAt);
  const imgs=note.images||(note.image?[note.image]:[]);
  document.getElementById('noteDetailContent').innerHTML='<div class="note-detail-title">'+esc(note.title||'无标题')+'</div><div class="note-detail-body">'+esc(note.content||'')+'</div>'+(imgs.length?imgs.map((img,i)=>'<img src="'+img+'" class="note-detail-img" onclick="fullImg(this.src)" style="max-height:400px;object-fit:contain;background:#111">').join(''):'');
}

function closeNoteDetail(){
  document.getElementById('page-note-detail').style.display='none';
  document.getElementById('page-note-detail').classList.remove('active');
  document.getElementById('nav').style.display='flex';
  document.getElementById('headerTitle').style.display='';
  viewingNoteId=null;
  switchPage('notes');
}

function editFromDetail(){if(viewingNoteId){closeNoteDetail();editNote(viewingNoteId)}}
function deleteFromDetail(){if(viewingNoteId&&confirm('确定删除？')){sdel('notes',viewingNoteId);viewingNoteId=null;closeNoteDetail()}}
function fullImg(src){const d=document.createElement('div');d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:999;display:flex;align-items:center;justify-content:center';d.innerHTML='<img src="'+src+'" style="max-width:100%;max-height:100%;object-fit:contain">';d.onclick=()=>d.remove();document.body.appendChild(d)}

// ========= CAMERA / OCR =========
async function handleCamera(e){
  const file=e.target.files[0];
  if(!file)return;
  const preview=document.getElementById('ocrPreview');
  const url=URL.createObjectURL(file);
  preview.innerHTML='<img src="'+url+'" class="photo-preview" style="max-height:250px"><div style="padding:12px;color:var(--sub)">🔍 正在识别文字...</div>';
  try{
    const worker=await Tesseract.recognize(file,'chi_sim+eng',{logger:m=>{if(m.status==='recognizing text')preview.querySelector('div').textContent='🔍 识别中... '+Math.round(m.progress*100)+'%'}});
    ocrResultText=worker.data.text.trim();
    preview.innerHTML='<img src="'+url+'" class="photo-preview" style="max-height:120px"><div class="ocr-result">'+esc(ocrResultText||'(未识别到文字)')+'</div><button class="btn" onclick="saveOCR()" style="margin-top:8px">📝 保存到当前文件夹</button><button class="btn-outline" onclick="document.getElementById(\'ocrPreview\').innerHTML=\'\';ocrResultText=\'\'" style="margin-top:4px;width:100%">取消</button>';
  }catch(err){preview.innerHTML='<div style="color:var(--red);padding:12px">识别失败：'+esc(err.message)+'</div>'}
}

async function saveOCR(){
  if(!ocrResultText)return;
  await sput('notes',{title:ocrResultText.substring(0,40),content:ocrResultText,folderId:currentFolder,createdAt:Date.now(),updatedAt:Date.now()});
  ocrResultText='';
  document.getElementById('ocrPreview').innerHTML='<div style="color:var(--green);padding:20px">✅ 已保存！</div>';
  await renderNotes();
}

// ========= CHECK-IN & CHECK-OUT =========
async function renderCheckin(){
  updateClock();
  const st=await sall('settings');
  const workTime=(st.find(s=>s.key==='workStartTime')||{}).value||'08:00';
  const today=new Date().toISOString().split('T')[0];
  const checkins=await sall('checkins');
  const todayCI=checkins.filter(c=>c.date===today);
  const status=document.getElementById('checkinStatus');
  const inBtn=document.getElementById('checkinBtn');
  const outBtn=document.getElementById('checkoutBtn');
  const workInfo=document.getElementById('todayWorkTime');

  if(todayCI.length>0){
    const ci=todayCI[0];
    if(ci.checkoutTime){
      status.innerHTML='<span class="checkin-dot ok"></span> ✅ 今日已完成';
      inBtn.textContent='✅ '+ci.time;inBtn.style.background='var(--green)';inBtn.disabled=true;
      outBtn.textContent='🏠 '+ci.checkoutTime;outBtn.style.background='var(--green)';outBtn.style.display='block';outBtn.disabled=true;
      const mh=calcMins(ci.time,ci.checkoutTime);
      workInfo.textContent='⏱ 工时：'+Math.floor(mh/60)+'h'+String(mh%60)+'m';
    }else{
      const onTime=ci.time<=workTime;
      status.innerHTML='<span class="checkin-dot '+(onTime?'ok':'late')+'"></span> 已打卡 '+ci.time+' '+(onTime?'✅ 准时':'⚠️ 迟到');
      inBtn.textContent='✅ '+ci.time;inBtn.style.background='var(--green)';inBtn.disabled=true;
      outBtn.textContent='🏠 下班签退';outBtn.style.background='var(--blue)';outBtn.style.display='block';outBtn.disabled=false;
      const mh=calcMins(ci.time);
      workInfo.textContent='⏱ 已工作：'+Math.floor(mh/60)+'h'+String(mh%60)+'m';
    }
  }else{
    const[h,m]=workTime.split(':').map(Number);
    const d=new Date();d.setHours(h,m,0);
    status.innerHTML=new Date()>d?'<span class="checkin-dot miss"></span> ⚠️ 已过上班时间':'<span style="color:var(--sub)">还未打卡</span>';
    inBtn.textContent='✅ 上班打卡';inBtn.style.background='var(--accent)';inBtn.disabled=false;
    outBtn.style.display='none';workInfo.textContent='';
  }

  const recent=checkins.sort((a,b)=>b.timestamp-a.timestamp).slice(0,7);
  document.getElementById('checkinHistory').innerHTML=recent.length?recent.map(c=>{const l=c.date+' '+c.dayOfWeek+' 上班 '+c.time+(c.checkoutTime?' → '+c.checkoutTime:'');const ot=c.time<=workTime;return'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--sep);font-size:14px"><span>'+l+'</span><span style="color:'+(ot?'var(--green)':'var(--orange)')+';font-size:12px">'+(ot?'准时':'迟到')+'</span></div>'}).join(''):'<div style="color:var(--sub);font-size:13px">暂无记录</div>';
  renderTodaySchedule();
}

function calcMins(start,end){const[sH,sM]=start.split(':').map(Number);if(end){const[eH,eM]=end.split(':').map(Number);return(eH*60+eM)-(sH*60+sM)}const now=new Date();return(now.getHours()*60+now.getMinutes())-(sH*60+sM)}

async function doCheckin(){
  const now=new Date();
  const days=['周日','周一','周二','周三','周四','周五','周六'];
  await sput('checkins',{date:now.toISOString().split('T')[0],time:now.toTimeString().slice(0,5),dayOfWeek:days[now.getDay()],timestamp:now.getTime()});
  await renderCheckin();
}

async function doCheckout(){
  const today=new Date().toISOString().split('T')[0];
  const checkins=await sall('checkins');
  const ci=checkins.find(c=>c.date===today);
  if(ci){ci.checkoutTime=new Date().toTimeString().slice(0,5);await sput('checkins',ci)}
  await renderCheckin();
}

async function renderTodaySchedule(){
  const schedule=await sall('schedule');
  const todayStr=new Date().toISOString().split('T')[0];
  const items=schedule.filter(s=>{try{return new Date(s.date).toISOString().split('T')[0]===todayStr}catch(e){return false}});
  document.getElementById('todaySchedule').innerHTML=items.length?items.map(s=>'<div class="schedule-day"><div style="font-weight:500">📍 '+esc(s.location||'未指定')+'</div><div style="font-size:12px;color:var(--sub);margin-top:2px">🕐 '+esc(s.shift||'')+' | 🔧 '+esc(s.task||'')+'</div></div>').join(''):'<div style="color:var(--sub);font-size:13px">暂无今日排班</div>';
}

function updateClock(){
  const now=new Date();
  const days=['周日','周一','周二','周三','周四','周五','周六'];
  const te=document.getElementById('currentTime'),de=document.getElementById('currentDate');
  if(te)te.textContent=now.toTimeString().slice(0,5);
  if(de)de.textContent=now.getFullYear()+'年'+(now.getMonth()+1)+'月'+now.getDate()+'日 '+days[now.getDay()];
}

// ========= REMINDERS =========
async function renderReminders(){
  const reminders=await sall('reminders');
  document.getElementById('remindersEmpty').style.display=reminders.length?'none':'block';
  document.getElementById('remindersList').innerHTML=reminders.length?reminders.map(r=>'<div class="card" style="display:flex;justify-content:space-between;align-items:center"><div><div style="font-weight:500">'+esc(r.title)+'</div><div style="font-size:12px;color:var(--sub)">🕐 '+r.time+' · '+(r.type==='daily'?'每天':r.type==='weekday'?'工作日':'一次性')+'</div></div><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:'+(r.enabled?'var(--green)':'var(--sub)')+'">'+(r.enabled?'开':'关')+'</span><button class="btn-sm" style="background:var(--red);font-size:11px;padding:4px 10px" onclick="sdel(\'reminders\','+r.id+').then(()=>renderReminders())">✕</button></div></div>').join(''):'';
}

function addReminderSheet(){
  document.getElementById('reminderTitle').value='';
  document.getElementById('reminderTime').value='08:00';
  document.getElementById('reminderType').value='daily';
  document.getElementById('reminderEnabled').checked=true;
  document.getElementById('reminderOverlay').classList.add('show');
  document.getElementById('reminderSheet').classList.add('open');
}
function hideReminderSheet(){
  document.getElementById('reminderOverlay').classList.remove('show');
  document.getElementById('reminderSheet').classList.remove('open');
}
async function saveReminder(){
  const title=document.getElementById('reminderTitle').value.trim();
  if(!title)return;
  await sput('reminders',{title,time:document.getElementById('reminderTime').value,type:document.getElementById('reminderType').value,enabled:document.getElementById('reminderEnabled').checked});
  hideReminderSheet();await renderReminders();
}

function checkReminders(){
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  const now=new Date(),ts=now.toTimeString().slice(0,5),day=now.getDay();
  sall('reminders').then(rs=>rs.filter(r=>r.enabled&&r.time===ts).forEach(r=>{if(r.type==='daily'||(r.type==='weekday'&&day>=1&&day<=5)||r.type==='once'){new Notification('SmartNotes',{body:r.title,icon:'icon-192.png'});if(r.type==='once')sput('reminders',{...r,enabled:false})}}));
}

// ========= SCHEDULE IMPORT =========
async function importSchedule(e){
  const file=e.target.files[0];
  if(!file)return;
  const status=document.getElementById('scheduleStatus');
  status.textContent='正在解析...';
  try{
    const data=await file.arrayBuffer();
    const wb=XLSX.read(data,{type:'array'});
    await sclr('schedule');let imported=0;
    for(const name of wb.SheetNames){
      const ws=wb.Sheets[name];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      if(rows.length<2)continue;
      for(let i=0;i<Math.min(rows.length,5);i++){
        for(let j=0;j<rows[i].length;j++){
          if(typeof rows[i][j]==='number'&&rows[i][j]>40000&&rows[i][j]<50000){
            const d=XLSX.SSF.parse_date_code(rows[i][j]);
            const ds=d.y+'-'+String(d.m).padStart(2,'0')+'-'+String(d.d).padStart(2,'0');
            for(let k=i+1;k<rows.length;k++){
              const tc=String(rows[k][j]||'');
              if(tc&&tc!=='周末'&&tc!=='休息'){
                const rl=String(rows[k][0]||'');
                await sput('schedule',{date:ds,sheet:name,location:name.split('-')[0]||'未分类',shift:rl.includes('夜班')?'夜班':rl.includes('中班')?'中班':'白班',task:tc.substring(0,200)});
                imported++;
              }
            }
          }
        }
      }
    }
    status.textContent='✅ 导入 '+imported+' 条记录！';
    setTimeout(()=>renderCheckin(),500);
  }catch(err){status.textContent='❌ 解析失败：'+err.message}
}

// ========= SETTINGS =========
async function renderSettings(){
  const cats=await sall('categories');
  document.getElementById('categoryList').innerHTML=cats.map(c=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--sep);font-size:14px"><span>'+esc(c.name)+'</span><button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px" onclick="sdel(\'categories\','+c.id+').then(()=>renderSettings())">✕</button></div>').join('');
  const st=await sall('settings');
  const wt=st.find(s=>s.key==='workStartTime');
  if(wt)document.getElementById('workStartTime').value=wt.value;
  const schedule=await sall('schedule');
  document.getElementById('scheduleStatus').textContent=schedule.length?'已导入 '+schedule.length+' 条记录':'尚未导入';
}
async function addCategory(){
  const n=document.getElementById('newCategoryInput').value.trim();
  if(!n)return;
  await sput('categories',{name:n});
  document.getElementById('newCategoryInput').value='';
  await renderSettings();await renderNotes();
}
async function saveSettings(){await sput('settings',{key:'workStartTime',value:document.getElementById('workStartTime').value})}
async function exportData(){
  const data={notes:await sall('notes'),checkins:await sall('checkins'),schedule:await sall('schedule'),folders:await sall('folders'),exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='smartnotes-backup.json';a.click();
}
async function clearAll(){for(const s of['notes','checkins','reminders','schedule','folders'])await sclr(s);alert('已清除');location.reload()}

// ========= HELPERS =========
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function formatDate(ts){if(!ts)return'';const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
init();
