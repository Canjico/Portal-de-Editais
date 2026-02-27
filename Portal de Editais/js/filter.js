import { renderEditais } from './render.js';

let allEditais = [];
let cardsContainer = null;
let searchField = null;
let dateStartInput = null;
let dateEndInput = null;

export function initFilters(editais, container, searchInput) {
    allEditais = editais;
    cardsContainer = container;
    searchField = searchInput;
    
    // Identifica os inputs de data
    dateStartInput = document.getElementById('date-start') || document.querySelector('input[type="date"][name="start"]');
    dateEndInput = document.getElementById('date-end') || document.querySelector('input[type="date"][name="end"]');
    
    applyFilters(); 

    // Listeners para busca e datas
    searchField.addEventListener('input', applyFilters);
    if (dateStartInput) dateStartInput.addEventListener('change', applyFilters);
    if (dateEndInput) dateEndInput.addEventListener('change', applyFilters);
    
    // Listeners para os checkboxes
    document.querySelectorAll('.filter-sidebar-compact input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', applyFilters);
    });
    
    // Controle de expansão da sidebar
    document.querySelectorAll('.filter-summary').forEach(summary => {
        summary.addEventListener('click', () => {
            const options = summary.nextElementSibling;
            const icon = summary.querySelector('i');
            options.classList.toggle('open');
            icon.classList.toggle('fa-chevron-right');
            icon.classList.toggle('fa-chevron-down');
        });
    });
}

function applyFilters() {
    const query = searchField.value.trim().toLowerCase();
    
    // 1. Captura de todos os filtros ativos do HTML
    const getSelected = (type) => 
        Array.from(document.querySelectorAll(`.filter-options-compact[data-filter-type="${type}"] input:checked`))
             .map(cb => cb.value);

    const filtros = {
        estados: getSelected('estado'),
        areas: getSelected('area'), // Categorias no HTML
        instituicoes: getSelected('instituicao'), // Adicionado pois faltava no seu JS
        tipos: getSelected('tipo')
    };

    let filtered = [...allEditais];

    // 2. Busca Textual
    if (query) {
        if (typeof fuse !== 'undefined' && fuse) {
            filtered = fuse.search(query).map(result => result.item);
        } else {
            filtered = filtered.filter(e => 
                (e.titulo && e.titulo.toLowerCase().includes(query)) || 
                (e.descricao && e.descricao.toLowerCase().includes(query))
            );
        }
    }
    
    // 3. Aplicação dos Filtros de Checkbox
    if (filtros.estados.length) filtered = filtered.filter(e => filtros.estados.includes(e.estado));
    
    // Verifica "area" ou "categoria" para evitar erro de nome de propriedade
    if (filtros.areas.length) {
        filtered = filtered.filter(e => filtros.areas.includes(e.area || e.categoria));
    }
    
    if (filtros.instituicoes.length) filtered = filtered.filter(e => filtros.instituicoes.includes(e.instituicao));
    
    if (filtros.tipos.length) filtered = filtered.filter(e => filtros.tipos.includes(e.tipo));

    // 4. Filtro por Data
    const parseDate = (dateString) => {
        if (!dateString) return null;
        let d = dateString.includes('-') ? dateString.split('-') : dateString.split('/');
        return dateString.includes('-') 
            ? new Date(d[0], d[1] - 1, d[2]) // yyyy-mm-dd
            : new Date(d[2], d[1] - 1, d[0]); // dd/mm/yyyy
    };

    const startDate = parseDate(dateStartInput?.value);
    const endDate = parseDate(dateEndInput?.value);

    if (startDate || endDate) {
        filtered = filtered.filter(edital => {
            const editalDate = parseDate(edital.data_fechamento || edital.data_abertura); 
            if (!editalDate) return false; 
            const afterStart = !startDate || editalDate >= startDate;
            const beforeEnd = !endDate || editalDate < new Date(endDate.getTime() + 86400000); 
            return afterStart && beforeEnd;
        });
    }

    // 5. Renderização
    const adminMode = typeof isAdminLogged === 'function' ? isAdminLogged() : false;
    renderEditais(cardsContainer, filtered, adminMode);
}
