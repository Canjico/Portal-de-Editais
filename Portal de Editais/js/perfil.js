/* =========================================================
   Athos / Atimus — Perfil (layout do print)
   ========================================================= */

import {
  API_BASE,
  LOGIN_URL,
  authHeaders,
  bootstrapAuthFromUrl,
  buildLoginUrlWithNext,
  apiFetch,
  apiFetchJson,
} from './auth.js';


const sidebarToggle = document.getElementById('sidebarToggle');
const appSidebar = document.getElementById('appSidebar');
const logoutIconBtn = document.getElementById('logoutIconBtn');

document.addEventListener('DOMContentLoaded', init);

async function init(){
  bootstrapAuthFromUrl();
  try{
    const isLogged = await checkAuth();
    if(!isLogged) return;

    setupUI();
    loadLocalPrefs();
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
        return false;
      }
      // erro estranho: não quebra tudo, mas não temos como preencher perfil
      return true;
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado){
      window.location.href = buildLoginUrlWithNext();
      return false;
    }

    // Preenche dados se a API devolver algo útil
    const nome = data?.nome || data?.nome_completo || data?.user?.nome || data?.usuario?.nome;
    const email = data?.email || data?.user?.email || data?.usuario?.email;

    if(nome){
      setText('sidebarUserName', nome);
      setText('profileName', nome);
      setValue('nomeCompleto', nome);
      setInitials('sidebarAvatar', nome);
      setInitials('profileAvatar', nome);
    }
    if(email){
      setText('sidebarUserEmail', email);
      setText('profileEmail', email);
      setValue('email', email);
    }

    return true;
  }catch(e){
    console.error('Erro na verificação de autenticação:', e);

    if (e instanceof TypeError) return true;

    window.location.href = buildLoginUrlWithNext();
    return false;
  }
}

function markAppReady(){
  document.body.classList.remove('app-loading');
}


function setupUI(){
  if(sidebarToggle && appSidebar){
    sidebarToggle.addEventListener('click', ()=> appSidebar.classList.toggle('collapsed'));
  }

  // logout robusto (tenta endpoint; cai no redirect)
  const doLogout = async () => {
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
    }finally{
      try{ localStorage.removeItem('cliente_token'); }catch(_){ }
      try{ sessionStorage.removeItem('cliente_token'); }catch(_){ }
      window.location.href = LOGIN_URL;
    }
  };

  if(logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);

  // navegação interna do perfil (tabs)
  document.querySelectorAll('.profile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      document.querySelectorAll('.profile-nav-item').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      document.querySelectorAll('.panel[role="tabpanel"]').forEach(p => {
        const isTarget = p.id === target;
        p.toggleAttribute('hidden', !isTarget);
      });

      // acessibilidade
      document.querySelectorAll('.profile-nav-item').forEach(b => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
    });
  });

  // chips: remover
  const areas = document.getElementById('areasInteresse');
  if(areas){
    areas.addEventListener('click', (e) => {
      const x = e.target.closest('.chip-x');
      if(!x) return;
      const chip = x.closest('.chip');
      if(chip && !chip.classList.contains('chip-add')) chip.remove();
    });
  }

  // chips: adicionar
  const addAreaBtn = document.getElementById('addAreaBtn');
  if(addAreaBtn){
    addAreaBtn.addEventListener('click', () => {
      const name = prompt('Nome da nova área de interesse:');
      if(!name) return;
      const span = document.createElement('span');
      span.className = 'chip';
      span.innerHTML = `${escapeHtml(name)} <button type="button" class="chip-x" aria-label="Remover">×</button>`;
      addAreaBtn.before(span);
    });
  }

  // salvar (localStorage — pronto pra plugar no endpoint real)
  const save = (key) => {
    const payload = collectForm();
    try{ localStorage.setItem(key, JSON.stringify(payload)); }catch(_){ }
    toast('Salvo ✅ (frontend)');
  };

  const saveDadosBtn = document.getElementById('saveDadosBtn');
  const saveEmpresaBtn = document.getElementById('saveEmpresaBtn');
  const savePrefsBtn = document.getElementById('savePrefsBtn');

  if(saveDadosBtn) saveDadosBtn.addEventListener('click', ()=> save('athos_profile'));
  if(saveEmpresaBtn) saveEmpresaBtn.addEventListener('click', ()=> save('athos_profile'));
  if(savePrefsBtn) savePrefsBtn.addEventListener('click', ()=> save('athos_profile'));
}

