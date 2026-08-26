/**
 * PALMARES EFECTIVO EN EL ACTO
 * Client Dashboard - Pure JavaScript
 */

// ========================================
// DATA & STATE
// ========================================

const STORAGE_KEY = 'palmares_clientes';

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
let searchQuery = '';
let editingId = null;
let deletingId = null;

// ========================================
// LOCAL STORAGE
// ========================================

function loadClients() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            clients = JSON.parse(data);
        } else {
            clients = getDemoData();
            saveClients();
        }
    } catch (e) {
        clients = getDemoData();
    }
}

function saveClients() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
}

function getDemoData() {
    return [
        {
            id: '1',
            name: 'Roberto Gómez',
            type: 'jubilado',
            paymentDay: 5,
            phone: '3755-123456',
            email: 'roberto@email.com',
            notes: 'Jubilación ANSES',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: new Date().toISOString().split('T')[0]
        },
        {
            id: '2',
            name: 'María Elena Sosa',
            type: 'jubilado',
            paymentDay: 10,
            phone: '3755-234567',
            email: '',
            notes: '',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: ''
        },
        {
            id: '3',
            name: 'Carlos Benítez',
            type: 'privado',
            paymentDay: 15,
            phone: '3755-345678',
            email: 'carlos@empresa.com',
            notes: 'Empresa constructora',
            paymentStatus: 'overdue',
            isOverdue: true,
            daysOverdue: 7,
            lastPaymentDate: ''
        },
        {
            id: '4',
            name: 'Ana Laura Fernández',
            type: 'privado',
            paymentDay: 20,
            phone: '3755-456789',
            email: 'ana@email.com',
            notes: '',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: new Date().toISOString().split('T')[0]
        },
        {
            id: '5',
            name: 'Jorge Martínez',
            type: 'municipal',
            paymentDay: 5,
            phone: '3755-567890',
            email: '',
            notes: 'Municipalidad de Posadas',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: ''
        },
        {
            id: '6',
            name: 'Silvia Ríos',
            type: 'provincial',
            paymentDay: 12,
            phone: '3755-678901',
            email: 'silvia@gob.misiones.gov.ar',
            notes: 'Ministerio de Educación',
            paymentStatus: 'overdue',
            isOverdue: true,
            daysOverdue: 3,
            lastPaymentDate: ''
        }
    ];
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
    addClientBtn: document.getElementById('addClientBtn'),
    clientsContainer: document.getElementById('clientsContainer'),
    emptyState: document.getElementById('emptyState'),

    clientModal: document.getElementById('clientModal'),
    modalTitle: document.getElementById('modalTitle'),
    closeModal: document.getElementById('closeModal'),
    clientForm: document.getElementById('clientForm'),
    clientId: document.getElementById('clientId'),
    clientName: document.getElementById('clientName'),
    clientType: document.getElementById('clientType'),
    paymentDay: document.getElementById('paymentDay'),
    clientPhone: document.getElementById('clientPhone'),
    clientEmail: document.getElementById('clientEmail'),
    clientNotes: document.getElementById('clientNotes'),
    cancelBtn: document.getElementById('cancelBtn'),

    paymentModal: document.getElementById('paymentModal'),
    closePaymentModal: document.getElementById('closePaymentModal'),
    paymentForm: document.getElementById('paymentForm'),
    paymentClientId: document.getElementById('paymentClientId'),
    paymentClientPreview: document.getElementById('paymentClientPreview'),
    hasPaid: document.getElementById('hasPaid'),
    isOverdue: document.getElementById('isOverdue'),
    daysOverdue: document.getElementById('daysOverdue'),
    daysOverdueGroup: document.getElementById('daysOverdueGroup'),
    paymentDate: document.getElementById('paymentDate'),
    cancelPaymentBtn: document.getElementById('cancelPaymentBtn'),

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

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
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

// ========================================
// RENDER
// ========================================

function updateStats() {
    els.totalClients.textContent = clients.length;
    els.pendingPayments.textContent = clients.filter(c => c.paymentStatus === 'pending').length;
    els.overdueClients.textContent = clients.filter(c => c.paymentStatus === 'overdue').length;
}

function getFilteredClients() {
    let filtered = [...clients];

    if (currentFilter !== 'all') {
        filtered = filtered.filter(c => c.type === currentFilter);
    }

    if (currentStatusFilter !== 'all') {
        filtered = filtered.filter(c => c.paymentStatus === currentStatusFilter);
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

    return filtered;
}

function groupClients(filtered) {
    const groups = {};
    const order = ['jubilado', 'privado', 'municipal', 'provincial'];

    filtered.forEach(client => {
        if (!groups[client.type]) groups[client.type] = [];
        groups[client.type].push(client);
    });

    Object.keys(groups).forEach(type => {
        groups[type].sort((a, b) => a.paymentDay - b.paymentDay);
    });

    return { groups, order: order.filter(t => groups[t]) };
}

function renderClients() {
    const filtered = getFilteredClients();
    updateStats();

    if (filtered.length === 0) {
        els.clientsContainer.innerHTML = '';
        els.emptyState.classList.add('show');
        return;
    }

    els.emptyState.classList.remove('show');
    const { groups, order } = groupClients(filtered);

    let html = '';
    order.forEach(type => {
        const config = TYPE_CONFIG[type];
        const groupClients = groups[type];

        html += `
            <div class="client-group group-${type}">
                <div class="group-header">
                    <div class="group-title">
                        <i class="fas ${config.icon}"></i>
                        <span>${config.label}</span>
                    </div>
                    <span class="group-count">${groupClients.length}</span>
                </div>
                <div class="group-clients">
                    ${groupClients.map(client => renderClientCard(client)).join('')}
                </div>
            </div>
        `;
    });

    els.clientsContainer.innerHTML = html;
}

function renderClientCard(client) {
    const typeConfig = TYPE_CONFIG[client.type];
    const statusConfig = STATUS_CONFIG[client.paymentStatus];
    const today = new Date();
    const currentDay = today.getDate();
    const isPayDay = currentDay === client.paymentDay;

    let contactHtml = '';
    if (client.phone || client.email) {
        contactHtml = `<div class="client-contact">`;
        if (client.phone) contactHtml += `<span><i class="fas fa-phone"></i> ${client.phone}</span>`;
        if (client.email) contactHtml += `<span><i class="fas fa-envelope"></i> ${client.email}</span>`;
        contactHtml += `</div>`;
    }

    let notesHtml = client.notes ? `<div class="client-notes"><i class="fas fa-sticky-note"></i> ${client.notes}</div>` : '';

    let overdueHtml = '';
    if (client.paymentStatus === 'overdue' && client.daysOverdue > 0) {
        overdueHtml = `<span class="overdue-badge"><i class="fas fa-clock"></i> ${client.daysOverdue} días</span>`;
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
                        <span class="payment-day">
                            <i class="fas fa-calendar-day"></i> Cobro: día ${client.paymentDay}
                            ${isPayDay ? '<span style="color:var(--accent);font-weight:700;margin-left:4px;">(Hoy)</span>' : ''}
                        </span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn-icon payment" onclick="openPaymentModal('${client.id}')" title="Registrar pago">
                        <i class="fas fa-dollar-sign"></i>
                    </button>
                    <button class="btn-icon edit" onclick="editClient('${client.id}')" title="Editar">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-icon delete" onclick="confirmDelete('${client.id}')" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// CLIENT CRUD
// ========================================

function openAddModal() {
    editingId = null;
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
    els.modalTitle.textContent = 'Editar Cliente';
    els.clientId.value = client.id;
    els.clientName.value = client.name;
    els.clientType.value = client.type;
    els.paymentDay.value = client.paymentDay;
    els.clientPhone.value = client.phone || '';
    els.clientEmail.value = client.email || '';
    els.clientNotes.value = client.notes || '';

    openModal(els.clientModal);
}

function handleSaveClient(e) {
    e.preventDefault();

    const clientData = {
        name: els.clientName.value.trim(),
        type: els.clientType.value,
        paymentDay: parseInt(els.paymentDay.value),
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
            lastPaymentDate: ''
        };
        clients.push(newClient);
        showToast('Cliente agregado correctamente', 'success');
    }

    saveClients();
    renderClients();
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
// PAYMENT
// ========================================

function openPaymentModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    els.paymentClientId.value = id;
    els.paymentClientPreview.innerHTML = `
        <div class="preview-name">${escapeHtml(client.name)}</div>
        <div class="preview-type">${TYPE_CONFIG[client.type].label} - Cobro día ${client.paymentDay}</div>
    `;

    els.hasPaid.checked = client.paymentStatus === 'paid';
    els.isOverdue.checked = client.isOverdue;
    els.daysOverdue.value = client.daysOverdue || 1;
    els.paymentDate.value = client.lastPaymentDate || getToday();

    toggleOverdueFields();
    openModal(els.paymentModal);
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
    const paymentDate = els.paymentDate.value;

    let status = 'pending';
    if (hasPaid) {
        status = 'paid';
    } else if (isOverdue) {
        status = 'overdue';
    }

    client.paymentStatus = status;
    client.isOverdue = isOverdue;
    client.daysOverdue = isOverdue ? daysOverdue : 0;
    client.lastPaymentDate = hasPaid ? paymentDate : '';

    saveClients();
    renderClients();

    const msg = hasPaid ? 'Pago registrado correctamente' : 'Estado actualizado';
    showToast(msg, 'success');
    closeModalFn(els.paymentModal);
}

// ========================================
// FILTERS
// ========================================

function setupFilters() {
    document.querySelectorAll('[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderClients();
        });
    });

    document.querySelectorAll('[data-status]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStatusFilter = btn.dataset.status;
            renderClients();
        });
    });
}

