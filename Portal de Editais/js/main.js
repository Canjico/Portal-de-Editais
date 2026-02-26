/* =========================================================
   MAIN.JS - Arquivo Mestre (Estado Global + Filtros + Chat)
   ========================================================= */

import { renderEditais } from './render.js';

// =========================
// CONFIGURAÇÕES & SEGURANÇA
// =========================
const API_BASE = "https://atimus-api-acb4gfgagefcevb5.brazilsouth-01.azurewebsites.net";
const IS_LOCAL = window.location.hostname.includes("localhost") || window.location.hostname.includes("127.0.0.1");

// URL de Login: Em produção aponta para o subdomínio seguro, em local tenta o arquivo relativo
const LOGIN_URL = IS_LOCAL ? "../Login/API/index.html" : "https://login.atimus.agr.br";

// --- ESTADO GLOBAL ---
let editaisOriginais = []; // Fonte da verdade (imutável após load)

let botIsTyping = false;
let chatState = null;

// --- ELEMENTOS DOM ---
const container = document.getElementById('editais-container');
const searchInput = document.getElementById('search');
const dateStartInput = document.getElementById('date-start');
const dateEndInput = document.getElementById('date-end');
const clearFilterBtn = document.querySelector('.clear-filter-btn') || document.getElementById('clear-date-filter');

// Sidebar & Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const modalContentContainer = document.getElementById('modal-content-container');
const modalCloseBtn = document.getElementById('modal-close-btn');
const sidebar = document.querySelector('.filter-sidebar-compact');
const toggleBtn = document.getElementById('filter-toggle-btn');
const sidebarOverlay = document.querySelector('.sidebar-overlay');
const closeSidebarBtn = document.querySelector('.close-sidebar-btn');

// Chat Elements
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messageContainer = document.getElementById('chatbot-messages');
const chatWrapper = document.getElementById('chatbot-wrapper');
const chatButton = document.querySelector('.e-contact-buttons__chat-button');

// =========================
// INICIALIZAÇÃO
// =========================
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // 1. VERIFICAÇÃO DE AUTENTICAÇÃO (PROTEÇÃO)
    const isLogged = await checkAuth();
    if (!isLogged) return; // Se não logado, checkAuth redireciona e paramos a execução.

    // 2. CARREGAMENTO DA APLICAÇÃO
    const carregamentoSucesso = await loadEditais();
    
    // Gera as opções de filtro dinamicamente com base nos dados carregados
    generateDynamicFilters();

    setupGlobalEvents();
    
    // Só chama a renderização inicial se o carregamento foi bem sucedido.
    if (carregamentoSucesso) {
        aplicarFiltrosEBusca();

        // DEEP LINKING: Checa se tem ?edital=slug ou ?id=X na URL
        const urlParams = new URLSearchParams(window.location.search);
        const editalSlug = urlParams.get('edital');
        const editalId = urlParams.get('id');

        if (editalSlug) {
            // Busca pelo Slug (Título amigável)
            const targetEdital = editaisOriginais.find(e => e.slug === editalSlug);
            if (targetEdital) openModal(targetEdital);
        } else if (editalId) {
            // Fallback para ID numérico (compatibilidade)
            const targetEdital = editaisOriginais.find(e => e.id == editalId);
            if (targetEdital) openModal(targetEdital);
        }
    }
}

// =========================
// AUTH CHECK (SECURITY FIX)
// =========================
async function checkAuth() {
    try {
        // Verifica sessão no backend enviando cookies (credentials: include)
        // ISSO É CRUCIAL: Sem 'include', o cookie HttpOnly não é enviado, causando o loop.
        const res = await fetch(`${API_BASE}/cliente/me`, {
            credentials: 'include'
        });
        
        // Se a API retornar erro (401/403) ou JSON indicar !logado
        if (!res.ok) throw new Error("Sessão inválida ou expirada");
        
        const data = await res.json();
        
        if (!data.logado) {
            console.warn("Usuário não autenticado. Redirecionando para login...");
            window.location.href = LOGIN_URL;
            return false;
        }

        return true;
    } catch (e) {
        console.error("Erro na verificação de autenticação:", e);
        // Segurança por padrão: falha na verificação = redireciona
        window.location.href = LOGIN_URL;
        return false;
    }
}

