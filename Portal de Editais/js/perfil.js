/* =========================================================
   Athos / Atimus - Perfil
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

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    bootstrapAuthFromUrl();
    const me = await checkAuth();
    if (!me) return;

    setupUI();
    await loadProfileFromApi();
  } finally {
    markAppReady();
  }
}

async function checkAuth() {
  try {
    const { res, data } = await apiFetchJson('/cliente/me', { method: 'GET' });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = buildLoginUrlWithNext();
        return null;
      }
      return {};
    }

    if (data && typeof data === 'object' && 'logado' in data && !data.logado) {
      window.location.href = buildLoginUrlWithNext();
      return null;
    }

    const nome = data?.nome || data?.nome_completo || data?.user?.nome || data?.usuario?.nome;
    const email = data?.email || data?.user?.email || data?.usuario?.email;
    const telefone = data?.celular || data?.telefone || '';
    const cnpj = data?.cnpj || '';

    if (nome) {
      setText('sidebarUserName', nome);
      setText('profileName', nome);
      setValue('nomeCompleto', nome);
      setInitials('sidebarAvatar', nome);
      setInitials('profileAvatar', nome);
    }
    if (email) {
      setText('sidebarUserEmail', email);
      setText('profileEmail', email);
      setValue('email', email);
    }
    if (telefone) setValue('telefone', telefone);
    if (cnpj) setValue('cnpj', cnpj);

    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    console.error('Erro na verificacao de autenticacao:', e);

    if (e instanceof TypeError) return {};

    window.location.href = buildLoginUrlWithNext();
    return null;
  }
}

function setupUI() {
  if (sidebarToggle && appSidebar) {
    sidebarToggle.addEventListener('click', () => appSidebar.classList.toggle('collapsed'));
  }

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

    try {
      for (const ep of endpoints) {
        try {
          const r = await apiFetch(ep.url, { method: ep.method });
          if (r.ok) break;
        } catch (_) {}
      }
    } finally {
      try { localStorage.removeItem('cliente_token'); } catch (_) {}
      try { sessionStorage.removeItem('cliente_token'); } catch (_) {}
      window.location.href = LOGIN_URL;
    }
  };

  if (logoutIconBtn) logoutIconBtn.addEventListener('click', doLogout);

  // Navegacao interna do perfil (tabs)
  document.querySelectorAll('.profile-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      document.querySelectorAll('.profile-nav-item').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');

      document.querySelectorAll('.panel[role="tabpanel"]').forEach((p) => {
        const isTarget = p.id === target;
        p.toggleAttribute('hidden', !isTarget);
      });

      document.querySelectorAll('.profile-nav-item').forEach((b) => {
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
    });
  });

  // Chips: remover
  const areas = document.getElementById('areasInteresse');
  if (areas) {
    areas.addEventListener('click', (e) => {
      const x = e.target.closest('.chip-x');
      if (!x) return;
      const chip = x.closest('.chip');
      if (chip && !chip.classList.contains('chip-add')) chip.remove();
    });
  }

  // Chips: adicionar
  const addAreaBtn = document.getElementById('addAreaBtn');
  if (addAreaBtn) {
    addAreaBtn.addEventListener('click', () => {
      const name = prompt('Nome da nova area de interesse:');
      if (!name) return;
      const span = document.createElement('span');
      span.className = 'chip';
      span.innerHTML = `${escapeHtml(name)} <button type="button" class="chip-x" aria-label="Remover">&times;</button>`;
      addAreaBtn.before(span);
    });
  }

  // Salvar no backend (SQL)
  const save = async (btn) => {
    const payload = collectForm();
    const wasDisabled = !!btn?.disabled;
    if (btn) btn.disabled = true;

    try {
      const { res, data } = await apiFetchJson('/cliente/perfil', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          window.location.href = buildLoginUrlWithNext();
          return;
        }
        const msg = (data && typeof data === 'object' && (data.detail || data.msg))
          ? (data.detail || data.msg)
          : 'Nao foi possivel salvar o perfil.';
        throw new Error(msg);
      }

      fillProfileForm(data);
      toast('Perfil salvo com sucesso.');
    } catch (e) {
      console.error('Erro ao salvar perfil:', e);
      toast(e?.message || 'Nao foi possivel salvar o perfil.');
    } finally {
      if (btn) btn.disabled = wasDisabled;
    }
  };

  const saveDadosBtn = document.getElementById('saveDadosBtn');
  const saveEmpresaBtn = document.getElementById('saveEmpresaBtn');
  const savePrefsBtn = document.getElementById('savePrefsBtn');

  if (saveDadosBtn) saveDadosBtn.addEventListener('click', () => save(saveDadosBtn));
  if (saveEmpresaBtn) saveEmpresaBtn.addEventListener('click', () => save(saveEmpresaBtn));
  if (savePrefsBtn) savePrefsBtn.addEventListener('click', () => save(savePrefsBtn));
}

function markAppReady() {
  document.body.classList.remove('app-loading');
}

function collectForm() {
  const areas = Array.from(document.querySelectorAll('#areasInteresse .chip'))
    .filter((c) => !c.classList.contains('chip-add'))
    .map((c) => c.childNodes[0]?.textContent?.trim())
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

async function loadProfileFromApi() {
  try {
    const { res, data } = await apiFetchJson('/cliente/perfil', { method: 'GET' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        window.location.href = buildLoginUrlWithNext();
        return;
      }
      const msg = (data && typeof data === 'object' && (data.detail || data.msg))
        ? (data.detail || data.msg)
        : 'Nao foi possivel carregar o perfil.';
      throw new Error(msg);
    }

    fillProfileForm(data);
  } catch (e) {
    console.error('Erro ao carregar perfil:', e);
    toast(e?.message || 'Nao foi possivel carregar o perfil.');
  }
}

function fillProfileForm(data) {
  const profile = (data && typeof data === 'object') ? data : {};

  if ('nomeCompleto' in profile) {
    const nome = profile.nomeCompleto || '';
    setValue('nomeCompleto', nome);
    setText('profileName', nome);
    setText('sidebarUserName', nome);
    setInitials('profileAvatar', nome || profile.email || 'U');
    setInitials('sidebarAvatar', nome || profile.email || 'U');
  }

  if ('email' in profile) {
    const email = profile.email || '';
    setValue('email', email);
    setText('profileEmail', email);
    setText('sidebarUserEmail', email);
  }

  if ('telefone' in profile) setValue('telefone', profile.telefone || '');
  if ('cargo' in profile) setValue('cargo', profile.cargo || '');
  if ('nomeEmpresa' in profile) setValue('nomeEmpresa', profile.nomeEmpresa || '');
  if ('cnpj' in profile) setValue('cnpj', profile.cnpj || '');
  if ('setorEmpresa' in profile) setValue('setorEmpresa', profile.setorEmpresa || '');
  if ('setorAtuacao' in profile) setValue('setorAtuacao', profile.setorAtuacao || '');

  setAreasInteresse(profile.areasInteresse);

  if ('prefEditais' in profile) setChecked('prefEditais', !!profile.prefEditais);
  if ('prefPrazo' in profile) setChecked('prefPrazo', !!profile.prefPrazo);
  if ('prefRelatorio' in profile) setChecked('prefRelatorio', !!profile.prefRelatorio);
  if ('prefSistema' in profile) setChecked('prefSistema', !!profile.prefSistema);
}

function setAreasInteresse(areas) {
  const add = document.getElementById('addAreaBtn');
  if (!add) return;

  document.querySelectorAll('#areasInteresse .chip').forEach((c) => {
    if (!c.classList.contains('chip-add')) c.remove();
  });

  if (!Array.isArray(areas)) return;

  areas.forEach((area) => {
    const text = String(area || '').trim();
    if (!text) return;
    const span = document.createElement('span');
    span.className = 'chip';
    span.innerHTML = `${escapeHtml(text)} <button type="button" class="chip-x" aria-label="Remover">&times;</button>`;
    add.before(span);
  });
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 1800);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getChecked(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function setChecked(id, v) {
  const el = document.getElementById(id);
  if (el) el.checked = !!v;
}

function setInitials(id, name) {
  const el = document.getElementById(id);
  if (!el) return;
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || 'U';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  el.textContent = (a + b).toUpperCase();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