// ========================================
// EVENT LISTENERS
// ========================================

function setupEventListeners() {
    els.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderClients();
    });

    els.filterBtn.addEventListener('click', () => {
        els.filterPanel.classList.toggle('open');
        els.filterBtn.classList.toggle('active');
    });

    els.addClientBtn.addEventListener('click', openAddModal);

    els.clientForm.addEventListener('submit', handleSaveClient);

    els.closeModal.addEventListener('click', () => closeModalFn(els.clientModal));
    els.cancelBtn.addEventListener('click', () => closeModalFn(els.clientModal));

    els.closePaymentModal.addEventListener('click', () => closeModalFn(els.paymentModal));
    els.cancelPaymentBtn.addEventListener('click', () => closeModalFn(els.paymentModal));

    els.cancelDeleteBtn.addEventListener('click', () => closeModalFn(els.deleteModal));
    els.confirmDeleteBtn.addEventListener('click', handleDelete);

    els.paymentForm.addEventListener('submit', handleSavePayment);
    els.isOverdue.addEventListener('change', toggleOverdueFields);

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            closeModalFn(modal);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.open').forEach(modal => closeModalFn(modal));
        }
    });
}

// ========================================
// INIT
// ========================================

function init() {
    loadClients();
    setupFilters();
    setupEventListeners();
    renderClients();
}

document.addEventListener('DOMContentLoaded', init);
