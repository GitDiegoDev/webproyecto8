/**
 * PALMARES EFECTIVO EN EL ACTO
 * Client Dashboard - Pure JavaScript (Vanilla JS ES6+)
 */

// ========================================
// DATA & STATE
// ========================================

const STORAGE_KEY = 'palmares_clientes';
const DB_NAME = 'PalmaresDB';
const DB_VERSION = 1;
const STORE_NAME = 'clients';

const TYPE_CONFIG = {
    jubilado: { label: 'Jubilado', icon: 'fa-user-clock', color: '#6b4c9a', badgeClass: 'badge-jubilado' },
    privado: { label: 'Privado', icon: 'fa-briefcase', color: '#2563eb', badgeClass: 'badge-privado' },
    municipal: { label: 'Municipal', icon: 'fa-building', color: '#059669', badgeClass: 'badge-municipal' },
    provincial: { label: 'Provincial', icon: 'fa-landmark', color: '#d97706', badgeClass: 'badge-provincial' }
};

const STATUS_CONFIG = {
    paid: { label: 'Pagado', class: 'paid', dotClass: 'paid' },
    pending: { label: 'Pendiente', class: 'pending', dotClass: 'pending' },
    overdue: { label: 'Atrasado', class: 'overdue', dotClass: 'overdue' }
};

let clients = [];
let currentFilter = 'all';
let currentStatusFilter = 'all';
let currentSortBy = 'paymentDay-asc';
let searchQuery = '';
let editingId = null;
let deletingId = null;
let isFormDirty = false;
let displayLimit = 20; // Pagination limit

// ========================================
// INDEXEDDB & STORAGE PERSISTENCE
// ========================================

function openDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            resolve(null);
            return;
        }
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => resolve(null);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        } catch (e) {
            resolve(null);
        }
    });
}

async function loadClients() {
    let loaded = false;

    // 1. Try IndexedDB
    try {
        const db = await openDB();
        if (db) {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            loaded = await new Promise((resolve) => {
                req.onsuccess = () => {
                    if (req.result && req.result.length > 0) {
                        clients = req.result;
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                };
                req.onerror = () => resolve(false);
            });
        }
    } catch (e) {
        console.warn('IndexedDB load failed:', e);
    }

    // 2. Fallback to localStorage if IndexedDB had no data or failed
    if (!loaded) {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                clients = JSON.parse(data);
                loaded = true;
            }
        } catch (e) {
            console.warn('localStorage load failed:', e);
        }
    }

    // 3. Fallback to Demo Data if no data in storage
    if (!loaded || clients.length === 0) {
        clients = getDemoData();
        saveClients();
    }

    // Ensure schema migration for existing records
    clients.forEach(c => sanitizeClientSchema(c));

    // Run automatic overdue check
    updateOverdueStatuses();
}

async function saveClients() {
    // 1. Save to IndexedDB
    try {
        const db = await openDB();
        if (db) {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            clients.forEach(client => store.put(client));
        }
    } catch (e) {
        console.warn('IndexedDB save failed:', e);
    }

    // 2. Save to localStorage with QuotaExceeded handling
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
            showToast('Almacenamiento lleno. Por favor exporta una copia de seguridad.', 'error');
        } else {
            console.warn('localStorage save failed (incognito/restricted):', e);
        }
    }
}

function sanitizeClientSchema(client) {
    if (typeof client.loanAmount !== 'number') client.loanAmount = parseFloat(client.loanAmount) || 0;
    if (typeof client.installmentAmount !== 'number') client.installmentAmount = parseFloat(client.installmentAmount) || 0;
    if (!Array.isArray(client.payments)) client.payments = [];
}

