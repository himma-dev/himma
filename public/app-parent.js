(function(){
  var $=function(s,r){return (r||document).querySelector(s)};
  var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  var API='';
  var token=localStorage.getItem('himma_token')||'';
  var sel={};

  function toast(m){ var t=$('#toast'); t.textContent=m; t.classList.add('on'); setTimeout(function(){t.classList.remove('on')},2500); }
  async function api(path, opts){
    opts=opts||{};
    var headers=Object.assign({'content-type':'application/json'}, opts.headers||{});
    if(token) headers['authorization']='Bearer '+token;
    var r=await fetch(API+'/api'+path, Object.assign({},opts,{headers:headers}));
    var j=await r.json().catch(function(){return {}});
    if(!r.ok) throw new Error(j.error||'خطأ');
    return j;
  }

  function showApp(showTokenCard){
    $('#auth').hidden=true; $('#app').hidden=false;
    $('#tokenCard').hidden=!showTokenCard;
    if(showTokenCard) $('#tokenShow').textContent=token;
    load();
  }

  $('#signupBtn').onclick=async function(){
    try{
      var name=$('#childName').value.trim()||'الطفل';
      var j=await api('/signup',{method:'POST',body:JSON.stringify({childName:name})});
      token=j.token; localStorage.setItem('himma_token',token);
      showApp(true);
    }catch(e){ toast(e.message); }
  };
  $('#loginBtn').onclick=function(){
    var t=$('#tokenIn').value.trim(); if(!t){ toast('أدخل الرمز'); return; }
    token=t; localStorage.setItem('himma_token',token); showApp(false);
  };
  $('#logoutBtn').onclick=function(){ localStorage.removeItem('himma_token'); location.reload(); };

  var prefs={}, devices=[];
  async function load(){
    try{
      var j=await api('/family/state');
      $('#hello').textContent='مرحباً · '+ (j.childName||'الطفل');
      $('#dnsState').textContent = j.dnsConnected ? '🟢 الحماية متصلة' : '🟠 لم تُربط الحماية بعد (NextDNS)';
      prefs=j.prefs||{}; devices=j.devices||[];
      $$('.sw[data-k]').forEach(function(b){ b.setAttribute('aria-checked', String(!!prefs[b.dataset.k])); });
      var sch = prefs.schedule || {enabled:false,start:'21:00',end:'07:00'};
      $('#schedSw').setAttribute('aria-checked', String(!!sch.enabled));
      $('#schedStart').value = sch.start; $('#schedEnd').value = sch.end;
      renderDevices(); renderLog(j.events||[]);
      var tgBot = window.HIMMA_TG_BOT || '';
      if(tgBot){ $('#tgLink').href='https://t.me/'+tgBot; }
      var donateUrl = window.HIMMA_DONATE_URL || '';
      if(donateUrl){ $('#donateBtn').href = donateUrl; } else { $('#donateBtn').style.display='none'; }
    }catch(e){ toast(e.message); if(/غير مصرّح/.test(e.message)){ localStorage.removeItem('himma_token'); location.reload(); } }
  }

  $$('.sw[data-k]').forEach(function(b){ b.onclick=async function(){
    var k=b.dataset.k; prefs[k]=!prefs[k]; b.setAttribute('aria-checked',String(prefs[k]));
    try{ await api('/family/prefs',{method:'POST',body:JSON.stringify({prefs:prefs})}); }catch(e){ toast(e.message); }
  };});

  function renderDevices(){
    var box=$('#devList'); box.innerHTML='';
    if(!devices.length){ box.innerHTML='<p class="sub">لا أجهزة بعد. أضف جهازاً من الزر أدناه.</p>'; }
    devices.forEach(function(d){
      var row=document.createElement('div'); row.className='dev';
      row.innerHTML='<button class="ck" role="checkbox">✓</button><div style="flex:1"><b></b><div class="sub" style="margin:0"></div></div><span class="pill"></span>';
      $('.ck',row).setAttribute('aria-checked', String(!!sel[d.id]));
      row.querySelector('b').textContent = (d.type==='tv'?'📺 ':d.type==='tablet'?'📲 ':'📱 ')+d.name;
      var online = d.last_seen && (Date.now()-d.last_seen < 3*60*1000);
      row.querySelector('.sub').textContent = online?'متصل الآن':'غير متصل حالياً';
      var p=row.querySelector('.pill');
      if(d.paused){ p.className='pill pz'; p.textContent='موقوف'; } else if(online){ p.className='pill on'; p.textContent='يعمل'; } else { p.className='pill off'; p.textContent='—'; }
      row.querySelector('.ck').onclick=function(){ sel[d.id]=!sel[d.id]; renderDevices(); };
      box.appendChild(row);
    });
  }
  $('#selAll').onclick=function(){ var all=devices.every(function(d){return sel[d.id]}); devices.forEach(function(d){sel[d.id]=!all}); renderDevices(); };
  function selIds(){ return Object.keys(sel).filter(function(id){return sel[id]}); }
  async function batch(action, extra){
    var ids=selIds(); if(!ids.length){ toast('حدّد جهازاً واحداً على الأقل'); return; }
    try{ await api('/family/devices/batch',{method:'POST',body:JSON.stringify(Object.assign({ids:ids,action:action},extra||{}))}); toast('تم'); load(); }
    catch(e){ toast(e.message); }
  }
  $('#pauseSel').onclick=function(){ batch('pause'); };
  $('#resumeSel').onclick=function(){ batch('resume'); };
  $('#sendMsg').onclick=function(){ var t=$('#msgTxt').value.trim(); if(!t){toast('اكتب رسالة');return;} batch('message',{text:t}); $('#msgTxt').value=''; };

  var pairPoll;
  $('#addDev').onclick=async function(){
    var type = prompt('نوع الجهاز: اكتب tv أو phone أو tablet','tv') || 'tv';
    try{
      var j=await api('/family/pair/start',{method:'POST',body:JSON.stringify({type:type})});
      $('#pairBox').hidden=false; $('#pairCode').textContent=j.code; $('#pairState').textContent='بانتظار الجهاز…';
      clearInterval(pairPoll);
      pairPoll=setInterval(async function(){
        try{ var r=await api('/family/pair/'+j.code); if(r.confirmed){ clearInterval(pairPoll); $('#pairState').textContent='✅ تم ربط الجهاز'; load(); setTimeout(function(){$('#pairBox').hidden=true;},1500); } }catch(e){}
      },2000);
    }catch(e){ toast(e.message); }
  };

  $('#ndSave').onclick=async function(){
    var profileId=$('#ndProfile').value.trim(), apiKey=$('#ndKey').value.trim();
    if(!profileId||!apiKey){ toast('أدخل الحقلين'); return; }
    try{ await api('/family/nextdns',{method:'POST',body:JSON.stringify({profileId:profileId,apiKey:apiKey})}); toast('تم الحفظ'); load(); }
    catch(e){ toast(e.message); }
  };

  $('#schedSw').onclick=function(){
    var sch = prefs.schedule || {enabled:false,start:'21:00',end:'07:00'};
    sch.enabled = !sch.enabled;
    $('#schedSw').setAttribute('aria-checked', String(sch.enabled));
    prefs.schedule = sch;
  };
  $('#schedSave').onclick=async function(){
    var sch = {
      enabled: $('#schedSw').getAttribute('aria-checked')==='true',
      start: $('#schedStart').value || '21:00',
      end: $('#schedEnd').value || '07:00',
    };
    prefs.schedule = sch;
    try{ await api('/family/prefs',{method:'POST',body:JSON.stringify({prefs:prefs})}); toast('تم حفظ الجدول'); }
    catch(e){ toast(e.message); }
  };

  function renderLog(events){
    var ul=$('#log'); ul.innerHTML='';
    events.forEach(function(e){
      var li=document.createElement('li');
      li.innerHTML='<b></b><span></span>';
      li.querySelector('b').textContent = e.domain + ' — ' + (e.reason||'محجوب');
      li.querySelector('span').textContent = e.device_name + ' · ' + new Date(e.ts).toLocaleString('ar');
      ul.appendChild(li);
    });
    $('#logEmpty').style.display = events.length?'none':'block';
  }

  if(token) showApp(false); 
})();
