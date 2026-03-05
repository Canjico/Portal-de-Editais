/* =========================================================
   Athos / Atimus - Central de Ajuda
   ========================================================= */

import {
  API_BASE,
  LOGIN_URL,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  apiFetch,
  apiFetchJson,
} from './auth.js';

const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const logoutIconBtn = document.getElementById('logoutIconBtn');
const sidebarAvatar = document.getElementById('sidebarAvatar');
const sidebarUserName = document.getElementById('sidebarUserName');
const sidebarUserEmail = document.getElementById('sidebarUserEmail');

document.addEventListener('DOMContentLoaded', init);

async function init(){
  bootstrapAuthFromUrl();

  try{
    const me = await checkAuth();
    if(!me) return;

    hydrateSidebarUser(me);
    setupUI();
  } finally{
    markAppReady();
  }
}

async function checkAuth(){
  try{
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });

    if(!res.ok){
      if(res.status === 401 || res.status === 403){
        window.location.href = buildLoginUrlWithNext();
        return null;
      }
      return {};
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado){
      window.location.href = buildLoginUrlWithNext();
      return null;
    }

    return data && typeof data === 'object' ? data : {};
  }catch(e){
    console.error('Erro na verificacao de autenticacao:', e);

    if (e instanceof TypeError) return {};

    window.location.href = buildLoginUrlWithNext();
    return null;
  }
}

function hydrateSidebarUser(me){
  const nome =
    me?.nome ||
    me?.nome_completo ||
    me?.user?.nome ||
    me?.usuario?.nome ||
    '';
  const email =
    me?.email ||
    me?.user?.email ||
    me?.usuario?.email ||
    '';

  if(sidebarUserName) sidebarUserName.textContent = nome;
  if(sidebarUserEmail) sidebarUserEmail.textContent = email;
  setInitials(sidebarAvatar, nome || email || 'U');
}

function setupUI(){
  if(sidebarToggle && appSidebar){
    sidebarToggle.addEventListener('click', () => appSidebar.classList.toggle('collapsed'));
  }

  syncHelpSearch();

  if(logoutIconBtn){
    logoutIconBtn.addEventListener('click', doLogout);
  }
}

function syncHelpSearch(){
  const a = document.getElementById('helpSearch');
  const b = document.getElementById('helpSearch2');
  if(!a || !b) return;

  a.addEventListener('input', () => {
    b.value = a.value;
  });

  b.addEventListener('input', () => {
    a.value = b.value;
  });
}

async function doLogout(){
  const endpoints = [
    { url: API_BASE + '/logout', method: 'POST' },
    { url: API_BASE + '/auth/logout', method: 'POST' },
    { url: API_BASE + '/cliente/logout', method: 'POST' },
    { url: API_BASE + '/cliente/sair', method: 'POST' },
    { url: API_BASE + '/session/logout', method: 'POST' },
    { url: API_BASE + '/logout', method: 'GET' },
    { url: API_BASE + '/auth/logout', method: 'GET' },
    { url: API_BASE + '/cliente/logout', method: 'GET' },
    { url: API_BASE + '/cliente/sair', method: 'GET' },
    { url: API_BASE + '/session/logout', method: 'GET' },
  ];

  try{
    for(const ep of endpoints){
      try{
        const r = await apiFetch(ep.url, { method: ep.method });
        if(r.ok) break;
      }catch(_){ }
    }
  } finally{
    try{ localStorage.removeItem('cliente_token'); }catch(_){ }
    try{ sessionStorage.removeItem('cliente_token'); }catch(_){ }
    window.location.href = LOGIN_URL;
  }
}

function setInitials(el, name){
  if(!el) return;
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || 'U';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  el.textContent = (a + b).toUpperCase();
}

function markAppReady(){
  document.body.classList.remove('app-loading');
}