function getDemoData() {
    const todayStr = getToday();
    const currentMonth = todayStr.substring(0, 7);
    const todayDate = new Date();
    const currentDay = todayDate.getDate();

    return [
        {
            id: '1',
            name: 'Roberto Gómez',
            type: 'jubilado',
            paymentDay: currentDay,
            loanAmount: 120000,
            installmentAmount: 15000,
            phone: '3755-123456',
            email: 'roberto@email.com',
            notes: 'Jubilación ANSES',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: todayStr,
            payments: [
                { id: 'p1', amount: 15000, date: todayStr, periodMonth: currentMonth, notes: 'Pago en término' }
            ]
        },
        {
            id: '2',
            name: 'María Elena Sosa',
            type: 'jubilado',
            paymentDay: currentDay === 31 ? 1 : currentDay + 1, // Tomorrow
            loanAmount: 80000,
            installmentAmount: 10000,
            phone: '3755-234567',
            email: '',
            notes: '',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '3',
            name: 'Carlos Benítez',
            type: 'privado',
            paymentDay: currentDay > 7 ? currentDay - 7 : 1,
            loanAmount: 200000,
            installmentAmount: 25000,
            phone: '3755-345678',
            email: 'carlos@empresa.com',
            notes: 'Empresa constructora',
            paymentStatus: 'overdue',
            isOverdue: true,
            daysOverdue: 7,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '4',
            name: 'Ana Laura Fernández',
            type: 'privado',
            paymentDay: 20,
            loanAmount: 150000,
            installmentAmount: 18000,
            phone: '3755-456789',
            email: 'ana@email.com',
            notes: '',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: todayStr,
            payments: [
                { id: 'p2', amount: 18000, date: todayStr, periodMonth: currentMonth, notes: 'Transferencia bancaria' }
            ]
        },
        {
            id: '5',
            name: 'Jorge Martínez',
            type: 'municipal',
            paymentDay: 5,
            loanAmount: 90000,
            installmentAmount: 11000,
            phone: '3755-567890',
            email: '',
            notes: 'Municipalidad de Posadas',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '6',
            name: 'Silvia Ríos',
            type: 'provincial',
            paymentDay: currentDay > 3 ? currentDay - 3 : 1,
            loanAmount: 110000,
            installmentAmount: 13500,
            phone: '3755-678901',
            email: 'silvia@gob.misiones.gov.ar',
            notes: 'Ministerio de Educación',
            paymentStatus: 'overdue',
            isOverdue: true,
            daysOverdue: 3,
            lastPaymentDate: '',
            payments: []
        }
    ];
}

// ========================================
// AUTOMATIC OVERDUE ENGINE
// ========================================

function updateOverdueStatuses() {
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthStr = getToday().substring(0, 7);

    clients.forEach(client => {
        // Check if paid for current month
        const hasPaidThisMonth = client.paymentStatus === 'paid' && client.lastPaymentDate && client.lastPaymentDate.startsWith(currentMonthStr);

        if (hasPaidThisMonth) {
            client.paymentStatus = 'paid';
            client.isOverdue = false;
            client.daysOverdue = 0;
            return;
        }

        // If unpaid and current date is past client payment day
        if (currentDay > client.paymentDay) {
            client.paymentStatus = 'overdue';
            client.isOverdue = true;
            client.daysOverdue = currentDay - client.paymentDay;
        } else if (client.paymentStatus !== 'overdue') {
            client.paymentStatus = 'pending';
            client.isOverdue = false;
            client.daysOverdue = 0;
        }
    });
}

// ========================================
// DOM ELEMENTS
// ========================================