// =========================
// HELPER: SLUG GENERATOR
// =========================
function generateSlug(text) {
    return text
        .toString()
        .toLowerCase()
        .normalize('NFD') // Separa acentos
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .replace(/[^a-z0-9]+/g, '-') // Substitui caracteres especiais por hífen
        .replace(/^-+|-+$/g, ''); // Remove hífens extras
}

// =========================
// CARREGAMENTO DE DADOS
// =========================
async function loadEditais() {
    // Exibe Loading antes do fetch
    container.innerHTML = `
        <div class="loading-container">
            <div class="spinner"></div>
            <p>Carregando editais...</p>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/editais`);
        if (!res.ok) throw new Error("Erro na resposta da API");
        
        const apiData = await res.json();
        // Normaliza e salva no estado global
        editaisOriginais = apiData.map(normalizeEdital);

        // Se não houver dados, exibe msg (mas retorna true pois a requisição foi OK)
        if (!editaisOriginais || editaisOriginais.length === 0) {
            container.innerHTML = '<p class="no-results">Nenhum edital disponível no momento.</p>';
        }
        
        return true;
    } catch (e) {
        console.error('Erro ao carregar editais:', e);
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align:center; padding:2rem; color:#ff6b6b;">
                <i class="fas fa-exclamation-triangle fa-2x"></i>
                <p>Não foi possível carregar os editais.</p>
                <small>${e.message}</small>
                <br><br>
                <button onclick="location.reload()" style="padding:8px 16px; background:#25D366; border:none; border-radius:4px; color:white; cursor:pointer;">Tentar Novamente</button>
            </div>
        `;
        return false;
    }
}

function normalizeEdital(api) {
    const data = typeof api.json_data === 'string' ? JSON.parse(api.json_data) : (api.json_data || {});
    const arquivos = typeof api.arquivos_json === 'string' ? JSON.parse(api.arquivos_json) : (api.arquivos_json || []);
    
    const titulo = data.titulo || api.titulo || 'Sem título';

    return {
        id: api.id,
        titulo: titulo,
        slug: generateSlug(titulo), // Gera o slug para uso na URL
        descricao: data.objetivo || data.descricao || 'Sem descrição',
        publico_alvo: data.publico_alvo || '',
        icone: data.icone_instituicao || null,
        instituicao: data.instituicao || '',
        estado: data.estado || 'BR',
        area: data.area || (Array.isArray(data.tags) && data.tags.length ? data.tags[0] : 'Geral'),
        apoio: data.apoio || 'Não informado',
        tipo: data.tipo || 'Não informado',
        valor_total: data.valor_total || '',
        // Padroniza datas para YYYY-MM-DD para facilitar comparação
        data_fechamento: api.data_final_submissao || data.data_final_submissao || null,
        data_abertura: data.data_abertura || null,
        tags: data.tags || [],
        arquivos: arquivos,
        share_link: api.share_link || ''
    };
}

// =========================
// GERAÇÃO DINÂMICA DE FILTROS (COM CONTAGEM)
// =========================
function generateDynamicFilters() {
    // Mapeamento: propriedade do objeto Edital -> data-filter-type no HTML
    const filterMap = [
        { key: 'estado', type: 'estado' },
        { key: 'area', type: 'area' },
        { key: 'area', type: 'categoria' }, 
        { key: 'instituicao', type: 'instituicao' },
        { key: 'apoio', type: 'apoio' },
        { key: 'tipo', type: 'tipo' }
    ];

    filterMap.forEach(filter => {
        const container = document.querySelector(`.filter-sidebar-compact .filter-options-compact[data-filter-type="${filter.type}"]`);
        
        if (container) {
            // 1. Contagem de frequência
            const counts = {};
            editaisOriginais.forEach(e => {
                const val = e[filter.key];
                if (val && val.trim() !== '') {
                    const cleanVal = val.trim();
                    counts[cleanVal] = (counts[cleanVal] || 0) + 1;
                }
            });

            const values = Object.keys(counts).sort();

            // 2. Limpa o HTML atual
            container.innerHTML = '';

            // 3. Cria as checkboxes
            if (values.length === 0) {
                container.innerHTML = '<span style="font-size:0.8rem; opacity:0.6; padding:5px;">Nenhuma opção</span>';
            } else {
                values.forEach(val => {
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '8px';
                    label.style.padding = '4px 0';
                    label.style.cursor = 'pointer';
                    
                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.value = val;
                    
                    const span = document.createElement('span');
                    span.innerText = `${val} (${counts[val]})`;
                    
                    label.appendChild(input);
                    label.appendChild(span);
                    container.appendChild(label);
                });
            }
        }
    });
}

// =========================
// LÓGICA CENTRAL DE FILTRO
// =========================
function aplicarFiltrosEBusca() {
    let resultado = [...editaisOriginais];

    // 1. BUSCA TEXTUAL
    const termo = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (termo) {
        resultado = resultado.filter(edital => 
            edital.titulo.toLowerCase().includes(termo) ||
            edital.descricao.toLowerCase().includes(termo) ||
            edital.instituicao.toLowerCase().includes(termo) ||
            (edital.area && edital.area.toLowerCase().includes(termo)) ||
            (edital.tags && edital.tags.some(tag => tag.toLowerCase().includes(termo)))
        );
    }

    // 2. CHECKBOXES
    const getChecked = (tipo) => 
        Array.from(document.querySelectorAll(`.filter-sidebar-compact [data-filter-type="${tipo}"] input:checked`))
             .map(cb => cb.value);

    const estados = getChecked('estado');
    const areas = [...getChecked('area'), ...getChecked('categoria')];
    const instituicoes = getChecked('instituicao'); 
    const apoios = getChecked('apoio');
    const tipos = getChecked('tipo');

    if (estados.length) resultado = resultado.filter(e => estados.includes(e.estado));
    if (areas.length) resultado = resultado.filter(e => areas.includes(e.area));
    if (instituicoes.length) resultado = resultado.filter(e => instituicoes.includes(e.instituicao));
    if (apoios.length) resultado = resultado.filter(e => apoios.includes(e.apoio));
    if (tipos.length) resultado = resultado.filter(e => tipos.includes(e.tipo));

    // 3. DATAS
    const inicio = dateStartInput ? dateStartInput.value : '';
    const fim = dateEndInput ? dateEndInput.value : '';

    if (inicio || fim) {
        resultado = resultado.filter(e => {
            const dataEdital = e.data_fechamento || e.data_abertura;
            if (!dataEdital) return false;
            
            const condicaoInicio = !inicio || dataEdital >= inicio;
            const condicaoFim = !fim || dataEdital <= fim;
            
            return condicaoInicio && condicaoFim;
        });
    }

    // 4. RENDERIZAÇÃO
    renderEditais(container, resultado);
}

// =========================
// EVENT LISTENERS UNIFICADOS
// =========================
function setupGlobalEvents() {
    if (searchInput) searchInput.addEventListener('input', aplicarFiltrosEBusca);

    if (sidebar) {
        sidebar.addEventListener('change', (e) => {
            if (e.target.matches('input[type="checkbox"]')) {
                aplicarFiltrosEBusca();
            }
        });
    }

    if (dateStartInput) dateStartInput.addEventListener('change', aplicarFiltrosEBusca);
    if (dateEndInput) dateEndInput.addEventListener('change', aplicarFiltrosEBusca);

    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (dateStartInput) dateStartInput.value = '';
            if (dateEndInput) dateEndInput.value = '';
            
            document.querySelectorAll('.filter-sidebar-compact input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });

            aplicarFiltrosEBusca();
        });
    }

    document.querySelectorAll('.filter-summary').forEach(summary => {
        summary.addEventListener('click', () => {
            const options = summary.nextElementSibling?.querySelector('.filter-options-compact');
            const target = options || summary.nextElementSibling;
            const icon = summary.querySelector('i');
            if (target) target.classList.toggle('open');
            if (icon) {
                icon.classList.toggle('fa-chevron-right');
                icon.classList.toggle('fa-chevron-down');
            }
        });
    });

    // Lógica para abrir/fechar sidebar mobile
    if (toggleBtn && sidebar && sidebarOverlay) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarOverlay.classList.toggle('active');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }
    
    // Botão de fechar dentro da sidebar (Mobile)
    if (closeSidebarBtn && sidebar && sidebarOverlay) {
        closeSidebarBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('active');
        });
    }

    if (chatButton && chatWrapper) {
        chatButton.addEventListener('click', () => {
            chatWrapper.classList.toggle('open');
            scrollToBottom();
            if (messageContainer?.children.length === 0) {
                addMessage('Olá! Busque por um tema (ex: inovação) e eu listarei os editais disponíveis.', 'bot');
            }
        });
    }

    if (sendButton && chatInput) {
        sendButton.addEventListener('click', handleChatSend);
        chatInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleChatSend();
            }
        });
    }

    if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', e => {
        if (e.target === modalOverlay) closeModal();
    });

    if (container) {
        container.addEventListener('click', e => {
            const card = e.target.closest('.notice-card');
            if (e.target.closest('.share-btn')) return; 
            if (!card) return;
            
            const edital = editaisOriginais.find(ed => ed.id.toString() === card.dataset.id);
            if (edital) openModal(edital);
        });
    }
}

// =========================
// MODAL
// =========================
function openModal(edital) {
    if (!modalOverlay || !modalContentContainer) return;

    let arquivosHtml = '';
    if (edital.arquivos && edital.arquivos.length > 0) {
        arquivosHtml = `
        <div class="attachments-section">
            <div class="attachments-summary">
                <h3>Recursos e Documentos</h3>
                <i class="fas fa-chevron-right"></i>
            </div>
            <div class="attachments-wrapper">
                <ul class="attachment-list">
                    ${edital.arquivos.map(a => `
                        <li>
                            <a href="${a.url}" target="_blank" download>
                                <i class="fas fa-link"></i> ${a.nome || 'Acessar Documento'}
                            </a>
                        </li>
                    `).join('')}
                </ul>
            </div>
        </div>`;
    } else {
        arquivosHtml = '<p style="margin-top:20px; opacity:0.7;">Nenhum documento anexado.</p>';
    }

    // GERAÇÃO DO LINK COM SLUG
    const baseUrl = window.location.origin + window.location.pathname.split('?')[0];
    // Usa slug se existir, senão usa ID
    const linkParam = edital.slug ? `edital=${edital.slug}` : `id=${edital.id}`;
    const localShareLink = `${baseUrl}?${linkParam}`;

    const shareBtnHtml = `
       <button class="modal-share-btn" onclick="navigator.clipboard.writeText('${localShareLink}'); alert('Link copiado!');">
         <i class="fas fa-link"></i> Copiar Link
       </button>`;

    modalContentContainer.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            ${edital.icone ? `<img src="${edital.icone}" alt="${edital.instituicao}" style="max-height:80px; margin-bottom:15px;">` : '<div></div>'}
            ${shareBtnHtml}
        </div>
        <h2>${edital.titulo}</h2>
        <p>${edital.descricao}</p>
        ${edital.publico_alvo ? `<p><strong>Público Alvo:</strong> ${edital.publico_alvo}</p>` : ''}
        ${edital.valor_total ? `<p><strong>Valor Total:</strong> ${edital.valor_total}</p>` : ''}
        <div class="modal-details">
            <div><strong>Instituição</strong><span>${edital.instituicao || 'Não informada'}</span></div>
            <div><strong>Estado</strong><span>${edital.estado}</span></div>
            <div><strong>Categoria</strong><span>${edital.area}</span></div>
            ${edital.data_fechamento ? `<div><strong>Fechamento</strong><span>${edital.data_fechamento}</span></div>` : ''}
        </div>
        ${arquivosHtml}
    `;

    const summary = modalContentContainer.querySelector('.attachments-summary');
    if (summary) {
        summary.addEventListener('click', () => {
            const wrapper = summary.nextElementSibling;
            const icon = summary.querySelector('i');
            wrapper.classList.toggle('open');
            if (wrapper.classList.contains('open')) {
                icon.classList.remove('fa-chevron-right');
                icon.classList.add('fa-chevron-down');
            } else {
                icon.classList.remove('fa-chevron-down');
                icon.classList.add('fa-chevron-right');
            }
        });
    }

    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    if (modalOverlay) modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
}