function collectForm(){
  const areas = Array.from(document.querySelectorAll('#areasInteresse .chip'))
    .filter(c => !c.classList.contains('chip-add'))
    .map(c => c.childNodes[0]?.textContent?.trim())
    .filter(Boolean);

  return {
    nomeCompleto: getValue('nomeCompleto'),
    email: getValue('email'),
    telefone: getValue('telefone'),
    cargo: getValue('cargo'),

    nomeEmpresa: getValue('nomeEmpresa'),
    cnpj: getValue('cnpj'),
    setorEmpresa: getValue('setorEmpresa'),
    setorAtuacao: getValue('setorAtuacao'),
    areasInteresse: areas,

    prefEditais: getChecked('prefEditais'),
    prefPrazo: getChecked('prefPrazo'),
    prefRelatorio: getChecked('prefRelatorio'),
    prefSistema: getChecked('prefSistema'),
  };
}

function loadLocalPrefs(){
  try{
    const raw = localStorage.getItem('athos_profile');
    if(!raw) return;
    const data = JSON.parse(raw);

    if(data.nomeCompleto) setValue('nomeCompleto', data.nomeCompleto);
    if(data.email) setValue('email', data.email);
    if(data.telefone) setValue('telefone', data.telefone);
    if(data.cargo) setValue('cargo', data.cargo);

    if(data.nomeEmpresa) setValue('nomeEmpresa', data.nomeEmpresa);
    if(data.cnpj) setValue('cnpj', data.cnpj);
    if(data.setorEmpresa) setValue('setorEmpresa', data.setorEmpresa);
    if(data.setorAtuacao) setValue('setorAtuacao', data.setorAtuacao);

    if(Array.isArray(data.areasInteresse) && data.areasInteresse.length){
      const add = document.getElementById('addAreaBtn');
      if(add){
        // remove chips existentes (exceto botão)
        document.querySelectorAll('#areasInteresse .chip').forEach(c => {
          if(!c.classList.contains('chip-add')) c.remove();
        });
        data.areasInteresse.forEach(a => {
          const span = document.createElement('span');
          span.className = 'chip';
          span.innerHTML = `${escapeHtml(a)} <button type="button" class="chip-x" aria-label="Remover">×</button>`;
          add.before(span);
        });
      }
    }

    setChecked('prefEditais', !!data.prefEditais);
    setChecked('prefPrazo', !!data.prefPrazo);
    setChecked('prefRelatorio', !!data.prefRelatorio);
    setChecked('prefSistema', !!data.prefSistema);
  }catch(e){
    console.warn('Não foi possível carregar dados locais do perfil:', e);
  }
}

function toast(msg){
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(()=> t.classList.add('show'));
  setTimeout(()=>{
    t.classList.remove('show');
    setTimeout(()=> t.remove(), 250);
  }, 1800);
}

function setText(id, value){
  const el = document.getElementById(id);
  if(el) el.textContent = value;
}
function setValue(id, value){
  const el = document.getElementById(id);
  if(el) el.value = value;
}
function getValue(id){
  const el = document.getElementById(id);
  return el ? el.value : '';
}
function getChecked(id){
  const el = document.getElementById(id);
  return el ? el.checked : false;
}
function setChecked(id, v){
  const el = document.getElementById(id);
  if(el) el.checked = !!v;
}

function setInitials(id, name){
  const el = document.getElementById(id);
  if(!el) return;
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || 'U';
  const b = parts.length > 1 ? parts[parts.length-1][0] : '';
  el.textContent = (a + b).toUpperCase();
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