const els = {
    totalClients: document.getElementById('totalClients'),
    pendingPayments: document.getElementById('pendingPayments'),
    overdueClients: document.getElementById('overdueClients'),
    searchInput: document.getElementById('searchInput'),
    filterBtn: document.getElementById('filterBtn'),
    filterPanel: document.getElementById('filterPanel'),
    sortBySelect: document.getElementById('sortBySelect'),
    exportDataBtn: document.getElementById('exportDataBtn'),
    importDataBtn: document.getElementById('importDataBtn'),
    importFileInput: document.getElementById('importFileInput'),
    resetDemoBtn: document.getElementById('resetDemoBtn'),
    addClientBtn: document.getElementById('addClientBtn'),
    clientsContainer: document.getElementById('clientsContainer'),
    paginationBar: document.getElementById('paginationBar'),
    paginationInfo: document.getElementById('paginationInfo'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    emptyState: document.getElementById('emptyState'),

    clientModal: document.getElementById('clientModal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModal: document.getElementById('closeModal'),
    clientForm: document.getElementById('clientForm'),
    clientId: document.getElementById('clientId'),
    clientName: document.getElementById('clientName'),
    clientType: document.getElementById('clientType'),
    paymentDay: document.getElementById('paymentDay'),
    loanAmount: document.getElementById('loanAmount'),
    installmentAmount: document.getElementById('installmentAmount'),
    clientPhone: document.getElementById('clientPhone'),
    clientEmail: document.getElementById('clientEmail'),
    clientNotes: document.getElementById('clientNotes'),
    cancelBtn: document.getElementById('cancelBtn'),

    paymentModal: document.getElementById('paymentModal'),
    closePaymentModal: document.getElementById('closePaymentModal'),
    paymentForm: document.getElementById('paymentForm'),
    paymentClientId: document.getElementById('paymentClientId'),
    paymentClientPreview: document.getElementById('paymentClientPreview'),
    paidAmount: document.getElementById('paidAmount'),
    hasPaid: document.getElementById('hasPaid'),
    isOverdue: document.getElementById('isOverdue'),
    daysOverdue: document.getElementById('daysOverdue'),
    daysOverdueGroup: document.getElementById('daysOverdueGroup'),
    paymentDate: document.getElementById('paymentDate'),
    paymentNotes: document.getElementById('paymentNotes'),
    paymentHistoryList: document.getElementById('paymentHistoryList'),
    cancelPaymentBtn: document.getElementById('cancelPaymentBtn'),

    unsavedModal: document.getElementById('unsavedModal'),
    keepEditingBtn: document.getElementById('keepEditingBtn'),
    discardChangesBtn: document.getElementById('discardChangesBtn'),

    deleteModal: document.getElementById('deleteModal'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),

    toastContainer: document.getElementById('toastContainer')
};

// ========================================
// UTILITIES
// ========================================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatCurrency(amount) {
    if (typeof amount !== 'number' || isNaN(amount)) return '$0';
    return '$' + amount.toLocaleString('es-AR');
}

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${escapeHtml(message)}</span>`;
    els.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function openModal(modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModalFn(modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// DATA BACKUP & EXPORT/IMPORT
// ========================================

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(clients, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `palmares_backup_${getToday()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Copia de seguridad descargada', 'success');
}

function importData(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) {
                throw new Error('El archivo no contiene un formato de clientes válido.');
            }
            imported.forEach(c => sanitizeClientSchema(c));
            clients = imported;
            updateOverdueStatuses();
            saveClients();
            renderClients();
            showToast('Datos importados correctamente', 'success');
        } catch (err) {
            showToast('Error al importar archivo JSON: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function resetDemoData() {
    if (confirm('¿Estás seguro de restablecer los datos originales de demostración? Se sobrescribirán los cambios actuales.')) {
        clients = getDemoData();
        saveClients();
        renderClients();
        showToast('Datos de demostración restablecidos', 'info');
    }
}

// ========================================
// RENDER & FILTERING & SORTING
// ========================================

function updateStats() {
    els.totalClients.textContent = clients.length;
    els.pendingPayments.textContent = clients.filter(c => c.paymentStatus === 'pending').length;
    els.overdueClients.textContent = clients.filter(c => c.paymentStatus === 'overdue').length;
}

function getFilteredClients() {
    let filtered = [...clients];
    const todayDay = new Date().getDate();
    const tomorrowDay = todayDay === 31 ? 1 : todayDay + 1;

    if (currentFilter !== 'all') {
        filtered = filtered.filter(c => c.type === currentFilter);
    }

    if (currentStatusFilter !== 'all') {
        if (currentStatusFilter === 'today') {
            filtered = filtered.filter(c => c.paymentDay === todayDay && c.paymentStatus !== 'paid');
        } else {
            filtered = filtered.filter(c => c.paymentStatus === currentStatusFilter);
        }
    }

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.phone && c.phone.includes(q)) ||
            (c.email && c.email.toLowerCase().includes(q)) ||
            (c.notes && c.notes.toLowerCase().includes(q))
        );
    }

    // Sort clients
    filtered.sort((a, b) => {
        if (currentSortBy === 'paymentDay-asc') {
            return a.paymentDay - b.paymentDay;
        } else if (currentSortBy === 'name-asc') {
            return a.name.localeCompare(b.name);
        } else if (currentSortBy === 'status-asc') {
            const priority = { overdue: 1, pending: 2, paid: 3 };
            return (priority[a.paymentStatus] || 4) - (priority[b.paymentStatus] || 4);
        } else if (currentSortBy === 'installment-desc') {
            return (b.installmentAmount || 0) - (a.installmentAmount || 0);
        }
        return 0;
    });

    return filtered;
}

