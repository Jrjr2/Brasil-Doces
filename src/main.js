import './style.css';
    const SUPABASE_URL = 'https://ebfkwuslmneswvovygwh.supabase.co'; 
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViZmt3dXNsbW5lc3d2b3Z5Z3doIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNzU3NzUsImV4cCI6MjA5MDc1MTc3NX0.ElCyWYPr330VLsY6LZIa41Fg9QR_VaHeBj36jQ8oVt0'; 
    const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    let dbClientes = [], dbProdutos = [], clienteEmEdicao = null;
    let pixConfig = { chave_pix: '', nome_pix: '' }; 
    let clienteAbertoId = null; 
    let carrinhos = {}; // Formato: { idCliente: [{ it, qt, vl }] }
    let primeiraCarga = true;

    window.filtroDevedoresAtivo = false;
    window.clientesCobradosSessao = new Set();

    window.toggleFiltroDevedores = () => {
        window.filtroDevedoresAtivo = !window.filtroDevedoresAtivo;
        const btn = document.getElementById('btnFiltroDevedores');
        if (window.filtroDevedoresAtivo) {
            btn.className = 'btn-filtro-on';
            window.clientesCobradosSessao.clear(); // Reseta a sessão
        } else {
            btn.className = 'btn-filtro-off';
        }
        render();
    };

    window.cobrarWhatsAppSessao = (clienteId, nome, valor, pendentesQtd) => {
        window.clientesCobradosSessao.add(clienteId);
        
        let texto = `Oi ${nome}, tudo bem? 😊\nPassando para avisar que sua sacola do Brasil Doces com ${pendentesQtd} itens (Total: *R$ ${valor.toFixed(2)}*) já está disponível para acerto!\n\nAgradeço muito a preferência e fico no aguardo!`;
        let encoded = encodeURIComponent(texto);
        
        const cliente = dbClientes.find(c => c.id === clienteId);
        let link = `https://wa.me/?text=${encoded}`;
        
        if (cliente && cliente.telefone && !cliente.telefone.includes('N/A')) {
            let numero = cliente.telefone.replace(/\D/g, '');
            if(numero.length >= 10 && numero.length <= 11) {
                if(numero.length === 10) numero = '55' + numero.substring(0,2) + '9' + numero.substring(2);
                else if(numero.length === 11) numero = '55' + numero;
                link = `https://wa.me/${numero}?text=${encoded}`;
            }
        }
        
        window.open(link, '_blank');
        render(); // Vai sumir da tela instantaneamente
    };

    window.fecharModais = () => {
        document.getElementById('modalHistorico').style.display = 'none';
        document.getElementById('modalResumo').style.display = 'none';
        const rel = document.getElementById('modalRelatorioMensal');
        if (rel) rel.style.display = 'none';
        sessionStorage.removeItem('modalAberto'); // Limpa a memória de reabertura ao fechar
    };
    window.fecharModalHistorico = window.fecharModais;

    let itensPendentesGlobal = []; 
    let _pendingVenda = null;
    let _vendaQueue = [];
    let _queueIndex = 0;
    let _vendaResults = [];
    let _pendingClienteId = null; 
    let valoresOcultos = false;
    let _tipoVendaSelecionado = null;

    function obterChaveMensagemFerHoje() {
        const hoje = new Date();
        const ano = hoje.getFullYear();
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const dia = String(hoje.getDate()).padStart(2, '0');
        return `mensagemFer-${ano}-${mes}-${dia}`;
    }
    window.fecharMensagemFer = () => {
        const overlay = document.getElementById('dailyGreetingOverlay');
        if (overlay) overlay.classList.remove('active');
    };
    function exibirMensagemFerDoDia() {
        const chaveHoje = obterChaveMensagemFerHoje();
        if (localStorage.getItem(chaveHoje) === 'ok') return;
        const overlay = document.getElementById('dailyGreetingOverlay');
        if (!overlay) return;
        overlay.classList.add('active');
        localStorage.setItem(chaveHoje, 'ok');
    }

    async function limparSessaoExpirada() {
        await _supabase.auth.signOut();
        document.getElementById('authContainer').style.display = 'flex';
        document.getElementById('mainContainer').style.display = 'none';
        alert('Sua sessao expirou. Faca login novamente.');
    }

    async function checkUser() {
    carregarTema();
    carregarVisibilidadeValores();
    const { data: { session } } = await _supabase.auth.getSession();
    
    if (session) {
        const { error: userError } = await _supabase.auth.getUser();
        if (userError) {
            await limparSessaoExpirada();
            return;
        }
        document.getElementById('authContainer').style.display = 'none';
        document.getElementById('mainContainer').style.display = 'block';
        
        await carregarDados();
        await carregarConfiguracoes();
        configurarRealtime();
        render();
        exibirMensagemFerDoDia();
    } else { // O erro costuma ser aqui se o bloco de cima não fechou direito
        document.getElementById('authContainer').style.display = 'flex';
        document.getElementById('mainContainer').style.display = 'none';
    }
}

        async function carregarDados() {
        const { data: p } = await _supabase.from('produtos').select('*').order('nome');
        dbProdutos = p || [];
        const { data: c } = await _supabase.from('clientes').select('*, compras(*)').order('nome');
        let clientesArray = c || [];
        clientesArray.sort((a, b) => {
            const getMaxInteraction = (cliente) => {
                if (!cliente.compras || cliente.compras.length === 0) return 0;
                return Math.max(...cliente.compras.map(comp => new Date(comp.data || 0).getTime()));
            };
            const dataA = getMaxInteraction(a);
            const dataB = getMaxInteraction(b);
            if (dataA !== dataB) return dataB - dataA;
            return a.nome.localeCompare(b.nome);
        });
        dbClientes = clientesArray;
        render();
        renderDashboard();

        // Truque Mágico: Se a página recarregar, abre automaticamente de onde estava!
        if (primeiraCarga) {
            primeiraCarga = false;
            const estadoModal = sessionStorage.getItem('modalAberto');
            if (estadoModal) {
                const partes = estadoModal.split('-');
                if (partes[0] === 'hist') abrirHistorico(parseInt(partes[1]));
                if (partes[0] === 'res') abrirResumoConta(parseInt(partes[1]));
                if (partes[0] === 'rel') abrirRelatorioMensal(parseInt(partes[1]));
            }
        }
    }

    window.abrirRelatorioMensal = (mesIndex) => {
        sessionStorage.setItem('modalAberto', 'rel-' + mesIndex);
        fecharModais(); // Fecha os outros modais por segurança
        
        const nomesMeses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
        const anoAtual = new Date().getFullYear();
        document.getElementById('tituloRelatorioMensal').innerText = `RELATÓRIO - ${nomesMeses[mesIndex].toUpperCase()} / ${anoAtual}`;

        let totalGeral = 0;
        let totalRecebido = 0;
        let totalPendente = 0;
        let qtdBrindes = 0;
        
        let clientesCompradores = [];

        dbClientes.forEach(cliente => {
            const comprasDoMes = (cliente.compras || []).filter(compra => {
                if (!compra.data) return false;
                const dataObj = new Date(compra.data);
                // "quitado" é a grana que entrou hoje pagando conta antiga.
                // Registramos o relatório baseado na data que o dinheiro entrou/venda feita.
                return dataObj.getMonth() === mesIndex && dataObj.getFullYear() === anoAtual && compra.valor_total !== undefined;
            });

            if (comprasDoMes.length > 0) {
                let resumoCliente = { nome: cliente.nome, itens: [], totalCliente: 0 };
                
                comprasDoMes.forEach(c => {
                    const status = c.status || 'pago'; // Se não tem status, é antigo e pago na hora
                    const ehBrinde = status === 'brinde';
                    const valor = ehBrinde ? 0 : c.valor_total;
                    const valorUnit = c.qtd > 0 ? (valor / c.qtd) : valor;

                    resumoCliente.itens.push({
                        desc: c.descricao,
                        qtd: c.qtd || 1,
                        val: valor,
                        status: status
                    });

                    if (ehBrinde) {
                        qtdBrindes++;
                    } else if (valor > 0) { // Ignorar registros de 'baixa' puramente burocráticos (<0)
                        totalGeral += valor;
                        resumoCliente.totalCliente += valor;
                        if (status === 'pago' || status === 'quitado') totalRecebido += valor;
                        if (status === 'pendente') totalPendente += valor;
                    }
                });

                if (resumoCliente.itens.length > 0) {
                    clientesCompradores.push(resumoCliente);
                }
            }
        });

        // Ordenar compradores por quem gastou mais
        clientesCompradores.sort((a, b) => b.totalCliente - a.totalCliente);

        // Preencher KPIs
        const kpisHtml = `
            <div class="account-stat pending">
                <div class="account-stat-label">Anotados</div>
                <div class="account-stat-value money-value" style="color:var(--danger);">R$ ${totalPendente.toFixed(2)}</div>
            </div>
            <div class="account-stat paid">
                <div class="account-stat-label">Já Recebido</div>
                <div class="account-stat-value money-value" style="color:var(--success);">R$ ${totalRecebido.toFixed(2)}</div>
            </div>
        `;
        document.getElementById('kpisRelatorioMensal').innerHTML = kpisHtml;

        // Renderizar Lista de Clientes
        let htmlCorpo = '';
        if (clientesCompradores.length === 0) {
            htmlCorpo = '<div class="account-empty">Nenhuma movimentação neste mês.</div>';
        } else {
            clientesCompradores.forEach(c => {
                htmlCorpo += `<div class="relatorio-cliente">`;
                htmlCorpo += `  <div class="relatorio-cliente-nome"><span>${c.nome}</span><span class="relatorio-cliente-total money-value">Total: R$ ${c.totalCliente.toFixed(2)}</span></div>`;
                c.itens.forEach(i => {
                    let badgeClass = 'bg-pago';
                    let badgeTxt = 'PAGO';
                    if (i.status === 'pendente') { badgeClass = 'bg-pendente'; badgeTxt = 'ANOTADO'; }
                    if (i.status === 'quitado') { badgeClass = 'bg-quitado'; badgeTxt = 'QUITADO'; }
                    if (i.status === 'brinde') { badgeClass = 'bg-brinde'; badgeTxt = 'BRINDE'; }

                    htmlCorpo += `
                        <div class="relatorio-item">
                            <div class="qtd">${i.qtd}x</div>
                            <div class="desc">${i.desc} <span class="badge-status ${badgeClass}">${badgeTxt}</span></div>
                            <div class="val money-value">R$ ${i.val.toFixed(2)}</div>
                        </div>`;
                });
                htmlCorpo += `</div>`;
            });
        }
        
        const containerCorpo = document.getElementById('corpoRelatorioMensal');
        containerCorpo.innerHTML = htmlCorpo;

        document.getElementById('modalRelatorioMensal').style.display = 'block';
    };


    // Crie uma função para configurar os eventos após o login
    async function carregarConfiguracoes() {
        // Tenta puxar do banco pegando apenas o primeiro resultado
        const { data, error } = await _supabase.from('configuracoes').select('*').limit(1).single();
        
        if (error && error.code !== 'PGRST116') {
            if ((error.message || '').toLowerCase().includes('jwt expired')) {
                await limparSessaoExpirada();
                return;
            }
            alert("⚠️ Erro ao buscar Pìx do Banco: " + error.message);
        }

        if (data) {
            pixConfig = data; // Salva globalmente
            
            // Preenche os campos se eles existirem na tela
            const inputChave = document.getElementById('cfgChavePix');
            const inputNome = document.getElementById('cfgNomePix');
            if (inputChave) inputChave.value = data.chave_pix || '';
            if (inputNome) inputNome.value = data.nome_pix || '';
        }
    }  
    

    function toggleTheme() {
        const body = document.body;
        body.classList.toggle('dark-mode');
        localStorage.setItem('tema', body.classList.contains('dark-mode') ? 'dark' : 'light');
    }

    function carregarTema() { if (localStorage.getItem('tema') === 'dark') document.body.classList.add('dark-mode'); }
    function atualizarBotaoValores() {
        const btn = document.getElementById('visibilityBtn');
        if (!btn) return;
        btn.title = valoresOcultos ? 'Mostrar valores' : 'Ocultar valores';
        btn.innerHTML = `<i class="fa-solid ${valoresOcultos ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
    }
    function aplicarVisibilidadeValores() {
        document.body.classList.toggle('hide-values', valoresOcultos);
        atualizarBotaoValores();
    }
    function carregarVisibilidadeValores() {
        valoresOcultos = localStorage.getItem('valoresOcultos') === 'true';
        aplicarVisibilidadeValores();
    }
    function toggleValores() {
        valoresOcultos = !valoresOcultos;
        localStorage.setItem('valoresOcultos', valoresOcultos ? 'true' : 'false');
        aplicarVisibilidadeValores();
        setTimeout(renderDashboard, 100);
    }
    function normalizarTexto(texto) {
        return (texto || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }
    function getTipoVendaLabel(tipo) {
        if (tipo === 'pago') return 'Pagamento';
        if (tipo === 'brinde') return 'Brinde';
        if (tipo === 'conta') return 'Anotar';
        return 'Pendente';
    }
    function getTipoVendaClasse(tipo) {
        if (tipo === 'pago') return 'is-pago';
        if (tipo === 'brinde') return 'is-brinde';
        if (tipo === 'conta') return 'is-conta';
        return '';
    }
    function agruparItensConta(itens, valorKey) {
        const grupos = new Map();

        itens.forEach(item => {
            const dataFmt = new Date(item.data).toLocaleDateString('pt-BR').substring(0, 5);
            const qtd = item.qtd || 1;
            const valor = Number(item[valorKey] || 0);
            const valorUnitario = qtd > 0 ? Number((valor / qtd).toFixed(4)) : valor;
            const status = item.status || '';
            const key = `${dataFmt}|${item.descricao}|${status}|${valorUnitario}`;

            if (!grupos.has(key)) {
                grupos.set(key, {
                    ids: [],
                    dataFmt,
                    descricao: item.descricao,
                    qtd: 0,
                    valor: 0,
                    status,
                    isBrinde: status === 'brinde'
                });
            }

            const grupo = grupos.get(key);
            if (item.id) grupo.ids.push(item.id);
            grupo.qtd += qtd;
            grupo.valor += valor;
        });

        return Array.from(grupos.values());
    }
    function atualizarBotaoSalvarFila() {
        const btnConfirmar = document.getElementById('btnConfirmarTipoVenda');
        if (!btnConfirmar) return;

        const faltantes = _vendaResults.filter(res => !res).length;
        btnConfirmar.disabled = faltantes > 0;
        btnConfirmar.innerHTML = `<i class="fa-solid fa-check"></i> ${faltantes > 0 ? `SALVAR (${_vendaQueue.length - faltantes}/${_vendaQueue.length})` : 'SALVAR'}`;
    }
    function mascaraData(input) { let v = input.value.replace(/\D/g, ""); if (v.length > 2) v = v.substring(0, 2) + "/" + v.substring(2, 4); input.value = v; }
    
    function configurarRealtime() { 
        _supabase.channel('db_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'compras' }, () => carregarDados())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => carregarDados())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracoes' }, (payload) => { pixConfig = payload.new; })
            .subscribe(); 
    }

    async function sair() { await _supabase.auth.signOut(); window.location.reload(); }
            // Força o scroll inteligente e lida com o "Lag" da primeira abertura na bateria
    window.focarBotaoInteligente = (campo) => {
        // Pulsa a centralização 3 vezes para acompanhar a velocidade real que o teclado sobe!
        const centralizar = () => campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(centralizar, 150); // Para teclados rápidos
        setTimeout(centralizar, 450); // Para a média
        setTimeout(centralizar, 800); // Para o lag da primeira abertura
    };

    window.filtrarDocesCard = (input, idCliente) => {
        const busca = normalizarTexto(input.value.trim());
        const card = input.closest('.card');
        if (!card) return;
        const pills = card.querySelectorAll('.btn-pill');
        pills.forEach(p => {
            const texto = normalizarTexto(p.dataset.produto);
            p.style.display = texto.includes(busca) ? 'flex' : 'none';
        });
    };



    function render() {
    try {
        const buscaInput = document.getElementById('buscaCliente');
        if (!buscaInput) return;

        const busca = normalizarTexto(buscaInput.value.trim());
        const listaDiv = document.getElementById('lista');
        
        listaDiv.innerHTML = '';

        let totalH = 0, totalG = 0, totalAVista = 0;
        const hoje = new Date().toLocaleDateString('pt-BR').substring(0, 5);

        let filtrados = dbClientes.filter(c => 
            c.nome && 
            c.nome !== 'VENDA AVULSA (BALCÃO)' && 
            normalizarTexto(c.nome).startsWith(busca)
        ).map(c => {
            const comprasValidas = c.compras || [];
            const saldo = comprasValidas
                .filter(i => {
                    const status = i.status || 'pago'; 
                    return i.valor_total > 0 && status === 'pendente';
                })
                .reduce((acc, i) => acc + (i.valor_total || 0), 0);
            
            const pendentes = comprasValidas.filter(i => {
                const status = i.status || 'pago';
                return i.valor_total > 0 && status === 'pendente';
            });
            
            return { ...c, saldoCalculado: saldo, pendentesCalculados: pendentes, comprasValidas: comprasValidas };
        });

        if (window.filtroDevedoresAtivo) {
            filtrados = filtrados.filter(c => c.saldoCalculado > 0 && !window.clientesCobradosSessao.has(c.id));
            filtrados.sort((a,b) => b.saldoCalculado - a.saldoCalculado);
        }

        filtrados.forEach(c => {
            const saldo = c.saldoCalculado;
            const pendentes = c.pendentesCalculados;
            const comprasValidas = c.comprasValidas;
            
            const textoPendencia = pendentes.length === 0 ? 'Conta em dia' : `${pendentes.length} pendente${pendentes.length > 1 ? 's' : ''}`;
            const classePendencia = pendentes.length === 0 ? 'is-clear' : 'is-pending';
            totalG += saldo;

            comprasValidas.forEach(cp => {
                const status = cp.status || 'pago';
                const ehHoje = cp.data && new Date(cp.data).toLocaleDateString('pt-BR').substring(0, 5) === hoje;
                if (ehHoje && cp.valor_total > 0) {
                    totalH += cp.valor_total;
                }
                if (ehHoje && cp.valor_total > 0 && status === 'pago') {
                    totalAVista += cp.valor_total;
                }
            });

            const card = document.createElement('div');
            card.className = 'card';
                        // PREPARAÇÃO DOS CHIPS DA VITRINE
            let chipsHtml = '';
            if (dbProdutos && dbProdutos.length > 0) {
                const getIconeDoce = (n) => {
                    n = n.toLowerCase();
                    if (n.includes('pote') || n.includes('copo') || n.includes('taça')) return '🧁';
                    if (n.includes('bolo') || n.includes('torta')) return '🍰';
                    if (n.includes('brigadeiro') || n.includes('beijinho')) return '🟤';
                    if (n.includes('brownie')) return '🟫';
                    if (n.includes('bombom') || n.includes('trufa')) return '🍬';
                    if (n.includes('cookie') || n.includes('biscoito')) return '🍪';
                    if (n.includes('donut')) return '🍩';
                    if (n.includes('morango')) return '🍓';
                    if (n.includes('uva')) return '🍇';
                    if (n.includes('ninho')) return '🥛';
                    if (n.includes('barra') || n.includes('chocolate')) return '🍫';
                    const iconesGen = ['✨', '🍡', '🍧', '🍥', '🍨'];
                    return iconesGen[n.length % iconesGen.length];
                };
                
                chipsHtml += '<div class="quick-products-row">';
                
                dbProdutos.forEach((p) => {
                    let ico = getIconeDoce(p.nome); 
                    // Garante que aspas nos nomes não quebrem o código
                    let nomeSeguro = p.nome.replace(/'/g, "\\'");
                    chipsHtml += `
                    <div class="btn-pill" data-produto="${p.nome}" onclick="preencherRapido(${c.id}, '${nomeSeguro}', ${p.preco})">
                        <span style="font-size: 16px; margin-bottom: 2px;">${ico}</span>
                        ${p.nome}
                        <small>R$ ${p.preco.toFixed(2)}</small>
                    </div>`;
                });
                
                chipsHtml += '</div>';
            }

            // VERIFICA SE É ANIVERSÁRIO HOJE
            let niverHtml = '';
            if (c.aniversario && c.aniversario === hoje) {
                niverHtml = `
                <div style="background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%); color: #7a1f3d; padding: 8px 12px; border-radius: 12px; font-weight: 800; font-size: 11px; margin-bottom: 15px; border: 1px solid rgba(255, 133, 162, 0.4); display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 15px rgba(255, 133, 162, 0.2);">
                    <i class="fa-solid fa-gift" style="color: #d81b60; font-size: 15px;"></i> 
                    ESPECIAL: HOJE É ANIVERSÁRIO DO CLIENTE! 🎉
                </div>`;
            }

            // O HTML DO CARD COM A ADIÇÃO DA VITRINE:
            let cartHtml = '';
            const itemsCart = carrinhos[c.id] || [];
            if (itemsCart.length > 0) {
                let totalCart = itemsCart.reduce((sum, i) => sum + (i.qt * i.vl), 0);
                cartHtml = `
                <div style="background: rgba(255, 92, 138, 0.05); border: 1px dashed var(--accent); border-radius: 12px; padding: 12px; margin-bottom: 12px;">
                    <span style="font-size: 10px; font-weight: 800; color: var(--accent); text-transform: uppercase;">🛒 CESTA DE COMPRAS</span>
                    <div style="margin-top: 8px;">
                        ${itemsCart.map((it, idx) => `
                        <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                            <span>${it.qt}x ${it.it}</span>
                            <span style="display: flex; align-items: center; gap: 8px;">
                                <span class="money-value keep-visible">R$ ${(it.qt * it.vl).toFixed(2)}</span>
                                <i class="fa-solid fa-circle-xmark" style="color: var(--danger); cursor: pointer;" onclick="removerDoCarrinho(${c.id}, ${idx})"></i>
                            </span>
                        </div>`).join('')}
                    </div>
                    <div style="border-top: 1px solid var(--accent); margin-top: 8px; padding-top: 8px; display: flex; justify-content: space-between; font-weight: 800; font-size: 14px; color: var(--accent);">
                        <span>TOTAL CESTA:</span>
                        <span class="money-value keep-visible">R$ ${totalCart.toFixed(2)}</span>
                    </div>
                </div>`;
            }

            let botaoCobrarHtml = '';
            if (saldo > 0) {
                // Escape simple quotes on name
                let nomeSafe = c.nome.replace(/'/g, "\\'");
                botaoCobrarHtml = `<button class="btn-cobrar-whatsapp" onclick="cobrarWhatsAppSessao(${c.id}, '${nomeSafe}', ${saldo}, ${pendentes.length})" title="Cobrar este cliente (Tira da tela)"><i class="fa-brands fa-whatsapp"></i> COBRAR</button>`;
            }

            card.innerHTML = `
                <div class="card-header">
                    <span style="font-weight:800; color: var(--brown);">${c.nome.toUpperCase()} ${botaoCobrarHtml}</span>
                    <details class="dropdown-dots" style="position: relative; margin: 0;">
                        <summary style="list-style: none; cursor: pointer; color: var(--brown); font-size: 18px; padding: 4px 10px; user-select: none;">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </summary>
                        <div style="position: absolute; right: 0; top: 100%; min-width: 140px; background: var(--card); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); z-index: 100; overflow: hidden; display: flex; flex-direction: column; border: 1px solid var(--border); margin-top: 5px;">
                            <button onclick="this.closest('details').removeAttribute('open'); prepararEdicao(${c.id})" style="padding: 12px 16px; border: none; background: transparent; text-align: left; font-size: 13px; font-weight: 700; cursor: pointer; color: var(--text); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; border-radius: 0; justify-content: flex-start; margin: 0;">
                                <i class="fa-solid fa-pen-to-square" style="color: var(--primary);"></i> Editar Cliente
                            </button>
                            <button onclick="this.closest('details').removeAttribute('open'); excluir(${c.id})" style="padding: 12px 16px; border: none; background: transparent; text-align: left; font-size: 13px; font-weight: 700; cursor: pointer; color: var(--danger); display: flex; align-items: center; gap: 10px; border-radius: 0; justify-content: flex-start; margin: 0;">
                                <i class="fa-solid fa-trash-can"></i> Excluir Conta
                            </button>
                        </div>
                    </details>
                </div>
                ${niverHtml}
                <div class="client-summary-row">
                    <span class="price-tag money-value">R$ ${saldo.toFixed(2)}</span>
                    <span class="client-status-badge ${classePendencia}">${textoPendencia}</span>
                </div>
                
                ${chipsHtml}
                ${cartHtml}

                <div style="margin-bottom: 10px;">
                    <input type="text" id="it-${c.id}" placeholder="🔍 Pesquisa" onfocus="focarBotaoInteligente(this)" oninput="window.filtrarDocesCard(this, ${c.id})">
                </div>

                <button class="btn-main" onclick="salvarVenda(${c.id})">${itemsCart.length > 0 ? 'CONFIRMAR VENDA' : 'ANOTAR'}</button>
                <div style="display:grid; grid-template-columns: 1fr; gap:8px;">
                    <button class="btn-action" onclick="abrirHistorico(${c.id})"><i class="fa-solid fa-wallet"></i> CONTA</button>
                </div>`;
            listaDiv.appendChild(card);
        });

        document.getElementById('totalHoje').innerText = `R$ ${totalH.toFixed(2)}`;
        document.getElementById('totalAVista').innerText = `R$ ${totalAVista.toFixed(2)}`;
        document.getElementById('totalGeral').innerText = `R$ ${totalG.toFixed(2)}`;
    } catch (err) {
        console.error("Erro na renderização:", err);
    }
}

    let profitChart = null;

    function renderDashboard() {
        try {
            // 1. Processar Top Produtos
            const contagemProd = {};
            let todasCompras = [];
            
            dbClientes.forEach(c => {
                if(c.compras) todasCompras = todasCompras.concat(c.compras);
            });

            todasCompras.forEach(compra => {
                // Considera apenas itens pagos (>0) e exclui a label de recarga interna
                if (compra.valor_total > 0 && compra.descricao && compra.descricao !== "PAGAMENTO EFETUADO") {
                    const desc = compra.descricao.toUpperCase();
                    if (!contagemProd[desc]) contagemProd[desc] = 0;
                    contagemProd[desc] += (compra.qtd || 1);
                }
            });

            const arrayProd = Object.keys(contagemProd).map(nome => {
                return { nome: nome, qtd: contagemProd[nome] };
            });

            arrayProd.sort((a, b) => b.qtd - a.qtd);
            const top3 = arrayProd.slice(0, 3);

            const top3Container = document.getElementById('top3Container');
            if (top3Container) {
                if (top3.length === 0) {
                    top3Container.innerHTML = '<div class="top-empty">Ainda não há produtos registrados.</div>';
                } else {
                    const cores = ['#f6d365', '#4facfe', '#a18cd1'];
                    const maxQtd = Math.max(...top3.map(p => p.qtd), 1);
                    top3Container.innerHTML = top3.map((p, idx) => {
                        const largura = (p.qtd / maxQtd) * 100;
                        return `
                            <div class="top-item">
                                <div class="top-rank" style="background:${cores[idx]};">${idx + 1}</div>
                                <div class="top-meta">
                                    <div class="top-name">${p.nome}</div>
                                    <div class="top-sub">${p.qtd} unidades vendidas</div>
                                    <div class="top-track">
                                        <div class="top-fill" style="width:${largura}%; background:${cores[idx]};"></div>
                                    </div>
                                </div>
                            </div>`;
                    }).join('');
                }
            }

            // 2. Processar Gráfico de Faturamento por Mês (Ano Atual)
            const anoAtual = new Date().getFullYear();
            const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
            const faturamentoPorMes = new Array(12).fill(0);

            todasCompras.forEach(compra => {
                if (compra.valor_total < 0 && compra.data && compra.status === 'pagamento') {
                    const dataObj = new Date(compra.data);
                    if (dataObj.getFullYear() === anoAtual) {
                        faturamentoPorMes[dataObj.getMonth()] += Math.abs(compra.valor_total);
                    }
                }
            });

            const labels = nomesMeses;
            const dataValues = faturamentoPorMes;
            const mesAtual = new Date().getMonth();
            const totalAno = dataValues.reduce((acc, val) => acc + val, 0);
            const maiorValor = Math.max(...dataValues, 0);
            const melhorMes = maiorValor > 0 ? `${labels[dataValues.indexOf(maiorValor)]}: R$ ${maiorValor.toFixed(2)}` : 'Sem recebimentos';

            const isDark = document.body.classList.contains('dark-mode');
            const textColor = isDark ? '#f4e9ed' : '#5d4037';
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            const barColors = dataValues.map((_, idx) => idx === mesAtual ? 'rgba(255, 92, 138, 0.95)' : 'rgba(255, 92, 138, 0.34)');
            const borderColors = dataValues.map((_, idx) => idx === mesAtual ? '#ff5c8a' : 'rgba(255, 92, 138, 0.58)');

            const chartPeriodo = document.getElementById('chartPeriodo');
            const chartTotalAno = document.getElementById('chartTotalAno');
            const chartMelhorMes = document.getElementById('chartMelhorMes');
            if (chartPeriodo) chartPeriodo.innerText = String(anoAtual);
            if (chartTotalAno) chartTotalAno.innerText = valoresOcultos ? 'R$ ----' : `R$ ${totalAno.toFixed(2)}`;
            if (chartMelhorMes) chartMelhorMes.innerText = valoresOcultos && maiorValor > 0 ? `${labels[dataValues.indexOf(maiorValor)]} - R$ ----` : melhorMes;

            const ctx = document.getElementById('faturamentoChart');
            if (ctx) {
                if (profitChart) profitChart.destroy();
                
                Chart.defaults.font.family = "'Inter', sans-serif";
                
                profitChart = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Recebido R$',
                            data: dataValues,
                            borderColor: borderColors,
                            backgroundColor: barColors,
                            hoverBackgroundColor: '#ff7aa3',
                            borderRadius: 14,
                            borderSkipped: false,
                            maxBarThickness: 45,
                            barPercentage: 0.75,
                            categoryPercentage: 0.85
                        }]
                    },
                    options: {
                        onClick: (event, elements) => {
                            if (elements.length > 0) abrirRelatorioMensal(elements[0].index);
                        },
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: {
                            duration: 800,
                            easing: 'easeOutQuart'
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                displayColors: false,
                                backgroundColor: isDark ? 'rgba(19, 17, 24, 0.96)' : 'rgba(255,255,255,0.96)',
                                titleColor: isDark ? '#fff' : '#5d4037',
                                bodyColor: isDark ? '#f8dfe7' : '#7a4458',
                                borderColor: 'rgba(255, 92, 138, 0.18)',
                                borderWidth: 1,
                                padding: 12,
                                callbacks: {
                                    label: (context) => valoresOcultos ? 'Recebido: R$ ----' : `Recebido: R$ ${Number(context.parsed.y || 0).toFixed(2)}`
                                }
                            }
                        },
                        scales: {
                            x: {
                                ticks: { color: textColor, font: { weight: '800' } },
                                grid: { display: false },
                                border: { display: false }
                            },
                            y: {
                                ticks: {
                                    color: textColor,
                                    maxTicksLimit: 5,
                                    padding: 8,
                                    callback: (value) => valoresOcultos ? '----' : `R$ ${Number(value).toFixed(0)}`
                                },
                                grid: { color: gridColor, drawBorder: false, borderDash: [4, 4] },
                                border: { display: false },
                                beginAtZero: true
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.error("Erro no Dashboard:", e);
        }
    }

    // Hook para o botão de tema atualizar graficos
    const originalToggle = toggleTheme;
    window.toggleTheme = function() {
        originalToggle();
        setTimeout(renderDashboard, 100);
    };
    window.toggleValores = toggleValores;

    function obterQuitadosRecentes(cliente) {
        const compras = cliente.compras || [];
        const hoje = new Date();
        const mesAtual = hoje.getMonth();
        const anoAtual = hoje.getFullYear();
        const itensPagos = compras.filter(i => i.status === 'pago').map(i => ({ ...i, valor_pago: i.valor_total }));
        const itensBrindes = compras.filter(i => i.status === 'brinde').map(i => ({ ...i, valor_pago: 0 }));
        const itensQuitados = compras.filter(i => i.status === 'quitado').map(i => ({ ...i, valor_pago: i.valor_total }));

        return [...itensPagos, ...itensBrindes, ...itensQuitados]
            .sort((a, b) => new Date(a.data) - new Date(b.data))
            .filter(i => {
                const dataItem = new Date(i.data);
                return dataItem.getMonth() === mesAtual && dataItem.getFullYear() === anoAtual;
            });
    }
    function obterQuitadosPdf(cliente) {
        const compras = cliente.compras || [];
        const hoje = new Date();
        const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);

        const itensPagos = compras.filter(i => i.status === 'pago').map(i => ({ ...i, valor_pago: i.valor_total }));
        const itensBrindes = compras.filter(i => i.status === 'brinde').map(i => ({ ...i, valor_pago: 0 }));
        const itensQuitados = compras.filter(i => i.status === 'quitado').map(i => ({ ...i, valor_pago: i.valor_total }));

        return [...itensPagos, ...itensBrindes, ...itensQuitados]
            .sort((a, b) => new Date(a.data) - new Date(b.data))
            .filter(i => {
                const dataItem = new Date(i.data);
                return dataItem >= inicioMesAnterior;
            });
    }

    function preencherExtratoQuitados(container, quitadosRecentes) {
        container.innerHTML = '<div class="extrato-header" style="grid-template-columns: 85px 35px 1fr 70px;"><div>DATA/HORA</div><div>QTD</div><div>PRODUTO</div><div style="text-align:right">PAGO</div></div>';

        if (quitadosRecentes.length === 0) {
            container.innerHTML += '<div style="text-align:center; padding: 20px; color: #999; font-size:12px;">Nenhum produto recebido no periodo.</div>';
            return;
        }

        quitadosRecentes.forEach(i => {
            const dataObj = new Date(i.data);
            const dataFmt = dataObj.toLocaleDateString('pt-BR').substring(0,5);
            const horaFmt = dataObj.toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
            const isBrinde = i.status === 'brinde';

            container.innerHTML += `
                <div class="extrato-item" style="grid-template-columns: 85px 35px 1fr 70px;">
                    <div style="font-size:10px; opacity:0.8; font-weight:700;">${dataFmt}<br><span style="font-weight:400">${horaFmt}</span></div>
                    <div class="qtd">${i.qtd}x</div>
                    <div>${i.descricao} ${isBrinde ? '<span style="font-size:9px; background:var(--accent); color:#fff; padding:2px 4px; border-radius:4px; margin-left:4px;">BRINDE</span>' : ''}</div>
                    <div class="valor money-value">R$ ${i.valor_pago.toFixed(2)}</div>
                </div>`;
        });
    }

    window.abrirHistorico = (id) => {
    sessionStorage.setItem('modalAberto', 'hist-'+id);
    clienteAbertoId = id;
    document.getElementById('modalResumo').style.display = 'none'; // Fecha o outro por segurança
    const c = dbClientes.find(x => x.id === id);
        const quitadosRecentes = obterQuitadosRecentes(c);
        const comprasApenas = c.compras
            .filter(i => i.valor_total > 0)
            .filter(i => {
                const status = i.status || 'pago';
                return status === 'pendente';
            })
            .sort((a,b) => new Date(a.data) - new Date(b.data));
        
        itensPendentesGlobal = [];
        comprasApenas.forEach(item => { 
            itensPendentesGlobal.push({...item, valor_exibir: item.valor_total});
        });
        const itensPendentesAgrupados = agruparItensConta(itensPendentesGlobal, 'valor_exibir');
        const quitadosRecentesAgrupados = agruparItensConta(quitadosRecentes, 'valor_pago');
        const totalPendente = itensPendentesGlobal.reduce((acc, i) => acc + i.valor_exibir, 0);
        const totalQuitado = quitadosRecentes.reduce((acc, i) => acc + (i.valor_pago || 0), 0);

        document.getElementById('nomeClienteModal').innerText = c.nome.toUpperCase();
        let html = '';

        html += `<div class="account-summary-grid">
            <div class="account-stat pending">
                <div class="account-stat-label">Pendente</div>
                <div class="account-stat-value money-value" style="color:var(--danger);">R$ ${totalPendente.toFixed(2)}</div>
                <div class="account-stat-meta">${itensPendentesGlobal.length} itens</div>
            </div>
            <div class="account-stat paid">
                <div class="account-stat-label">Valores ja recebidos</div>
                <div class="account-stat-value money-value" style="color:var(--success);">R$ ${totalQuitado.toFixed(2)}</div>
                <div class="account-stat-meta">${quitadosRecentes.length} itens no mes</div>
            </div>
        </div>`;

        html += `<div class="account-section-title"><span>⚠️ PENDENTE</span><span>${itensPendentesGlobal.length} itens</span></div>`;

        if (itensPendentesGlobal.length === 0) {
            html += `<div class="account-empty">Nenhum item pendente</div>`;
        } else {
            itensPendentesAgrupados.forEach(i => {
                html += `<div class="item-hist">
                    <div class="item-hist-main">
                        <input type="checkbox" class="item-select chk-item" data-ids="${i.ids.join(',')}" data-valor="${i.valor}" data-desc="${i.descricao}" data-qtd="${i.qtd}" onchange="atualizarSoma()">
                        <div class="item-hist-copy">
                            <span class="item-hist-date">${i.dataFmt}</span>
                            <span class="item-hist-desc"><b class="item-hist-qty" style="color:var(--primary)">${i.qtd > 1 ? `${i.qtd}x` : '1x'}</b>${i.descricao}</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <b class="item-hist-value money-value" style="color:var(--danger)">R$ ${i.valor.toFixed(2)}</b>
                        <button onclick="excluirItemConta(${clienteAbertoId}, '${i.ids.join(',')}')" style="background:transparent; color:#ff4d4f; border:none; padding:4px; font-size:12px; cursor:pointer;" title="Remover item da conta"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
            });
            html += `<div id="somaSelecionados" class="selection-total"></div>`;
            html += `<button id="btnBaixaSelecionados" onclick="processarPagamento(clienteAbertoId)" style="display:none; width:100%; margin-top:8px; padding:12px; background:var(--success); color:white; border:none; border-radius:10px; font-weight:700; box-shadow:0 4px 15px rgba(16,185,129,0.4);"><i class="fa-solid fa-check-circle"></i> PAGAR SELECIONADOS</button>`;
        }

        if (quitadosRecentesAgrupados.length > 0) {
            html += `<div class="account-section-title"><span>✅ RECEBIDOS NO MES</span><span>${quitadosRecentes.length} itens</span></div>`;
            quitadosRecentesAgrupados.forEach(i => {
                html += `<div class="item-hist">
                    <div class="item-hist-main">
                        <div class="item-hist-copy" style="margin-left:8px;">
                            <span class="item-hist-date">${i.dataFmt}</span>
                            <span class="item-hist-desc"><b class="item-hist-qty" style="color:var(--success)">${i.qtd > 1 ? `${i.qtd}x` : '1x'}</b>${i.descricao}${i.isBrinde ? ' <span style="font-size:9px; background:var(--accent); color:#fff; padding:2px 4px; border-radius:4px; margin-left:4px;">BRINDE</span>' : ''}</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <b class="item-hist-value money-value" style="color:var(--success)">R$ ${i.valor.toFixed(2)}</b>
                        <button onclick="excluirItemConta(${clienteAbertoId}, '${i.ids.join(',')}')" style="background:transparent; color:#ff4d4f; border:none; padding:4px; font-size:12px; cursor:pointer;" title="Remover este item"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>`;
            });
        }

        const listAbertos = document.getElementById('listaItensModal');
        listAbertos.innerHTML = html;
        document.getElementById('btnZapRapido').onclick = () => enviarZapDoces('informar');
        document.getElementById('btnCobrarPix').onclick = () => enviarZapDoces('pix');
        document.getElementById('btnExtratoPdf').onclick = () => abrirResumoConta(id);
        atualizarSoma();
        document.getElementById('modalHistorico').style.display='block';
    };

            async function enviarZapDoces(tipo) {
        const c = dbClientes.find(x => x.id === clienteAbertoId);
        if (!c) return;

        const inputChave = document.getElementById('cfgChavePix');
        const inputNome = document.getElementById('cfgNomePix');
        
        const chave = inputChave && inputChave.value ? inputChave.value : (pixConfig ? pixConfig.chave_pix : '');
        const nomeTitular = inputNome && inputNome.value ? inputNome.value : (pixConfig ? pixConfig.nome_pix : '');

        if (chave && (tipo === 'pix')) {
            const { data: configAtualizada, error: pixSaveError } = await _supabase.rpc('salvar_configuracoes_pix', {
                p_chave_pix: chave,
                p_nome_pix: nomeTitular
            });
            if (pixSaveError) {
                alert('Nao foi possivel salvar a configuracao do PIX: ' + pixSaveError.message);
            } else if (configAtualizada) {
                pixConfig = configAtualizada;
            }
        }

        const checks = Array.from(document.querySelectorAll('.chk-item:checked'));
        const itensParaEnviar = checks.length > 0
            ? checks.map(cb => ({
                descricao: cb.getAttribute('data-desc') || '',
                qtd: parseInt(cb.getAttribute('data-qtd')) || 1,
                valor_exibir: parseFloat(cb.getAttribute('data-valor')) || 0
            }))
            : agruparItensConta(itensPendentesGlobal, 'valor_exibir').map(item => ({
                descricao: item.descricao,
                qtd: item.qtd,
                valor_exibir: item.valor
            }));

        const mesAtual = new Date().toLocaleDateString('pt-BR', { month: 'long' });
        
        // pega mês atual para filtrar
        const dataAgora = new Date();
        const mesAtualNum = dataAgora.getMonth();
        const anoAtual = dataAgora.getFullYear();

        // SEPARA ITENS DO MÊS ATUAL POR CATEGORIA
        const comprasDoMes = c.compras.filter(i => {
            const dataItem = new Date(i.data);
            return dataItem.getMonth() === mesAtualNum && dataItem.getFullYear() === anoAtual;
        });

        const itensPagosDoMes = comprasDoMes.filter(i => i.status === 'pago' || (i.valor_total > 0 && !i.status));
        const itensBrindesDoMes = comprasDoMes.filter(i => i.status === 'brinde');
        const quitadosDoMes = comprasDoMes.filter(i => i.status === 'quitado');

        let texto = "";

        if (tipo === 'pix') {
            if (itensParaEnviar.length === 0) return alert("Selecione os itens para cobrar!");
            
            // Calcula total pendente
            let totalPendente = itensParaEnviar.reduce((acc, i) => acc + i.valor_exibir, 0);
            
            // Calcula totais do mês
            const totalPagoDoMes = itensPagosDoMes.reduce((acc, i) => acc + (i.valor_total || 0), 0);
            const totalBrindeDoMes = itensBrindesDoMes.length;
            const totalQuitadoDoMes = quitadosDoMes.reduce((acc, i) => acc + (i.valor_total || 0), 0);

            texto = `Olá! Tudo bem? ✨%0A%0A`;
            texto += `Aqui é da Brasil Doces Passando o resumo do mês de *${mesAtual}*:%0A%0A`;

            // Lista pagos
            if (itensPagosDoMes.length > 0) {
                texto += `✅ *PAGOS:*%0A`;
                texto += itensPagosDoMes.map(i => `   ✓ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}: R$ ${(i.valor_total || 0).toFixed(2)}`).join('%0A') + '%0A%0A';
            }

            // Lista brindes
            if (itensBrindesDoMes.length > 0) {
                texto += `🎁 *BRINDES:*%0A`;
                texto += itensBrindesDoMes.map(i => `   🎉 ${i.descricao}`).join('%0A') + '%0A%0A';
            }

            // Lista quitados do mês
            if (quitadosDoMes.length > 0) {
                texto += `💚 *QUITADOS ESTE MÊS:*%0A`;
                texto += quitadosDoMes.map(i => `   ✓ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}: R$ ${(i.valor_total || 0).toFixed(2)}`).join('%0A') + '%0A%0A';
            }

            // Lista pendentes (o que vai cobrar)
            if (itensParaEnviar.length > 0) {
                texto += `📒 *PENDENTE:*%0A`;
                texto += itensParaEnviar.map(i => `   ⏳ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}: R$ ${i.valor_exibir.toFixed(2)}`).join('%0A') + '%0A%0A';
            }

            // Total geral
            const totalGeral = totalPagoDoMes + totalBrindeDoMes + totalQuitadoDoMes + totalPendente;
            texto += `━━━━━━━━━━━━━━━━━━━━%0A`;
            texto += `💰 *TOTAL DO MÊS: R$ ${totalGeral.toFixed(2)}*%0A`;
            if (totalPendente > 0) {
                texto += `📒 *PENDENTE: R$ ${totalPendente.toFixed(2)}*%0A`;
            }
            texto += `%0A`;
            
            if (chave) {
                texto += `🔑 *PIX:* ${chave}%0A`;
                if(nomeTitular) texto += `👤 *NOME:* ${nomeTitular}%0A%0A`;
            }
            texto += `Quando puder, me avise para organizarmos o acerto? Muito obrigada pela parceria de sempre! 🍰❤️`;

        } else if (tipo === 'informar') {
            if (itensParaEnviar.length === 0) return alert("Não há itens para informar!");

            const totalPendente = itensParaEnviar.reduce((acc, i) => acc + i.valor_exibir, 0);
            const totalPagoDoMes = itensPagosDoMes.reduce((acc, i) => acc + (i.valor_total || 0), 0);
            const totalQuitadoDoMes = quitadosDoMes.reduce((acc, i) => acc + (i.valor_total || 0), 0);
            const totalJaPago = totalPagoDoMes + totalQuitadoDoMes;
            const temPagamentoNoMes = totalJaPago > 0;
            const temBrindeNoMes = itensBrindesDoMes.length > 0;
            const itensRecebidosDoMes = agruparItensConta([
                ...itensPagosDoMes.map(i => ({ ...i, valor_exibir: i.valor_total, status: 'pago' })),
                ...quitadosDoMes.map(i => ({ ...i, valor_exibir: i.valor_total, status: 'quitado' }))
            ], 'valor_exibir');

            let listaConta = itensParaEnviar.map(i => `✨ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}: R$ ${i.valor_exibir.toFixed(2)}`).join('%0A');
            let listaRecebidos = itensRecebidosDoMes.map(i => `   ✓ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}: R$ ${i.valor.toFixed(2)}`).join('%0A');
            
            if (!temPagamentoNoMes) {
                texto = `Oi! ✨ Passando para te deixar ciente do que está anotado na sua conta aqui na Brasil Doces:%0A%0A`;
                texto += `📒 *ITENS NA CONTA:*%0A${listaConta}%0A%0A`;
                if (temBrindeNoMes) {
                    texto += `🎁 *BRINDES:*%0A`;
                    texto += itensBrindesDoMes.map(i => `   🎉 ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}`).join('%0A') + '%0A%0A';
                }
                texto += `📒 *VALOR TOTAL PENDENTE: R$ ${totalPendente.toFixed(2)}*%0A%0A`;
            } else {
                texto = `Oi! ✨ Passando para te deixar ciente das suas movimentações aqui na Brasil Doces:%0A%0A`;
                texto += `📒 *ITENS NA CONTA:*%0A${listaConta}%0A%0A`;
                if (itensRecebidosDoMes.length > 0) {
                    texto += `💚 *JA RECEBIDOS NO MES:*%0A${listaRecebidos}%0A%0A`;
                }
                if (temBrindeNoMes) {
                    texto += `🎁 *BRINDES:*%0A`;
                    texto += itensBrindesDoMes.map(i => `   🎉 ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.descricao}`).join('%0A') + '%0A%0A';
                }
                texto += `💚 *VALOR JA PAGO NO MES: R$ ${totalJaPago.toFixed(2)}*%0A`;
                texto += `📒 *VALOR TOTAL PENDENTE: R$ ${totalPendente.toFixed(2)}*%0A%0A`;
            }
            texto += `É só para o seu controle mesmo, tá bem? Qualquer dúvida estou à disposição! Beijos, Fer. ❤️`;
            
        } else if (tipo === 'obrigado') {
            texto = `Oi! Passando para agradecer pelo pagamento. ✨ É um prazer ter você como cliente! ❤️`;
        } else if (tipo === 'aniversario') {
            texto = `Oi! ✨ Tudo bem?%0AEstou atualizando o meu sistema aqui na Brasil Doces e estou preparando brindes para datas especiais. Você poderia me passar o dia e o mês do seu aniversário? 🎂❤️`;
        }

        // Abre de fato no WhatsApp
        window.open(`https://wa.me/55${c.tel}?text=${texto}`, '_blank');
    }

    
            window.abrirResumoConta = (id) => {
        sessionStorage.setItem('modalAberto', 'res-'+id);
        clienteAbertoId = id;
        document.getElementById('modalHistorico').style.display = 'none'; // Fecha o outro 
        
        const c = dbClientes.find(x => x.id === id);
        document.getElementById('nomeClienteResumo').innerText = c.nome.toUpperCase();
        preencherExtratoQuitados(document.getElementById('corpoExtrato'), obterQuitadosPdf(c));
        
        document.getElementById('modalResumo').style.display = 'block';
    };


    // ======== AS FUNÇÕES QUE TINHAM SUMIDO VOLTARAM ABAIXO ========
    
    window.atualizarSoma = () => {
        let soma = 0;
        const selecionados = document.querySelectorAll('.chk-item:checked');
        selecionados.forEach(cb => soma += parseFloat(cb.getAttribute('data-valor')));

        const divSoma = document.getElementById('somaSelecionados');
        const btnPagar = document.getElementById('btnBaixaSelecionados');
        if (divSoma && btnPagar) {
            if (selecionados.length > 0) {
                divSoma.style.display = 'block';
                divSoma.innerHTML = `PAGAR SELECIONADOS (${selecionados.length} itens): R$ ${soma.toFixed(2)}`;
                btnPagar.style.display = 'flex';
            } else {
                divSoma.style.display = 'none';
                btnPagar.style.display = 'none';
            }
        }
    };

    // ======= COMPROVANTE PÓS-PAGAMENTO =======
    let _comprovanteData = null; // Guarda os dados do pagamento para o comprovante

    window.processarPagamento = async (clienteId) => {
        let soma = 0;
        const selecionados = document.querySelectorAll('.chk-item:checked');
        
        selecionados.forEach(cb => soma += parseFloat(cb.getAttribute('data-valor')));
        if (soma <= 0) return alert("Selecione pelo menos um item para pagar!");

        const itensSelecionados = Array.from(selecionados).map(cb => ({
            ids: (cb.getAttribute('data-ids') || '').split(',').map(v => parseInt(v)).filter(Boolean),
            desc : cb.getAttribute('data-desc') || '',
            qtd  : parseInt(cb.getAttribute('data-qtd')) || 1,
            valor: parseFloat(cb.getAttribute('data-valor'))
        }));
        const idsSelecionados = itensSelecionados.flatMap(item => item.ids || []);

        if (!confirm(`Confirmar pagamento de R$ ${soma.toFixed(2)}?`)) return;

        const { data, error } = await _supabase.rpc('processar_pagamento', {
            p_cliente_id: clienteId,
            p_item_ids: idsSelecionados
        });

        if (error) {
            alert("Erro: " + error.message);
        } else {
            const somaFinal = Number(data && data.valor_pago ? data.valor_pago : soma);
            fecharModais();
            _comprovanteData = { clienteId, soma: somaFinal, itens: itensSelecionados };

            const c = dbClientes.find(x => x.id === clienteId);
            document.getElementById('bsComprovanteValor').innerText  = `R$ ${somaFinal.toFixed(2)}`;
            document.getElementById('bsComprovanteCliente').innerText = c ? c.nome : '';

            document.getElementById('bsComprovanteOverlay').classList.add('active');
            setTimeout(() => document.getElementById('bsComprovanteSheet').classList.add('active'), 10);

            await carregarDados();
        }
    };

    window.fecharComprovanteSheet = () => {
        document.getElementById('bsComprovanteSheet').classList.remove('active');
        document.getElementById('bsComprovanteOverlay').classList.remove('active');
    };

    window.enviarComprovanteWap = () => {
        if (!_comprovanteData) return;

        const c = dbClientes.find(x => x.id === _comprovanteData.clienteId);
        if (!c || !c.tel) return alert('Telefone do cliente não cadastrado!');

        // Limpa o telefone para garantir que só tenha números (regra do wa.me)
        const telLimpo = c.tel.replace(/\D/g, '');

        const dataHoje = new Date().toLocaleDateString('pt-BR');
        let linhas = _comprovanteData.itens
            .map(i => `✅ ${i.qtd > 1 ? i.qtd + 'x ' : ''}${i.desc}: R$ ${i.valor.toFixed(2)}`)
            .join('%0A');

        let msg = `*Brasil Doces®* 🍰%0A%0A`;
        msg += `Olá, *${c.nome}*! Tudo bem? ✨%0A`;
        msg += `Segue o comprovante do seu pagamento de hoje (${dataHoje}):%0A%0A`;
        msg += `${linhas}%0A%0A`;
        msg += `💰 *TOTAL PAGO: R$ ${_comprovanteData.soma.toFixed(2)}*%0A%0A`;
        msg += `Muito obrigada pela confiança! Feito com amor. ❤️`;

        const url = `https://wa.me/55${telLimpo}?text=${msg}`;
        window.open(url, '_blank');

        // Fecha o sheet com um pequeno atraso para não interferir no window.open
        setTimeout(fecharComprovanteSheet, 500);
    };

    window.abrirExtratoAposPagamento = () => {
        fecharComprovanteSheet();
        if (!_comprovanteData) return;
        abrirHistorico(_comprovanteData.clienteId);
    };
    // ==========================================

    // =========== BOTTOM SHEET LOGIC ===========

    window.salvarVenda = (id) => {
        let itensCart = carrinhos[id] || [];

        if (itensCart.length === 0) return alert("Adicione pelo menos um produto à cesta (clicando no botão do doce) primeiro!");

        _pendingClienteId = id;
        _vendaQueue = [...itensCart];
        _queueIndex = 0;
        _vendaResults = new Array(_vendaQueue.length).fill(null);
        
        abrirFilaNoModal();
        
        // Limpa o campo de busca se houver
        const inputBusca = document.getElementById(`it-${id}`);
        if (inputBusca) inputBusca.value = "";
    };

    function abrirFilaNoModal() {
        if (_queueIndex >= _vendaQueue.length || !_vendaQueue.length) {
            return;
        }

        const item = _vendaQueue[_queueIndex];
        const progresso = `(${_queueIndex + 1} de ${_vendaQueue.length})`;
        _tipoVendaSelecionado = _vendaResults[_queueIndex] ? _vendaResults[_queueIndex].tipo : null;
        
        document.getElementById('bsProductName').innerText = `${progresso} ${item.it}`;
        document.getElementById('bsProductVal').innerText  = `R$ ${(item.qt * item.vl).toFixed(2)}`;
        document.querySelectorAll('#bottomSheet .bs-btn[data-tipo]').forEach(btn => {
            btn.classList.toggle('selected', btn.getAttribute('data-tipo') === _tipoVendaSelecionado);
        });

        const tabs = document.getElementById('bsQueueTabs');
        if (tabs) {
            tabs.innerHTML = _vendaQueue.map((filaItem, idx) => {
                const resultado = _vendaResults[idx];
                const activeClass = idx === _queueIndex ? 'active' : '';
                const doneClass = resultado ? 'done' : '';
                const tipoClass = resultado ? getTipoVendaClasse(resultado.tipo) : '';
                return `<button type="button" class="bs-queue-tab ${activeClass} ${doneClass} ${tipoClass}" onclick="irParaItemFila(${idx})">
                    <span class="bs-queue-tab-index">Item ${idx + 1}</span>
                    <span class="bs-queue-tab-name">${filaItem.it}</span>
                    <span class="bs-queue-tab-status">${getTipoVendaLabel(resultado ? resultado.tipo : null)}</span>
                </button>`;
            }).join('');
        }

        atualizarBotaoSalvarFila();

        document.getElementById('bsOverlay').classList.add('active');
        document.getElementById('bottomSheet').classList.add('active');
    }

    window.irParaItemFila = (index) => {
        if (index < 0 || index >= _vendaQueue.length) return;
        _queueIndex = index;
        abrirFilaNoModal();
    };

    window.selecionarTipoVenda = (tipo) => {
        const item = _vendaQueue[_queueIndex];
        if (!item) return;

        _vendaResults[_queueIndex] = { ...item, tipo };
        _tipoVendaSelecionado = tipo;
        document.querySelectorAll('#bottomSheet .bs-btn[data-tipo]').forEach(btn => {
            btn.classList.toggle('selected', btn.getAttribute('data-tipo') === tipo);
        });

        const proximoPendente = _vendaResults.findIndex((res, idx) => idx > _queueIndex && !res);
        if (proximoPendente !== -1) {
            _queueIndex = proximoPendente;
        }

        abrirFilaNoModal();
    };

    window.salvarFilaVenda = () => {
        if (_vendaResults.some(res => !res)) return;
        fecharBottomSheet();
        finalizarVendaEmLote();
    };

    window.confirmarVenda = (tipo) => {
        const item = _vendaQueue[_queueIndex];
        _vendaResults[_queueIndex] = { ...item, tipo };
        _tipoVendaSelecionado = null;

        _queueIndex++;
        if (_queueIndex < _vendaQueue.length) {
            abrirFilaNoModal(); 
        } else {
            fecharBottomSheet();
            finalizarVendaEmLote();
        }
    };

    async function finalizarVendaEmLote() {
        const id = _pendingClienteId;
        const inserts = [];
        let totalPagoAgora = 0;

        _vendaResults.filter(Boolean).forEach(res => {
            let valorTotal, descricao, status;
            if (res.tipo === 'pago') {
                valorTotal = res.qt * res.vl;
                descricao  = res.it;
                status = 'pago';
                totalPagoAgora += valorTotal;
            } else if (res.tipo === 'brinde') {
                valorTotal = 0;
                descricao  = `🎁 ${res.it}`;
                status = 'brinde';
            } else {
                valorTotal = res.qt * res.vl;
                descricao  = res.it;
                status = 'pendente';
            }
            inserts.push({ cliente_id: id, descricao, qtd: res.qt, valor_total: valorTotal, status });
        });

        if (totalPagoAgora > 0) {
            inserts.push({ cliente_id: id, descricao: "PAGAMENTO EFETUADO (BALCÃO)", qtd: 1, valor_total: -totalPagoAgora, status: 'pagamento' });
        }

        const { error } = await _supabase.from('compras').insert(inserts);

        if (error) {
            console.error("Erro ao salvar:", error.message);
            alert("Erro no banco: " + error.message);
        } else {
            carrinhos[id] = []; 
            if (totalPagoAgora > 0) {
                _comprovanteData = {
                    clienteId: id,
                    soma: totalPagoAgora,
                    itens: _vendaResults.filter(r => r && r.tipo === 'pago').map(r => ({ desc: r.it, qtd: r.qt, valor: r.vl }))
                };
                const c = dbClientes.find(x => x.id === id);
                document.getElementById('bsComprovanteValor').innerText = `R$ ${totalPagoAgora.toFixed(2)}`;
                document.getElementById('bsComprovanteCliente').innerText = c ? c.nome : '';
                
                document.getElementById('bsComprovanteOverlay').classList.add('active');
                document.getElementById('bsComprovanteSheet').classList.add('active');
            }
            await carregarDados();
        }

        _vendaQueue = [];
        _queueIndex = 0;
        _vendaResults = [];
        _pendingClienteId = null;
    }

    window.fecharBottomSheet = () => {
        _tipoVendaSelecionado = null;
        const btnConfirmar = document.getElementById('btnConfirmarTipoVenda');
        if (btnConfirmar) btnConfirmar.disabled = true;
        document.querySelectorAll('#bottomSheet .bs-btn[data-tipo]').forEach(btn => btn.classList.remove('selected'));
        const tabs = document.getElementById('bsQueueTabs');
        if (tabs) tabs.innerHTML = '';
        document.getElementById('bottomSheet').classList.remove('active');
        document.getElementById('bsOverlay').classList.remove('active');
    };

    // ===========================================


    window.prepararEdicao = (id) => {
        const c = dbClientes.find(x => x.id === id); clienteEmEdicao = id;
        document.getElementById('novoNome').value = c.nome; document.getElementById('novoTel').value = c.tel;
        document.getElementById('novoNiver').value = c.aniversario || '';
        document.getElementById('btnCadastrar').innerText = "SALVAR ALTERAÇÕES"; 
        
        // Abre o formulário automaticamente ao editar
        document.getElementById('formClienteCollapse').open = true;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    window.excluir = async (id) => { if(confirm("Excluir cliente?")) await _supabase.from('clientes').delete().eq('id', id); };
    window.atualizarPreco = (input, cId) => {
        const prod = dbProdutos.find(x => x.nome.toUpperCase() === input.value.toUpperCase());
        if (prod) document.getElementById(`vl-${cId}`).value = prod.preco;
    };

    document.getElementById('btnCadastrar').onclick = async () => {
        const nome = document.getElementById('novoNome').value, tel = document.getElementById('novoTel').value, niver = document.getElementById('novoNiver').value;
        if(!nome || !tel) return alert("Preencha tudo!");
        const payload = { nome, tel, aniversario: niver };
        if(clienteEmEdicao) await _supabase.from('clientes').update(payload).eq('id', clienteEmEdicao);
        else await _supabase.from('clientes').insert([payload]);
        clienteEmEdicao = null; document.getElementById('novoNome').value = ''; document.getElementById('novoTel').value = ''; document.getElementById('novoNiver').value = '';
        document.getElementById('btnCadastrar').innerText = "ADICIONAR CLIENTE"; 
        
        // Fecha o formulário após salvar
        document.getElementById('formClienteCollapse').open = false;
        carregarDados();
    };

    document.getElementById('btnLogin').onclick = async () => {
        const { error } = await _supabase.auth.signInWithPassword({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value });
        if(error) alert("Erro: " + error.message); else checkUser();
    };

    document.getElementById('btnSalvarProduto').onclick = async () => {
    const nome = document.getElementById('prodNome').value.trim().toUpperCase();
    const preco = parseFloat(document.getElementById('prodPreco').value);

    if (!nome || !preco) {
        return alert("Preencha o nome e o preço do produto!");
    }

    const { error } = await _supabase
        .from('produtos')
        .insert([{ nome: nome, preco: preco }]);

    if (error) {
        if (error.code === '23505') {
            alert("Este produto já está cadastrado!");
        } else {
            alert("Erro ao salvar produto: " + error.message);
        }
    } else {
        alert("Produto cadastrado com sucesso! ✨");
        document.getElementById('prodNome').value = '';
        document.getElementById('prodPreco').value = '';
        carregarDados(); // Recarrega a lista para refletir o novo produto
    }
};

        // Adiciona o doce ao carrinho do cliente
    window.preencherRapido = (cId, nomeProduto, precoProduto) => {
        if (!carrinhos[cId]) carrinhos[cId] = [];
        carrinhos[cId].push({ it: nomeProduto, qt: 1, vl: precoProduto });
        render();
    };

    // Remove item do carrinho
    window.removerDoCarrinho = (cId, index) => {
        if (carrinhos[cId] && carrinhos[cId][index]) {
            carrinhos[cId].splice(index, 1);
            render();
        }
    };

    window.excluirItemConta = async (clienteId, idsStr) => {
        if (!confirm("Tem certeza que deseja excluir permanentemente este item da conta do cliente?")) return;
        const arrIds = idsStr.split(',').map(Number);
        const { error } = await _supabase.from('compras').delete().in('id', arrIds);
        if (error) alert("Erro ao excluir: " + error.message);
        else { await carregarDados(); abrirHistorico(clienteId); }
    };

    checkUser();

window.sair = sair;
window.render = render;
window.normalizarTexto = normalizarTexto;
