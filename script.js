(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyBBriPa_yCqb7kZtyJJ2XGtOp_DSCYCx0Q",
    authDomain: "bancodetecidos-c3d2d.firebaseapp.com",
    databaseURL: "https://bancodetecidos-c3d2d-default-rtdb.firebaseio.com",
    projectId: "bancodetecidos-c3d2d",
    storageBucket: "bancodetecidos-c3d2d.firebasestorage.app",
    messagingSenderId: "534574467325",
    appId: "1:534574467325:web:1ad5399163637660b25694",
    measurementId: "G-24ZTWH1YZY"
  };

  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db = firebase.firestore();

  var CATEGORY_COLORS = [
    { color: '#B23A2E', bg: '#F4E0DD' },
    { color: '#3A4A6B', bg: '#DEE3EC' },
    { color: '#B9812A', bg: '#F2E4CC' },
    { color: '#5C6B4E', bg: '#E1E6DA' },
    { color: '#7C4A8A', bg: '#E9DDEC' }
  ];
  var EMPTY_DRAFT = { nome: '', categoria: '', quantidade: '', valor: '', marca: '', tipoModelo: '', tamanho: '', corEstampa: '' };

  var state = {
    items: [],
    categories: [],
    loaded: false,
    search: '',
    filterCat: null,
    formOpen: false,
    editingId: null,
    showOptional: false,
    addingCategory: false,
    newCategoryDraft: '',
    draft: null,
    dataError: null,

    activeTab: 'tecidos',

    roupas: [],
    roupasLoaded: false,
    roupaFormOpen: false,
    roupaEditingId: null,
    roupaDraft: null,
    consumoDraft: {},
    historicoOpen: {},
    historicoCache: {}
  };

  var currentUser = null;
  var userRef = null;
  var itemsRef = null;
  var roupasRef = null;
  var unsubUser = null;
  var unsubItems = null;
  var unsubRoupas = null;

  function catColor(cat) {
    var idx = 0;
    for (var i = 0; i < cat.length; i++) idx += cat.charCodeAt(i);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toNumber(str) {
    if (str === undefined || str === null || str === '') return NaN;
    return parseFloat(String(str).replace(',', '.'));
  }

  function fmtMoney(v) {
    var n = toNumber(v);
    if (isNaN(n)) n = 0;
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMetros(v) {
    var n = toNumber(v);
    if (isNaN(n)) n = 0;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' m';
  }

  // Converte um número de volta para o formato de exibição (vírgula decimal),
  // arredondando para evitar sobras de ponto flutuante (ex: 20 - 1.5 = 18.5).
  function toStoredQty(n) {
    var rounded = Math.round(n * 1000) / 1000;
    return String(rounded).replace('.', ',');
  }

  function fmtData(ts) {
    if (!ts || !ts.toDate) return '';
    return ts.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Autenticação ----------

  auth.getRedirectResult().catch(function (err) {
    console.error('Erro no login via redirect', err);
    var root = document.getElementById('ct-root');
    if (root) root.innerHTML = '<p class="ct-error" style="text-align:center">Não foi possível entrar (' + esc(err.code || err.message) + '). Tente novamente.</p>';
  });

  function renderAuthBar() {
    var bar = document.getElementById('ct-authbar');
    if (!bar) return;
    if (currentUser) {
      bar.innerHTML =
        '<div class="ct-authbar">' +
          '<div class="ct-authbar-user">' +
            (currentUser.photoURL ? '<img src="' + esc(currentUser.photoURL) + '" />' : '') +
            '<span>' + esc(currentUser.displayName || currentUser.email) + '</span>' +
          '</div>' +
          '<button class="ct-btn ct-btn-ghost" id="ct-logout-btn">Sair</button>' +
        '</div>';
      var logoutBtn = document.getElementById('ct-logout-btn');
      if (logoutBtn) logoutBtn.addEventListener('click', function () { auth.signOut(); });
    } else {
      bar.innerHTML = '';
    }
  }

  function renderLoginScreen() {
    var root = document.getElementById('ct-root');
    root.innerHTML =
      '<div class="ct-login-box">' +
        '<b>Entre para acessar seu catálogo</b>' +
        '<p>Cada conta Google tem seu próprio catálogo, salvo automaticamente.</p>' +
        '<button class="ct-google-btn" id="ct-google-login">Entrar com Google</button>' +
      '</div>';
    var btn = document.getElementById('ct-google-login');
    if (btn) btn.addEventListener('click', function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithRedirect(provider).catch(function (err) {
        console.error(err);
        var root2 = document.getElementById('ct-root');
        if (root2) root2.innerHTML += '<p class="ct-error" style="text-align:center">Não foi possível entrar (' + esc(err.code || err.message) + '). Tente novamente.</p>';
      });
    });
  }

  auth.onAuthStateChanged(function (user) {
    currentUser = user;
    if (unsubUser) { unsubUser(); unsubUser = null; }
    if (unsubItems) { unsubItems(); unsubItems = null; }
    if (unsubRoupas) { unsubRoupas(); unsubRoupas = null; }
    renderAuthBar();

    if (user) {
      state.loaded = false;
      state.roupasLoaded = false;
      state.dataError = null;
      userRef = db.collection('usuarios').doc(user.uid);
      itemsRef = userRef.collection('itens');
      roupasRef = userRef.collection('roupas');

      unsubUser = userRef.onSnapshot(function (doc) {
        state.categories = (doc.exists && doc.data().categorias) || [];
        state.loaded = true;
        state.dataError = null;
        render();
      }, function (err) {
        console.error('Erro ao ler categorias', err);
        state.loaded = true;
        state.dataError = err.code || err.message;
        render();
      });

      unsubItems = itemsRef.orderBy('criadoEm', 'desc').onSnapshot(function (snap) {
        state.items = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        state.loaded = true;
        state.dataError = null;
        render();
      }, function (err) {
        console.error('Erro ao ler itens', err);
        state.loaded = true;
        state.dataError = err.code || err.message;
        render();
      });

      unsubRoupas = roupasRef.orderBy('criadoEm', 'desc').onSnapshot(function (snap) {
        state.roupas = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        state.roupasLoaded = true;
        state.dataError = null;
        render();
      }, function (err) {
        console.error('Erro ao ler roupas', err);
        state.roupasLoaded = true;
        state.dataError = err.code || err.message;
        render();
      });
    } else {
      userRef = null;
      itemsRef = null;
      roupasRef = null;
      state.items = [];
      state.categories = [];
      state.roupas = [];
      state.formOpen = false;
      state.draft = null;
      state.roupaFormOpen = false;
      state.roupaDraft = null;
      state.consumoDraft = {};
      state.loaded = true;
      state.roupasLoaded = true;
      renderLoginScreen();
    }
  });

  // ---------- Persistência ----------

  function saveCategories() {
    if (!userRef) return;
    userRef.set({ categorias: state.categories }, { merge: true }).catch(function (e) {
      console.error('Erro ao salvar categorias', e);
    });
  }

  // ---------- Rascunho do formulário (evita perder o que já foi digitado) ----------

  var FIELD_MAP = {
    'ct-f-nome': 'nome',
    'ct-f-quantidade': 'quantidade',
    'ct-f-valor': 'valor',
    'ct-f-marca': 'marca',
    'ct-f-tipo': 'tipoModelo',
    'ct-f-tamanho': 'tamanho',
    'ct-f-cor': 'corEstampa'
  };

  function syncDraftFromDOM() {
    if (!state.formOpen || !state.draft) return;
    Object.keys(FIELD_MAP).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) state.draft[FIELD_MAP[id]] = el.value;
    });
    var catEl = document.getElementById('ct-f-categoria');
    if (catEl) state.draft.categoria = catEl.value;
  }

  function openNewForm() {
    state.formOpen = true;
    state.editingId = null;
    state.showOptional = false;
    state.addingCategory = false;
    state.newCategoryDraft = '';
    state.draft = Object.assign({}, EMPTY_DRAFT);
    render();
    setTimeout(function () {
      var el = document.getElementById('ct-f-nome');
      if (el) el.focus();
    }, 0);
  }

  function openEditForm(id) {
    var it = state.items.find(function (x) { return x.id === id; });
    if (!it) return;
    state.formOpen = true;
    state.editingId = id;
    state.showOptional = true;
    state.addingCategory = false;
    state.newCategoryDraft = '';
    state.draft = Object.assign({}, EMPTY_DRAFT, it);
    render();
  }

  function closeForm() {
    state.formOpen = false;
    state.editingId = null;
    state.draft = null;
    render();
  }

  function deleteItem(id) {
    if (!itemsRef) return;
    itemsRef.doc(id).delete().catch(function (e) { console.error('Erro ao excluir', e); });
  }

  function submitForm() {
    syncDraftFromDOM();
    var v = state.draft;
    var errEl = document.getElementById('ct-form-error');
    if (!v.nome || !v.categoria || !v.quantidade || !v.valor || !v.marca) {
      errEl.textContent = 'Preencha nome, categoria, quantidade, valor e marca.';
      return;
    }
    if (isNaN(toNumber(v.quantidade)) || isNaN(toNumber(v.valor))) {
      errEl.textContent = 'Quantidade e valor precisam ser números.';
      return;
    }
    errEl.textContent = '';
    if (!itemsRef) return;

    var isNewCategory = state.categories.indexOf(v.categoria) === -1;
    if (isNewCategory) state.categories.push(v.categoria);

    var payload = {
      nome: v.nome, categoria: v.categoria, quantidade: v.quantidade, valor: v.valor,
      marca: v.marca, tipoModelo: v.tipoModelo, tamanho: v.tamanho, corEstampa: v.corEstampa
    };

    var promise;
    if (state.editingId) {
      promise = itemsRef.doc(state.editingId).set(payload, { merge: true });
    } else {
      payload.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      promise = itemsRef.add(payload);
    }

    errEl.textContent = 'Salvando...';
    var submitBtn = document.getElementById('ct-submit-form');
    if (submitBtn) submitBtn.disabled = true;

    promise.then(function () {
      if (isNewCategory) saveCategories();
      state.formOpen = false;
      state.editingId = null;
      state.draft = null;
      render();
    }).catch(function (e) {
      console.error('Erro ao salvar item', e);
      var errEl2 = document.getElementById('ct-form-error');
      if (errEl2) errEl2.textContent = 'Não foi possível salvar (' + (e.code || e.message) + '). Confira se as regras do Firestore foram publicadas.';
      var submitBtn2 = document.getElementById('ct-submit-form');
      if (submitBtn2) submitBtn2.disabled = false;
    });
  }

  function confirmNewCategory() {
    syncDraftFromDOM();
    var name = state.newCategoryDraft.trim();
    if (!name) return;
    if (state.categories.indexOf(name) === -1) {
      state.categories.push(name);
      saveCategories();
    }
    state.addingCategory = false;
    state.newCategoryDraft = '';
    state.draft.categoria = name;
    render();
  }

  // ---------- Roupas: rascunho do formulário ----------

  function syncRoupaDraftFromDOM() {
    if (!state.roupaFormOpen || !state.roupaDraft) return;
    var nomeEl = document.getElementById('ct-r-nome');
    if (nomeEl) state.roupaDraft.nome = nomeEl.value;
    var checks = document.querySelectorAll('.ct-r-tecido-check');
    if (checks.length) {
      var arr = [];
      checks.forEach(function (c) { if (c.checked) arr.push(c.value); });
      state.roupaDraft.tecidosVinculados = arr;
    }
  }

  function openNewRoupaForm() {
    state.roupaFormOpen = true;
    state.roupaEditingId = null;
    state.roupaDraft = { nome: '', tecidosVinculados: [] };
    render();
    setTimeout(function () {
      var el = document.getElementById('ct-r-nome');
      if (el) el.focus();
    }, 0);
  }

  function openEditRoupaForm(id) {
    var r = state.roupas.find(function (x) { return x.id === id; });
    if (!r) return;
    state.roupaFormOpen = true;
    state.roupaEditingId = id;
    state.roupaDraft = { nome: r.nome, tecidosVinculados: (r.tecidosVinculados || []).slice() };
    render();
  }

  function closeRoupaForm() {
    state.roupaFormOpen = false;
    state.roupaEditingId = null;
    state.roupaDraft = null;
    render();
  }

  function deleteRoupa(id) {
    if (!roupasRef) return;
    roupasRef.doc(id).delete().catch(function (e) { console.error('Erro ao excluir roupa', e); });
  }

  function submitRoupaForm() {
    syncRoupaDraftFromDOM();
    var v = state.roupaDraft;
    var errEl = document.getElementById('ct-roupa-form-error');
    if (!v.nome || !v.nome.trim()) { errEl.textContent = 'Informe o nome da roupa.'; return; }
    if (!v.tecidosVinculados || v.tecidosVinculados.length === 0) { errEl.textContent = 'Selecione ao menos um tecido.'; return; }
    errEl.textContent = '';
    if (!roupasRef) return;

    var payload = { nome: v.nome.trim(), tecidosVinculados: v.tecidosVinculados };
    var promise;
    if (state.roupaEditingId) {
      promise = roupasRef.doc(state.roupaEditingId).set(payload, { merge: true });
    } else {
      payload.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      promise = roupasRef.add(payload);
    }

    errEl.textContent = 'Salvando...';
    var submitBtn = document.getElementById('ct-roupa-submit-form');
    if (submitBtn) submitBtn.disabled = true;

    promise.then(function () {
      state.roupaFormOpen = false;
      state.roupaEditingId = null;
      state.roupaDraft = null;
      render();
    }).catch(function (e) {
      console.error('Erro ao salvar roupa', e);
      var errEl2 = document.getElementById('ct-roupa-form-error');
      if (errEl2) errEl2.textContent = 'Não foi possível salvar (' + (e.code || e.message) + ').';
      var submitBtn2 = document.getElementById('ct-roupa-submit-form');
      if (submitBtn2) submitBtn2.disabled = false;
    });
  }

  // ---------- Consumo de tecido pelas roupas ----------

  function syncConsumoDraftFromDOM() {
    document.querySelectorAll('.ct-consumo-input').forEach(function (el) {
      var key = el.getAttribute('data-key');
      if (key) state.consumoDraft[key] = el.value;
    });
  }

  function registrarConsumo(roupaId) {
    syncConsumoDraftFromDOM();
    var roupa = state.roupas.find(function (r) { return r.id === roupaId; });
    var errEl = document.getElementById('ct-roupa-error-' + roupaId);
    if (!roupa || !itemsRef || !roupasRef) return;

    var usages = [];
    var invalido = false;
    (roupa.tecidosVinculados || []).forEach(function (tecidoId) {
      var tecido = state.items.find(function (it) { return it.id === tecidoId; });
      if (!tecido) return; // tecido removido do estoque, ignora
      var raw = state.consumoDraft[roupaId + ':' + tecidoId];
      if (raw === undefined || raw === '' || raw === null) return;
      var qty = toNumber(raw);
      if (isNaN(qty) || qty < 0) { invalido = true; return; }
      if (qty > 0) usages.push({ tecidoId: tecidoId, tecidoNome: tecido.nome, qty: qty });
    });

    if (invalido) { if (errEl) errEl.textContent = 'Informe valores válidos (0 ou mais).'; return; }
    if (usages.length === 0) { if (errEl) errEl.textContent = 'Informe ao menos uma quantidade utilizada.'; return; }

    if (errEl) errEl.textContent = 'Registrando...';

    var roupaRef = roupasRef.doc(roupaId);

    db.runTransaction(function (tx) {
      var reads = usages.map(function (u) {
        return tx.get(itemsRef.doc(u.tecidoId)).then(function (doc) {
          if (!doc.exists) throw { message: 'O tecido "' + u.tecidoNome + '" não existe mais no estoque.' };
          var estoqueAtual = toNumber(doc.data().quantidade);
          if (isNaN(estoqueAtual)) estoqueAtual = 0;
          if (u.qty > estoqueAtual) {
            throw { message: 'Estoque insuficiente de "' + u.tecidoNome + '" (disponível: ' + doc.data().quantidade + ').' };
          }
          var valorUnitario = toNumber(doc.data().valor);
          if (isNaN(valorUnitario)) valorUnitario = 0;
          return { ref: itemsRef.doc(u.tecidoId), novoEstoque: estoqueAtual - u.qty, valorUnitario: valorUnitario, u: u };
        });
      });
      return Promise.all(reads).then(function (results) {
        var somaMetros = 0, somaValor = 0;
        results.forEach(function (r) {
          tx.update(r.ref, { quantidade: toStoredQty(r.novoEstoque) });
          var valorGasto = r.u.qty * r.valorUnitario;
          somaMetros += r.u.qty;
          somaValor += valorGasto;
          var consumoRef = roupaRef.collection('consumos').doc();
          tx.set(consumoRef, {
            tecidoId: r.u.tecidoId,
            tecidoNome: r.u.tecidoNome,
            quantidade: toStoredQty(r.u.qty),
            valorUnitario: r.valorUnitario,
            valorGasto: valorGasto,
            data: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        tx.update(roupaRef, {
          totalConsumidoMetros: firebase.firestore.FieldValue.increment(somaMetros),
          totalConsumidoValor: firebase.firestore.FieldValue.increment(somaValor)
        });
      });
    }).then(function () {
      usages.forEach(function (u) { delete state.consumoDraft[roupaId + ':' + u.tecidoId]; });
      if (state.historicoOpen[roupaId]) fetchHistorico(roupaId);
      var errEl2 = document.getElementById('ct-roupa-error-' + roupaId);
      if (errEl2) errEl2.textContent = '';
      render();
    }).catch(function (e) {
      console.error('Erro ao registrar consumo', e);
      var errEl2 = document.getElementById('ct-roupa-error-' + roupaId);
      if (errEl2) errEl2.textContent = e.message || 'Não foi possível registrar o consumo.';
    });
  }

  function fetchHistorico(roupaId) {
    if (!roupasRef) return;
    roupasRef.doc(roupaId).collection('consumos').orderBy('data', 'desc').limit(20).get().then(function (snap) {
      state.historicoCache[roupaId] = snap.docs.map(function (d) { return d.data(); });
      render();
    }).catch(function (e) {
      console.error('Erro ao buscar histórico', e);
      state.historicoCache[roupaId] = [];
      render();
    });
  }

  function toggleHistorico(roupaId) {
    var isOpen = !!state.historicoOpen[roupaId];
    if (isOpen) {
      state.historicoOpen[roupaId] = false;
      render();
    } else {
      state.historicoOpen[roupaId] = true;
      render();
      fetchHistorico(roupaId);
    }
  }

  // ---------- Render ----------

  function renderChips() {
    var cats = state.categories.slice().sort();
    var html = '<div class="ct-chips">';
    html += '<div class="ct-chip' + (state.filterCat === null ? ' active' : '') + '" style="background:var(--line);color:var(--ink)" data-allchip="1">Todos</div>';
    cats.forEach(function (c) {
      var cc = catColor(c);
      html += '<div class="ct-chip' + (state.filterCat === c ? ' active' : '') + '" style="background:' + cc.bg + ';color:' + cc.color + '" data-catchip="' + esc(c) + '">' + esc(c) + '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderCard(it) {
    var cc = catColor(it.categoria);
    var extras = '';
    if (it.tipoModelo) extras += '<div class="ct-card-row"><span>Tipo/modelo</span><span>' + esc(it.tipoModelo) + '</span></div>';
    if (it.tamanho) extras += '<div class="ct-card-row"><span>Tamanho</span><span>' + esc(it.tamanho) + '</span></div>';
    if (it.corEstampa) extras += '<div class="ct-card-row"><span>Cor/estampa</span><span>' + esc(it.corEstampa) + '</span></div>';
    return '' +
      '<div class="ct-card">' +
      '<div class="ct-pinked" style="--tag-color:' + cc.color + '"></div>' +
      '<div class="ct-card-body">' +
      '<div class="ct-card-top">' +
      '<div class="ct-card-name">' + esc(it.nome) + '</div>' +
      '<div class="ct-card-actions">' +
      '<button class="ct-icon-btn" data-edit="' + it.id + '" aria-label="Editar" title="Editar">&#9998;</button>' +
      '<button class="ct-icon-btn" data-del="' + it.id + '" aria-label="Excluir" title="Excluir">&#10005;</button>' +
      '</div>' +
      '</div>' +
      '<span class="ct-tag" style="--tag-color:' + cc.color + ';--tag-bg:' + cc.bg + '">' + esc(it.categoria) + '</span>' +
      '<div class="ct-card-row"><span>Marca</span><span>' + esc(it.marca) + '</span></div>' +
      '<div class="ct-card-row"><span>Quantidade</span><span>' + esc(it.quantidade) + '</span></div>' +
      extras +
      '<div class="ct-card-row" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px"><span>Valor</span><span class="ct-valor">' + fmtMoney(it.valor) + '</span></div>' +
      '<div class="ct-card-row"><span>Valor em estoque</span><span>' + fmtMoney(toNumber(it.quantidade) * toNumber(it.valor)) + '</span></div>' +
      '</div>' +
      '</div>';
  }

  function filteredItems() {
    return state.items.filter(function (it) {
      if (state.filterCat && it.categoria !== state.filterCat) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        var hay = (it.nome + ' ' + it.marca + ' ' + it.categoria).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderForm() {
    var v = state.draft || Object.assign({}, EMPTY_DRAFT);
    var catOptions = state.categories.slice().sort().map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === v.categoria ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');

    var catField = state.addingCategory ?
      '<div class="ct-newcat-row"><input id="ct-newcat-input" placeholder="Nome da nova categoria" value="' + esc(state.newCategoryDraft) + '" /><button class="ct-btn ct-btn-ghost" id="ct-confirm-newcat" type="button">Adicionar</button></div>' :
      '<select id="ct-f-categoria">' +
      '<option value="">Selecione...</option>' +
      catOptions +
      '</select>' +
      '<span class="ct-optional-toggle" id="ct-open-newcat">+ criar nova categoria</span>';

    var html = '' +
      '<div class="ct-overlay">' +
      '<p class="ct-form-title">' + (state.editingId ? 'Editar item' : 'Novo item') + '</p>' +
      '<div class="ct-field"><label>Nome *</label><input id="ct-f-nome" value="' + esc(v.nome) + '" placeholder="Tricoline Floral" /></div>' +
      '<div class="ct-field"><label>Categoria *</label>' + catField + '</div>' +
      '<div class="ct-row2">' +
      '<div class="ct-field"><label>Quantidade *</label><input id="ct-f-quantidade" value="' + esc(v.quantidade) + '" placeholder="15" /></div>' +
      '<div class="ct-field"><label>Valor *</label><input id="ct-f-valor" value="' + esc(v.valor) + '" placeholder="25,90" /></div>' +
      '</div>' +
      '<div class="ct-field"><label>Marca *</label><input id="ct-f-marca" value="' + esc(v.marca) + '" placeholder="Círculo" /></div>' +
      (state.showOptional ? '' : '<span class="ct-optional-toggle" id="ct-show-optional">+ tipo, tamanho e cor (opcional)</span>') +
      '<div style="' + (state.showOptional ? '' : 'display:none') + '">' +
      '<div class="ct-field"><label>Tipo / modelo</label><input id="ct-f-tipo" value="' + esc(v.tipoModelo) + '" placeholder="Tricoline" /></div>' +
      '<div class="ct-row2">' +
      '<div class="ct-field"><label>Tamanho / medida</label><input id="ct-f-tamanho" value="' + esc(v.tamanho) + '" placeholder="1,50 m" /></div>' +
      '<div class="ct-field"><label>Cor / estampa</label><input id="ct-f-cor" value="' + esc(v.corEstampa) + '" placeholder="Azul floral" /></div>' +
      '</div>' +
      '</div>' +
      '<div id="ct-form-error" class="ct-error"></div>' +
      '<div class="ct-form-actions">' +
      '<button class="ct-btn" id="ct-submit-form">' + (state.editingId ? 'Salvar alterações' : 'Adicionar item') + '</button>' +
      '<button class="ct-btn ct-btn-ghost" id="ct-cancel-form">Cancelar</button>' +
      '</div>' +
      '</div>';
    return html;
  }

  function renderTabs() {
    return '<div class="ct-tabs">' +
      '<div class="ct-tab' + (state.activeTab === 'tecidos' ? ' active' : '') + '" data-tab="tecidos">Tecidos</div>' +
      '<div class="ct-tab' + (state.activeTab === 'roupas' ? ' active' : '') + '" data-tab="roupas">Roupas</div>' +
      '</div>';
  }

  function renderTecidosTab() {
    var items = filteredItems();
    var html = '';
    html += '<div class="ct-toolbar">' +
      '<input class="ct-search" id="ct-search-input" placeholder="Buscar por nome, marca ou categoria" value="' + esc(state.search) + '" />' +
      '<button class="ct-btn" id="ct-open-new">+ Novo item</button>' +
      '</div>';
    html += renderChips();

    if (items.length > 0) {
      var totalM = 0, totalV = 0;
      items.forEach(function (it) {
        var q = toNumber(it.quantidade);
        if (!isNaN(q)) {
          totalM += q;
          var v = toNumber(it.valor);
          if (!isNaN(v)) totalV += q * v;
        }
      });
      html += '<div class="ct-summary-bar"><span>Em estoque: <b>' + fmtMetros(totalM) + '</b></span><span>Valor em estoque: <b>' + fmtMoney(totalV) + '</b></span></div>';
    }

    if (items.length === 0) {
      html += '<div class="ct-empty"><b>' + (state.items.length === 0 ? 'Nenhum item cadastrado' : 'Nada encontrado') + '</b>' +
        (state.items.length === 0 ? 'Cadastre seu primeiro tecido, linha ou aviamento.' : 'Tente outra busca ou categoria.') + '</div>';
    } else {
      html += '<div class="ct-grid">' + items.map(renderCard).join('') + '</div>';
    }

    if (state.formOpen) html += renderForm();
    return html;
  }

  function renderRoupaForm() {
    var v = state.roupaDraft || { nome: '', tecidosVinculados: [] };
    var checkboxes = state.items.length === 0
      ? '<p style="font-size:13px;color:var(--ink-soft)">Cadastre tecidos na aba Tecidos antes de criar uma roupa.</p>'
      : state.items.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome); }).map(function (it) {
          var checked = v.tecidosVinculados.indexOf(it.id) > -1;
          return '<label class="ct-check-row"><input type="checkbox" class="ct-r-tecido-check" value="' + esc(it.id) + '"' + (checked ? ' checked' : '') + ' /> ' +
            esc(it.nome) + ' <span class="ct-check-stock">(' + esc(it.quantidade) + ' disponível)</span></label>';
        }).join('');

    return '' +
      '<div class="ct-overlay">' +
      '<p class="ct-form-title">' + (state.roupaEditingId ? 'Editar roupa' : 'Nova roupa') + '</p>' +
      '<div class="ct-field"><label>Nome *</label><input id="ct-r-nome" value="' + esc(v.nome) + '" placeholder="Camisa X" /></div>' +
      '<div class="ct-field"><label>Tecidos que podem ser usados *</label><div class="ct-check-list">' + checkboxes + '</div></div>' +
      '<div id="ct-roupa-form-error" class="ct-error"></div>' +
      '<div class="ct-form-actions">' +
      '<button class="ct-btn" id="ct-roupa-submit-form">' + (state.roupaEditingId ? 'Salvar alterações' : 'Criar roupa') + '</button>' +
      '<button class="ct-btn ct-btn-ghost" id="ct-roupa-cancel-form">Cancelar</button>' +
      '</div>' +
      '</div>';
  }

  function renderRoupaCard(roupa) {
    var linked = (roupa.tecidosVinculados || [])
      .map(function (id) { return state.items.find(function (it) { return it.id === id; }); })
      .filter(Boolean);

    var rows = linked.length === 0
      ? '<p style="font-size:12.5px;color:var(--ink-soft)">Nenhum tecido vinculado disponível (pode ter sido removido do estoque).</p>'
      : linked.map(function (it) {
          var key = roupa.id + ':' + it.id;
          var val = state.consumoDraft[key] !== undefined ? state.consumoDraft[key] : '';
          return '<div class="ct-roupa-tecido-row">' +
            '<span class="ct-roupa-tecido-name">' + esc(it.nome) + '<small>' + esc(it.quantidade) + ' disponível</small></span>' +
            '<input class="ct-consumo-input" data-key="' + esc(key) + '" value="' + esc(val) + '" placeholder="0" />' +
            '</div>';
        }).join('');

    var historico = '';
    if (state.historicoOpen[roupa.id]) {
      var cache = state.historicoCache[roupa.id];
      if (!cache) {
        historico = '<div class="ct-historico"><p style="font-size:12.5px;color:var(--ink-soft)">Carregando histórico...</p></div>';
      } else if (cache.length === 0) {
        historico = '<div class="ct-historico"><p style="font-size:12.5px;color:var(--ink-soft)">Nenhum consumo registrado ainda.</p></div>';
      } else {
        historico = '<div class="ct-historico">' + cache.map(function (c) {
          return '<div class="ct-historico-row"><span>' + esc(c.tecidoNome) + ' — ' + esc(c.quantidade) + ' — ' + fmtMoney(c.valorGasto) + '</span><span>' + esc(fmtData(c.data)) + '</span></div>';
        }).join('') + '</div>';
      }
    }

    return '' +
      '<div class="ct-roupa-card">' +
      '<div class="ct-card-top">' +
      '<div class="ct-card-name">' + esc(roupa.nome) + '</div>' +
      '<div class="ct-card-actions">' +
      '<button class="ct-icon-btn" data-edit-roupa="' + roupa.id + '" aria-label="Editar" title="Editar">&#9998;</button>' +
      '<button class="ct-icon-btn" data-del-roupa="' + roupa.id + '" aria-label="Excluir" title="Excluir">&#10005;</button>' +
      '</div>' +
      '</div>' +
      '<div class="ct-roupa-total">Já consumido: <b>' + fmtMetros(roupa.totalConsumidoMetros || 0) + '</b> · <b>' + fmtMoney(roupa.totalConsumidoValor || 0) + '</b></div>' +
      rows +
      '<div id="ct-roupa-error-' + roupa.id + '" class="ct-error"></div>' +
      '<div class="ct-form-actions">' +
      '<button class="ct-btn" data-registrar-consumo="' + roupa.id + '">Registrar consumo</button>' +
      '<button class="ct-btn ct-btn-ghost" data-toggle-historico="' + roupa.id + '">' + (state.historicoOpen[roupa.id] ? 'Ocultar histórico' : 'Ver histórico') + '</button>' +
      '</div>' +
      historico +
      '</div>';
  }

  function renderRoupasTab() {
    var html = '<div class="ct-toolbar"><button class="ct-btn" id="ct-open-new-roupa">+ Nova roupa</button></div>';

    if (state.roupas.length > 0) {
      var totalM = 0, totalV = 0;
      state.roupas.forEach(function (r) {
        totalM += toNumber(r.totalConsumidoMetros || 0) || 0;
        totalV += toNumber(r.totalConsumidoValor || 0) || 0;
      });
      html += '<div class="ct-summary-bar"><span>Total consumido (todas as roupas): <b>' + fmtMetros(totalM) + '</b></span><span>Valor total gasto: <b>' + fmtMoney(totalV) + '</b></span></div>';
    }

    if (state.roupas.length === 0) {
      html += '<div class="ct-empty"><b>Nenhuma roupa cadastrada</b>Crie uma roupa e vincule os tecidos que ela usa.</div>';
    } else {
      html += '<div class="ct-grid">' + state.roupas.map(renderRoupaCard).join('') + '</div>';
    }

    if (state.roupaFormOpen) html += renderRoupaForm();
    return html;
  }

  function render() {
    if (!currentUser) return;
    syncDraftFromDOM();
    syncRoupaDraftFromDOM();
    syncConsumoDraftFromDOM();

    var root = document.getElementById('ct-root');
    if (!state.loaded || !state.roupasLoaded) { root.innerHTML = '<div class="ct-loading">Carregando catálogo...</div>'; return; }

    if (state.dataError) {
      root.innerHTML =
        '<div class="ct-empty"><b>Não foi possível acessar seus dados</b>' +
        'Erro: ' + esc(state.dataError) + '.<br/>Confira se as regras do Firestore foram <b>publicadas</b> no console do Firebase (Firestore Database &gt; Regras &gt; botão Publicar).' +
        '</div>';
      return;
    }

    var html = renderTabs();
    html += state.activeTab === 'roupas' ? renderRoupasTab() : renderTecidosTab();

    root.innerHTML = html;
    attachEvents();

    if (state.activeTab === 'tecidos' && state.formOpen && state.addingCategory) {
      var nc = document.getElementById('ct-newcat-input');
      if (nc) nc.focus();
    }
  }

  function attachEvents() {
    var root = document.getElementById('ct-root');

    root.querySelectorAll('[data-tab]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.activeTab = el.getAttribute('data-tab');
        render();
      });
    });

    var searchInput = document.getElementById('ct-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        state.search = e.target.value;
        var pos = e.target.selectionStart;
        render();
        var again = document.getElementById('ct-search-input');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
    }

    var openNew = document.getElementById('ct-open-new');
    if (openNew) openNew.addEventListener('click', openNewForm);

    root.querySelectorAll('[data-catchip]').forEach(function (el) {
      el.addEventListener('click', function () {
        state.filterCat = el.getAttribute('data-catchip');
        render();
      });
    });
    var allChip = root.querySelector('[data-allchip]');
    if (allChip) allChip.addEventListener('click', function () { state.filterCat = null; render(); });

    root.querySelectorAll('[data-edit]').forEach(function (el) {
      el.addEventListener('click', function () { openEditForm(el.getAttribute('data-edit')); });
    });
    root.querySelectorAll('[data-del]').forEach(function (el) {
      el.addEventListener('click', function () { deleteItem(el.getAttribute('data-del')); });
    });

    var submitBtn = document.getElementById('ct-submit-form');
    if (submitBtn) submitBtn.addEventListener('click', submitForm);
    var cancelBtn = document.getElementById('ct-cancel-form');
    if (cancelBtn) cancelBtn.addEventListener('click', closeForm);

    var showOpt = document.getElementById('ct-show-optional');
    if (showOpt) showOpt.addEventListener('click', function () { state.showOptional = true; render(); });

    var openNewCat = document.getElementById('ct-open-newcat');
    if (openNewCat) openNewCat.addEventListener('click', function () { state.addingCategory = true; render(); });

    var newcatInput = document.getElementById('ct-newcat-input');
    if (newcatInput) newcatInput.addEventListener('input', function (e) { state.newCategoryDraft = e.target.value; });

    var confirmNewCat = document.getElementById('ct-confirm-newcat');
    if (confirmNewCat) confirmNewCat.addEventListener('click', confirmNewCategory);

    // ---- Roupas ----
    var openNewRoupa = document.getElementById('ct-open-new-roupa');
    if (openNewRoupa) openNewRoupa.addEventListener('click', openNewRoupaForm);

    var roupaSubmit = document.getElementById('ct-roupa-submit-form');
    if (roupaSubmit) roupaSubmit.addEventListener('click', submitRoupaForm);
    var roupaCancel = document.getElementById('ct-roupa-cancel-form');
    if (roupaCancel) roupaCancel.addEventListener('click', closeRoupaForm);

    root.querySelectorAll('[data-edit-roupa]').forEach(function (el) {
      el.addEventListener('click', function () { openEditRoupaForm(el.getAttribute('data-edit-roupa')); });
    });
    root.querySelectorAll('[data-del-roupa]').forEach(function (el) {
      el.addEventListener('click', function () { deleteRoupa(el.getAttribute('data-del-roupa')); });
    });
    root.querySelectorAll('[data-registrar-consumo]').forEach(function (el) {
      el.addEventListener('click', function () { registrarConsumo(el.getAttribute('data-registrar-consumo')); });
    });
    root.querySelectorAll('[data-toggle-historico]').forEach(function (el) {
      el.addEventListener('click', function () { toggleHistorico(el.getAttribute('data-toggle-historico')); });
    });

    root.querySelectorAll('.ct-consumo-input').forEach(function (el) {
      el.addEventListener('input', function (e) {
        var key = e.target.getAttribute('data-key');
        state.consumoDraft[key] = e.target.value;
      });
    });

    var rNome = document.getElementById('ct-r-nome');
    if (rNome) rNome.addEventListener('input', function (e) { if (state.roupaDraft) state.roupaDraft.nome = e.target.value; });
  }
})();