function groupClients(filtered) {
    const groups = {};
    const order = ['jubilado', 'privado', 'municipal', 'provincial'];

    filtered.forEach(client => {
        if (!groups[client.type]) groups[client.type] = [];
        groups[client.type].push(client);
    });

    return { groups, order: order.filter(t => groups[t] && groups[t].length > 0) };
}

function renderClients() {
    const filtered = getFilteredClients();
    updateStats();

    if (filtered.length === 0) {
        els.clientsContainer.innerHTML = '';
        els.emptyState.classList.add('show');
        els.paginationBar.style.display = 'none';
        return;
    }

    els.emptyState.classList.remove('show');

    // Apply pagination / slice limit
    const paginated = filtered.slice(0, displayLimit);
    if (filtered.length > displayLimit) {
        els.paginationBar.style.display = 'flex';
        els.paginationInfo.textContent = `Mostrando ${paginated.length} de ${filtered.length} clientes`;
    } else {
        els.paginationBar.style.display = 'none';
    }

    const { groups, order } = groupClients(paginated);

    // Use DocumentFragment for efficient rendering
    const container = document.createElement('div');

    order.forEach(type => {
        const config = TYPE_CONFIG[type];
        const groupClientsList = groups[type];

        const groupEl = document.createElement('div');
        groupEl.className = `client-group group-${type}`;
        groupEl.innerHTML = `
            <div class="group-header">
                <div class="group-title">
                    <i class="fas ${config.icon}"></i>
                    <span>${config.label}</span>
                </div>
                <span class="group-count">${groupClientsList.length}</span>
            </div>
            <div class="group-clients">
                ${groupClientsList.map(client => renderClientCard(client)).join('')}
            </div>
        `;
        container.appendChild(groupEl);
    });

    els.clientsContainer.innerHTML = container.innerHTML;
}