// =========================
// CHATBOT RAG
// =========================
function scrollToBottom() {
    if (messageContainer) setTimeout(() => messageContainer.scrollTop = messageContainer.scrollHeight, 50);
}

function buildSourcesDetails(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return null;

    const ok = sources.filter(s => s && s.status === 'ok').length;
    const total = sources.length;

    const details = document.createElement('details');
    details.className = 'chat-sources-details';
    details.style.marginTop = '10px';

    const summary = document.createElement('summary');
    summary.textContent = `📎 Fontes consultadas (${ok}/${total})`;
    details.appendChild(summary);

    const ul = document.createElement('ul');
    ul.style.margin = '8px 0 0 18px';
    ul.style.padding = '0';

    sources.slice(0, 25).forEach(s => {
        const li = document.createElement('li');

        const statusOk = s && s.status === 'ok';
        const icon = document.createElement('span');
        icon.textContent = statusOk ? '✅ ' : '⚠️ ';
        li.appendChild(icon);

        const url = (s && s.url) ? String(s.url) : '';
        const nome = (s && (s.nome || s.host)) ? String(s.nome || s.host) : 'fonte';
        const kind = (s && s.kind) ? String(s.kind) : '';
        const chars = (s && typeof s.chars === 'number') ? s.chars : null;

        if (url) {
            const a = document.createElement('a');
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = nome;
            li.appendChild(a);
        } else {
            const span = document.createElement('span');
            span.textContent = nome;
            li.appendChild(span);
        }

        const meta = document.createElement('small');
        const metaBits = [];
        if (kind) metaBits.push(kind);
        if (chars !== null) metaBits.push(`${chars} chars`);
        meta.textContent = metaBits.length ? ` (${metaBits.join(' • ')})` : '';
        li.appendChild(meta);

        if (!statusOk && s && s.error) {
            const err = document.createElement('small');
            err.textContent = ` — ${String(s.error)}`;
            li.appendChild(err);
        }

        ul.appendChild(li);
    });

    if (sources.length > 25) {
        const more = document.createElement('div');
        more.style.marginTop = '6px';
        more.style.opacity = '0.8';
        more.style.fontSize = '0.85em';
        more.textContent = `Mostrando 25 de ${total} fontes.`;
        details.appendChild(more);
    }

    details.appendChild(ul);
    return details;
}

