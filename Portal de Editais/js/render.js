export function renderEditais(container, editais, isAdmin = false) {
    container.innerHTML = '';

    if (!editais || editais.length === 0) {
        container.innerHTML =
            '<p class="no-results">Nenhum edital encontrado com os filtros aplicados.</p>';
        return;
    }

    editais.forEach((edital, index) => {
        const card = document.createElement('div');
        card.classList.add('notice-card');

        card.dataset.id = edital.id;
        card.style.setProperty('--animation-delay', `${index * 0.1}s`);

        // Lógica para evitar tags duplicadas (se a tag já for a Área ou Estado)
        const areaLower = edital.area ? edital.area.trim().toLowerCase() : '';
        const estadoLower = edital.estado ? edital.estado.trim().toLowerCase() : '';

        const tagsExtras = (edital.tags || [])
            .filter(tag => {
                if (!tag) return false;
                const tagLower = tag.trim().toLowerCase();
                // Exclui se for igual à área ou estado já exibidos
                return tagLower !== areaLower && tagLower !== estadoLower;
            })
            .slice(0, 2); // Limita a 2 tags extras

        // TAGS VISUAIS
        const tagsHtml = `
            ${edital.area ? `<span class="tag tag-area">${edital.area}</span>` : ''}
            ${edital.estado ? `<span class="tag tag-estado">${edital.estado}</span>` : ''}
            ${tagsExtras.map(tag => `<span class="tag tag-tema">${tag}</span>`).join('')}
        `;

        // =================================================================================
        // CORREÇÃO DE LINK: Gera o link amigável com SLUG (ex: ?edital=titulo-do-edital)
        // =================================================================================
        const baseUrl = window.location.origin + window.location.pathname.split('?')[0];
        // Prioriza o slug, senão usa ID
        const linkParam = edital.slug ? `edital=${edital.slug}` : `id=${edital.id}`;
        const localShareLink = `${baseUrl}?${linkParam}`;

        const shareButton = `
            <button class="share-btn" title="Copiar Link" onclick="navigator.clipboard.writeText('${localShareLink}'); alert('Link copiado: ${localShareLink}'); event.stopPropagation();">
                 <i class="fas fa-share-alt"></i>
            </button>`;

        card.innerHTML = `
            <div class="card-header-actions">
                ${edital.icone ? `
                    <div class="notice-icon">
                        <img src="${edital.icone}" alt="${edital.instituicao}">
                    </div>
                ` : '<div></div>'}
                ${shareButton}
            </div>

            <h3>${edital.titulo}</h3>
            <p class="description">${edital.descricao}</p>

            <div class="details">
                ${edital.data_fechamento 
                    ? `<p><strong>Data limite:</strong> ${edital.data_fechamento}</p>` 
                    : '<p><strong>Data limite:</strong> Não informada</p>'}
            </div>

            <div class="tags">
                ${tagsHtml}
            </div>
        `;

        container.appendChild(card);
    });
}