function renderClientCard(client) {
    const typeConfig = TYPE_CONFIG[client.type];
    const statusConfig = STATUS_CONFIG[client.paymentStatus];
    const today = new Date();
    const currentDay = today.getDate();
    const isPayDay = currentDay === client.paymentDay;
    const isTomorrow = (currentDay === 31 ? 1 : currentDay + 1) === client.paymentDay;

    let contactHtml = '';
    if (client.phone || client.email) {
        contactHtml = `<div class="client-contact">`;
        if (client.phone) contactHtml += `<span><i class="fas fa-phone"></i> ${escapeHtml(client.phone)}</span>`;
        if (client.email) contactHtml += `<span><i class="fas fa-envelope"></i> ${escapeHtml(client.email)}</span>`;
        contactHtml += `</div>`;
    }

    let notesHtml = client.notes ? `<div class="client-notes"><i class="fas fa-sticky-note"></i> ${escapeHtml(client.notes)}</div>` : '';

    let amountsHtml = '';
    if (client.loanAmount > 0 || client.installmentAmount > 0) {
        amountsHtml = `<div class="client-amounts">`;
        if (client.loanAmount > 0) {
            amountsHtml += `<div class="amount-badge"><span class="label">Préstamo:</span><span class="value">${formatCurrency(client.loanAmount)}</span></div>`;
        }
        if (client.installmentAmount > 0) {
            amountsHtml += `<div class="amount-badge"><span class="label">Cuota:</span><span class="value">${formatCurrency(client.installmentAmount)}</span></div>`;
        }
        amountsHtml += `</div>`;
    }

    let overdueHtml = '';
    if (client.paymentStatus === 'overdue' && client.daysOverdue > 0) {
        overdueHtml = `<span class="overdue-badge"><i class="fas fa-clock"></i> ${client.daysOverdue} días</span>`;
    }

    let todayBadgeHtml = '';
    if (isPayDay && client.paymentStatus !== 'paid') {
        todayBadgeHtml = `<span class="badge badge-today"><i class="fas fa-exclamation-circle"></i> Cobra Hoy</span>`;
    } else if (isTomorrow && client.paymentStatus !== 'paid') {
        todayBadgeHtml = `<span class="badge badge-tomorrow"><i class="fas fa-bell"></i> Cobra Mañana</span>`;
    }

    const payBtnText = client.paymentStatus === 'paid' ? '<i class="fas fa-check"></i> Pagado' : 'Registrar pago';
    const payBtnClass = client.paymentStatus === 'paid' ? 'paid' : '';

    return `
        <div class="client-card ${client.paymentStatus}">
            <div class="card-header">
                <div class="client-info">
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="client-meta">
                        <span class="badge ${typeConfig.badgeClass}">
                            <i class="fas ${typeConfig.icon}"></i> ${typeConfig.label}
                        </span>
                        ${todayBadgeHtml}
                        <span class="payment-day">
                            <i class="fas fa-calendar-day"></i> Cobro: día ${client.paymentDay}
                        </span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn-icon payment" onclick="openPaymentModal('${client.id}')" title="Registrar pago" aria-label="Registrar pago">
                        <i class="fas fa-dollar-sign"></i>
                    </button>
                    <button class="btn-icon edit" onclick="editClient('${client.id}')" title="Editar" aria-label="Editar cliente">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-icon delete" onclick="confirmDelete('${client.id}')" title="Eliminar" aria-label="Eliminar cliente">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            ${amountsHtml}
            ${contactHtml}
            ${notesHtml}
            <div class="payment-status">
                <div class="status-indicator">
                    <span class="status-dot ${statusConfig.dotClass}"></span>
                    <span class="status-text ${statusConfig.class}">${statusConfig.label}</span>
                    ${overdueHtml}
                </div>
                <button class="btn-pay ${payBtnClass}" onclick="openPaymentModal('${client.id}')">
                    ${payBtnText}
                </button>
            </div>
        </div>
    `;
}

// ========================================
// CLIENT CRUD
// ========================================

function openAddModal() {
    editingId = null;
    isFormDirty = false;
    els.modalTitle.textContent = 'Nuevo Cliente';
    els.clientForm.reset();
    els.clientId.value = '';
    openModal(els.clientModal);
    els.clientName.focus();
}

function editClient(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    editingId = id;
    isFormDirty = false;
    els.modalTitle.textContent = 'Editar Cliente';
    els.clientId.value = client.id;
    els.clientName.value = client.name;
    els.clientType.value = client.type;
    els.paymentDay.value = client.paymentDay;
    els.loanAmount.value = client.loanAmount || '';
    els.installmentAmount.value = client.installmentAmount || '';
    els.clientPhone.value = client.phone || '';
    els.clientEmail.value = client.email || '';
    els.clientNotes.value = client.notes || '';

    openModal(els.clientModal);
}

function handleCloseClientModal() {
    if (isFormDirty) {
        openModal(els.unsavedModal);
    } else {
        closeModalFn(els.clientModal);
    }
}

