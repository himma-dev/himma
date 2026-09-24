(function(){
  var $=function(s){return document.querySelector(s)};
  var API='';
  var token=localStorage.getItem('himma_device_token')||'';
  var name=localStorage.getItem('himma_device_name')||'';

  async function api(path, opts){
    opts=opts||{};
    var headers=Object.assign({'content-type':'application/json'}, opts.headers||{});
    if(token) headers['authorization']='Bearer '+token;
    var r=await fetch(API+'/api'+path, Object.assign({},opts,{headers:headers}));
    var j=await r.json().catch(function(){return {}});
    if(!r.ok) throw new Error(j.error||'خطأ');
    return j;
  }

  function showLive(){ $('#pairView').hidden=true; $('#liveView').hidden=false; poll(); setInterval(poll,4000); }

  $('#confirmBtn').onclick=async function(){
    var code=$('#codeIn').value.trim();
    var dn=$('#nameIn').value.trim()||'جهاز جديد';
    if(!code){ alert('أدخل الرمز'); return; }
    try{
      var j=await api('/pair/confirm',{method:'POST',body:JSON.stringify({code:code,name:dn})});
      token=j.deviceId?j.token:j.token; localStorage.setItem('himma_device_token',token);
      name=dn; localStorage.setItem('himma_device_name',name);
      $('#devName').textContent=name;
      showLive();
    }catch(e){ alert(e.message); }
  };

  async function poll(){
    try{
      var j=await api('/device/state');
      $('#devName').textContent=j.name||name;
      $('#pausedBox').hidden=!j.paused;
      $('#statusOk').style.display=j.paused?'none':'block';
      if(j.message){ $('#msgBox').hidden=false; $('#msgBox').textContent='💬 '+j.message; }
      else { $('#msgBox').hidden=true; }
    }catch(e){ /* تجاهل أخطاء الشبكة المؤقتة */ }
  }

  if(token){ $('#devName').textContent=name; showLive(); }
})();