function addMessage(content, sender, options = null, sources = null) {
    if (!messageContainer) return;
    const div = document.createElement('div');
    div.classList.add('message', sender);

    // Segurança básica: mensagem do usuário nunca entra como HTML
    if (sender === 'user') {
        div.textContent = String(content ?? '');
    } else {
        div.innerHTML = String(content ?? '');
    }

    if (options?.length) {
        const optionsContainer = document.createElement('div');
        optionsContainer.style.marginTop = '10px';
        optionsContainer.style.display = 'flex';
        optionsContainer.style.flexDirection = 'column';
        optionsContainer.style.gap = '5px';
        options.forEach(opt => {
            const btn = document.createElement('button');
            btn.className = 'chat-option-btn';
            btn.innerText = opt.titulo;
            btn.onclick = () => selectEditalContext(opt.id, opt.titulo);
            optionsContainer.appendChild(btn);
        });
        div.appendChild(optionsContainer);
    }

    // Transparência: mostra fontes consultadas (sem duplicar se o backend já embutiu)
    if (sender === 'bot' && sources && !String(content ?? '').includes('Fontes consultadas')) {
        const details = buildSourcesDetails(sources);
        if (details) div.appendChild(details);
    }

    messageContainer.appendChild(div);
    scrollToBottom();
}