function handleSaveClient(e) {
    e.preventDefault();

    const clientData = {
        name: els.clientName.value.trim(),
        type: els.clientType.value,
        paymentDay: parseInt(els.paymentDay.value),
        loanAmount: parseFloat(els.loanAmount.value) || 0,
        installmentAmount: parseFloat(els.installmentAmount.value) || 0,
        phone: els.clientPhone.value.trim(),
        email: els.clientEmail.value.trim(),
        notes: els.clientNotes.value.trim()
    };

    if (editingId) {
        const idx = clients.findIndex(c => c.id === editingId);
        if (idx !== -1) {
            clients[idx] = { ...clients[idx], ...clientData };
            showToast('Cliente actualizado correctamente', 'success');
        }
    } else {
        const newClient = {
            id: generateId(),
            ...clientData,
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        };
        clients.push(newClient);
        showToast('Cliente agregado correctamente', 'success');
    }

    updateOverdueStatuses();
    saveClients();
    renderClients();
    isFormDirty = false;
    closeModalFn(els.clientModal);
}

function confirmDelete(id) {
    deletingId = id;
    openModal(els.deleteModal);
}

function handleDelete() {
    if (!deletingId) return;
    clients = clients.filter(c => c.id !== deletingId);
    saveClients();
    renderClients();
    showToast('Cliente eliminado', 'info');
    deletingId = null;
    closeModalFn(els.deleteModal);
}

// ========================================
// PAYMENT & HISTORY
// ========================================

function openPaymentModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    els.paymentClientId.value = id;
    els.paymentClientPreview.innerHTML = `
        <div class="preview-name">${escapeHtml(client.name)}</div>
        <div class="preview-type">${TYPE_CONFIG[client.type].label} - Cobro día ${client.paymentDay}</div>
        ${client.installmentAmount > 0 ? `<div style="font-size:0.8125rem;color:var(--primary);font-weight:700;margin-top:2px;">Cuota mensual: ${formatCurrency(client.installmentAmount)}</div>` : ''}
    `;

    els.paidAmount.value = client.installmentAmount || '';
    els.hasPaid.checked = client.paymentStatus === 'paid';
    els.isOverdue.checked = client.isOverdue;
    els.daysOverdue.value = client.daysOverdue || 1;
    els.paymentDate.value = client.lastPaymentDate || getToday();
    els.paymentNotes.value = '';

    renderPaymentHistory(client);
    toggleOverdueFields();
    openModal(els.paymentModal);
}

function renderPaymentHistory(client) {
    if (!client.payments || client.payments.length === 0) {
        els.paymentHistoryList.innerHTML = `<div class="no-history">No hay pagos registrados anteriormente.</div>`;
        return;
    }

    // Sort descending by date
    const sorted = [...client.payments].sort((a, b) => b.date.localeCompare(a.date));

    els.paymentHistoryList.innerHTML = sorted.map(p => `
        <div class="history-item">
            <div>
                <span class="hist-date"><i class="fas fa-calendar"></i> ${formatDate(p.date)}</span>
                ${p.notes ? `<div class="hist-note">${escapeHtml(p.notes)}</div>` : ''}
            </div>
            <span class="hist-amount">${formatCurrency(p.amount)}</span>
        </div>
    `).join('');
}

function toggleOverdueFields() {
    const showOverdue = els.isOverdue.checked;
    els.daysOverdueGroup.style.display = showOverdue ? 'block' : 'none';
}

