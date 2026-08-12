/* ============================================================
   TASKHIVE — Authentication
   ============================================================ */
const TaskHiveAuth = (function(){
  function getUser(){
    try{ return JSON.parse(localStorage.getItem('th_user')); }catch(e){ return null; }
  }
  function isLoggedIn(){ return !!localStorage.getItem('th_token') && !!getUser(); }
  function isAdmin(){ const u = getUser(); return u && u.Role === 'Admin'; }

  function requireAuth(){
    if (!isLoggedIn()){
      window.location.href = getBasePath() + 'login.html';
    }
  }

  function getBasePath(){
    // pages/ subfolder needs to go up one level
    return window.location.pathname.includes('/pages/') ? '../' : '';
  }

  async function login(username, password){
    const res = await TaskHiveAPI.call('login', {username, password});
    if (res.success){
      localStorage.setItem('th_token', res.data.token);
      localStorage.setItem('th_user', JSON.stringify(res.data.user));
    }
    return res;
  }

  async function logout(silent){
    if (!silent && isLoggedIn()){
      try{ await TaskHiveAPI.call('logout', {}); }catch(e){}
    }
    localStorage.removeItem('th_token');
    localStorage.removeItem('th_user');
    if (!silent) {}
    window.location.href = getBasePath() + 'login.html';
  }

  return { getUser, isLoggedIn, isAdmin, requireAuth, login, logout, getBasePath };
})();