function selectEditalContext(id, titulo) {
    chatState = { id, titulo };
    document.querySelectorAll('.chat-option-btn').forEach(b => b.disabled = true);
    addMessage(`✅ Edital selecionado: <strong>${titulo}</strong>`, 'user');
    setTimeout(() => {
        addMessage(`Agora estou analisando os documentos deste edital. Digite 'sair' para voltar a buscar.`, 'bot');
    }, 500);
}

async function handleChatSend() {
    if (botIsTyping || !chatInput || !messageContainer) return;
    const userText = chatInput.value.trim();
    if (!userText) return;

    if (['sair', 'voltar'].includes(userText.toLowerCase())) {
        chatState = null;
        addMessage(userText, 'user');
        setTimeout(() => addMessage("Contexto limpo. Pode buscar por novos editais.", 'bot'), 500);
        chatInput.value = '';
        return;
    }

    botIsTyping = true;
    sendButton.disabled = true;
    addMessage(userText, 'user');
    chatInput.value = '';
    addMessage('Processando...', 'bot');

    try {
        const endpoint = chatState?.id
            ? `${API_BASE}/chat/edital/${chatState.id}`
            : `${API_BASE}/chat`;

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ message: userText })
        });
        if (!res.ok) throw new Error('Erro na API');
        const responseData = await res.json();

        const last = messageContainer.lastChild;
        if (last && last.textContent.includes('Processando...')) last.remove();

        addMessage(responseData.reply, 'bot', responseData.options, responseData.sources);
    } catch (err) {
        const last = messageContainer.lastChild;
        if (last && last.textContent.includes('Processando...')) last.remove();
        addMessage('⚠️ Ocorreu um erro ao processar sua mensagem.', 'bot');
    }

    botIsTyping = false;
    sendButton.disabled = false;
    scrollToBottom();
}