function handleSavePayment(e) {
    e.preventDefault();

    const id = els.paymentClientId.value;
    const client = clients.find(c => c.id === id);
    if (!client) return;

    const hasPaid = els.hasPaid.checked;
    const isOverdue = els.isOverdue.checked;
    const daysOverdue = parseInt(els.daysOverdue.value) || 0;
    const paymentDate = els.paymentDate.value || getToday();
    const paidAmountVal = parseFloat(els.paidAmount.value) || client.installmentAmount || 0;
    const payNote = els.paymentNotes.value.trim();

    let status = 'pending';
    if (hasPaid) {
        status = 'paid';
    } else if (isOverdue) {
        status = 'overdue';
    }

    client.paymentStatus = status;
    client.isOverdue = isOverdue;
    client.daysOverdue = isOverdue ? daysOverdue : 0;

    if (hasPaid) {
        client.lastPaymentDate = paymentDate;
        const periodMonth = paymentDate.substring(0, 7);

        // Record payment item into payments history
        const newPayment = {
            id: generateId(),
            amount: paidAmountVal,
            date: paymentDate,
            periodMonth: periodMonth,
            notes: payNote || 'Pago mensual registrado'
        };
        if (!client.payments) client.payments = [];
        client.payments.push(newPayment);
    }

    updateOverdueStatuses();
    saveClients();
    renderClients();

    const msg = hasPaid ? 'Pago registrado correctamente' : 'Estado de pago actualizado';
    showToast(msg, 'success');
    closeModalFn(els.paymentModal);
}

// ========================================
// FILTERS & EVENTS SETUP
// ========================================

function setupFilters() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            displayLimit = 20;
            renderClients();
        });
    });

    document.querySelectorAll('[data-status]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStatusFilter = btn.dataset.status;
            displayLimit = 20;
            renderClients();
        });
    });

    els.sortBySelect.addEventListener('change', (e) => {
        currentSortBy = e.target.value;
        renderClients();
    });
}

function setupEventListeners() {
    els.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        displayLimit = 20;
        renderClients();
    });

    els.filterBtn.addEventListener('click', () => {
        els.filterPanel.classList.toggle('open');
        els.filterBtn.classList.toggle('active');
    });

    els.addClientBtn.addEventListener('click', openAddModal);

    // Track dirty form state
    els.clientForm.querySelectorAll('input, select, textarea').forEach(input => {
        input.addEventListener('input', () => { isFormDirty = true; });
    });

    els.clientForm.addEventListener('submit', handleSaveClient);

    els.closeModal.addEventListener('click', handleCloseClientModal);
    els.cancelBtn.addEventListener('click', handleCloseClientModal);

    els.keepEditingBtn.addEventListener('click', () => closeModalFn(els.unsavedModal));
    els.discardChangesBtn.addEventListener('click', () => {
        isFormDirty = false;
        closeModalFn(els.unsavedModal);
        closeModalFn(els.clientModal);
    });

    els.closePaymentModal.addEventListener('click', () => closeModalFn(els.paymentModal));
    els.cancelPaymentBtn.addEventListener('click', () => closeModalFn(els.paymentModal));

    els.cancelDeleteBtn.addEventListener('click', () => closeModalFn(els.deleteModal));
    els.confirmDeleteBtn.addEventListener('click', handleDelete);

    els.paymentForm.addEventListener('submit', handleSavePayment);
    els.isOverdue.addEventListener('change', toggleOverdueFields);

    // Backup & Restore Events
    els.exportDataBtn.addEventListener('click', exportData);
    els.importDataBtn.addEventListener('click', () => els.importFileInput.click());
    els.importFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            importData(e.target.files[0]);
            e.target.value = '';
        }
    });
    els.resetDemoBtn.addEventListener('click', resetDemoData);

    // Pagination / Load More
    els.loadMoreBtn.addEventListener('click', () => {
        displayLimit += 20;
        renderClients();
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal.id === 'clientModal' && isFormDirty) {
                openModal(els.unsavedModal);
            } else {
                closeModalFn(modal);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.open').forEach(modal => {
                if (modal.id === 'clientModal' && isFormDirty) {
                    openModal(els.unsavedModal);
                } else {
                    closeModalFn(modal);
                }
            });
        }
    });
}

// Service Worker Registration for Offline Capabilities
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('ServiceWorker registered:', reg.scope))
                .catch(err => console.warn('ServiceWorker registration failed:', err));
        });
    }
}

// ========================================
// INIT
// ========================================

async function init() {
    await loadClients();
    setupFilters();
    setupEventListeners();
    renderClients();
    registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
