/* ============================================================
   TASKHIVE — API Configuration & Client
   ============================================================ */
const API_URL = 'https://script.google.com/macros/s/AKfycbz26ZNsAzpbEtBFSg-QOmXGVfQda1VQW9Z5qRLI9NXyZ1ucxYB-XHiSQ4mzCSnMu3w29g/exec';

const TaskHiveAPI = (function(){
  function getToken(){ return localStorage.getItem('th_token'); }

  async function call(action, payload){
    payload = payload || {};
    payload.action = action;
    if (action !== 'login') payload.token = getToken();
    try{
      const res = await fetch(API_URL, {
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (action !== 'logout' && !json.success && json.error === 'Unauthorized. Please log in again.'){
        TaskHiveAuth.logout(true);
      }
      return json;
    }catch(err){
      return {success:false, error:'Unable to connect to the server.'};
    }
  }

  return { call, getToken };
})();
