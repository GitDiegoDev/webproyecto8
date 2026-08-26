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
    docente: { label: 'Docente', icon: 'fa-chalkboard-user', color: '#ec4899', badgeClass: 'badge-docente' },
    policia: { label: 'Policía', icon: 'fa-shield-halved', color: '#4f46e5', badgeClass: 'badge-policia' },
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
let currentMonthFilter = 'all';
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
    if (typeof client.loanAmount !== 'number') client.loanAmount = parseCurrencyInput(client.loanAmount);
    if (typeof client.installmentAmount !== 'number') client.installmentAmount = parseCurrencyInput(client.installmentAmount);
    if (!client.salaryDay) client.salaryDay = client.paymentDay || 10;
    if (typeof client.dni !== 'string') client.dni = client.dni ? client.dni.toString().trim() : '';
    if (!client.branchNumber) client.branchNumber = '';
    if (!client.requestNumber) client.requestNumber = '';
    if (typeof client.installmentNumber !== 'number') client.installmentNumber = parseInt(client.installmentNumber) || 1;
    if (!client.totalInstallments) client.totalInstallments = 12;
    if (client.penaltyRate === undefined || client.penaltyRate === null) client.penaltyRate = 1.0; // 1% per day default
    if (!client.periodMonth) client.periodMonth = getToday().substring(0, 7);
    if (!Array.isArray(client.payments)) client.payments = [];
}

function formatTwoDigitNumber(numStr) {
    if (!numStr) return '';
    const trimmed = numStr.toString().trim().replace(/\D/g, '');
    if (!trimmed) return '';
    return trimmed.padStart(2, '0').slice(-2);
}

function calculatePunitorios(installmentAmount, daysOverdue, penaltyRate = 1.0) {
    if (!installmentAmount || daysOverdue <= 0 || !penaltyRate || penaltyRate <= 0) return 0;
    const dailyInterest = (installmentAmount * (penaltyRate / 100)) * daysOverdue;
    return Math.round(dailyInterest * 100) / 100;
}

function formatMonthYear(yyyyMm) {
    if (!yyyyMm || typeof yyyyMm !== 'string' || !yyyyMm.includes('-')) return yyyyMm || '';
    const [year, month] = yyyyMm.split('-');
    const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mIdx = parseInt(month, 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
        return `${months[mIdx]} ${year}`;
    }
    return yyyyMm;
}

function formatRequestNumber(numStr) {
    return formatTwoDigitNumber(numStr);
}

function formatBranchNumber(numStr) {
    return formatTwoDigitNumber(numStr);
}

function getDniTermination(dni) {
    if (!dni) return null;
    const digits = dni.toString().replace(/\D/g, '');
    if (!digits) return null;
    return digits.slice(-1);
}

function parseCurrencyInput(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    let str = val.toString().trim().replace(/\s/g, '').replace(/\$/g, '');
    if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
    } else if (str.includes(',')) {
        str = str.replace(',', '.');
    }
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : parsed;
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
            branchNumber: '01',
            requestNumber: '01',
            installmentNumber: 5,
            totalInstallments: 12,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '14.234.567',
            type: 'jubilado',
            salaryDay: currentDay > 2 ? currentDay - 2 : 28,
            paymentDay: currentDay,
            loanAmount: 120000,
            installmentAmount: 15000.50,
            phone: '3755-123456',
            email: 'roberto@email.com',
            notes: 'Jubilación ANSES',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: todayStr,
            payments: [
                { id: 'p1', amount: 15000.50, date: todayStr, periodMonth: currentMonth, installmentNumber: '5/12', paymentType: 'total', notes: 'Pago en término' }
            ]
        },
        {
            id: '2',
            name: 'María Elena Sosa',
            branchNumber: '01',
            requestNumber: '02',
            installmentNumber: 2,
            totalInstallments: 6,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '18.456.789',
            type: 'jubilado',
            salaryDay: 27,
            paymentDay: currentDay === 31 ? 1 : currentDay + 1, // Tomorrow
            loanAmount: 80000,
            installmentAmount: 100444.44,
            phone: '3755-234567',
            email: '',
            notes: 'Cobra sueldo el 27 de cada mes',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '3',
            name: 'Patricia Morales',
            branchNumber: '01',
            requestNumber: '03',
            installmentNumber: 1,
            totalInstallments: 12,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '28.765.432',
            type: 'docente',
            salaryDay: 2,
            paymentDay: 5,
            loanAmount: 180000,
            installmentAmount: 22000,
            phone: '3755-789012',
            email: 'pmorales@escuela.edu.ar',
            notes: 'Escuela Normal N° 4',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '4',
            name: 'Sgto. Ramón Fernández',
            branchNumber: '02',
            requestNumber: '04',
            installmentNumber: 4,
            totalInstallments: 10,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '25.345.678',
            type: 'policia',
            salaryDay: 3,
            paymentDay: 6,
            loanAmount: 250000,
            installmentAmount: 31000,
            phone: '3755-890123',
            email: '',
            notes: 'Comisaría Seccional 1ra',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            payments: []
        },
        {
            id: '5',
            name: 'Carlos Benítez',
            branchNumber: '02',
            requestNumber: '05',
            installmentNumber: 3,
            totalInstallments: 12,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '23.456.789',
            type: 'privado',
            salaryDay: 10,
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
            id: '6',
            name: 'Ana Laura Fernández',
            branchNumber: '03',
            requestNumber: '06',
            installmentNumber: 6,
            totalInstallments: 6,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '31.987.654',
            type: 'privado',
            salaryDay: 5,
            paymentDay: 20,
            loanAmount: 150000,
            installmentAmount: 18450.75,
            phone: '3755-456789',
            email: 'ana@email.com',
            notes: '',
            paymentStatus: 'paid',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: todayStr,
            payments: [
                { id: 'p2', amount: 18450.75, date: todayStr, periodMonth: currentMonth, installmentNumber: '6/6', notes: 'Transferencia bancaria' }
            ]
        },
        {
            id: '7',
            name: 'Jorge Martínez',
            branchNumber: '01',
            requestNumber: '07',
            installmentNumber: 2,
            totalInstallments: 12,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '29.111.222',
            type: 'municipal',
            salaryDay: 1,
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
            id: '8',
            name: 'Silvia Ríos',
            branchNumber: '02',
            requestNumber: '08',
            installmentNumber: 8,
            totalInstallments: 12,
            penaltyRate: 1.0,
            periodMonth: currentMonth,
            dni: '26.333.444',
            type: 'provincial',
            salaryDay: 30,
            paymentDay: currentDay > 3 ? currentDay - 3 : 1,
            loanAmount: 110000,
            installmentAmount: 13500.25,
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
    monthFilterSelect: document.getElementById('monthFilterSelect'),
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
    branchNumber: document.getElementById('branchNumber'),
    requestNumber: document.getElementById('requestNumber'),
    installmentNumber: document.getElementById('installmentNumber'),
    totalInstallments: document.getElementById('totalInstallments'),
    periodMonth: document.getElementById('periodMonth'),
    penaltyRate: document.getElementById('penaltyRate'),
    clientDni: document.getElementById('clientDni'),
    clientType: document.getElementById('clientType'),
    salaryDay: document.getElementById('salaryDay'),
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
    paymentType: document.getElementById('paymentType'),
    paidAmount: document.getElementById('paidAmount'),
    amountGiven: document.getElementById('amountGiven'),
    paymentDate: document.getElementById('paymentDate'),
    paymentPeriodMonth: document.getElementById('paymentPeriodMonth'),
    paymentInstallmentNumber: document.getElementById('paymentInstallmentNumber'),
    paymentCalculationBox: document.getElementById('paymentCalculationBox'),
    hasPaid: document.getElementById('hasPaid'),
    isOverdue: document.getElementById('isOverdue'),
    daysOverdue: document.getElementById('daysOverdue'),
    daysOverdueGroup: document.getElementById('daysOverdueGroup'),
    paymentNotes: document.getElementById('paymentNotes'),
    paymentHistoryList: document.getElementById('paymentHistoryList'),
    cancelPaymentBtn: document.getElementById('cancelPaymentBtn'),

    unsavedModal: document.getElementById('unsavedModal'),
    keepEditingBtn: document.getElementById('keepEditingBtn'),
    discardChangesBtn: document.getElementById('discardChangesBtn'),

    deleteModal: document.getElementById('deleteModal'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),

    summaryBtn: document.getElementById('summaryBtn'),
    summaryModal: document.getElementById('summaryModal'),
    closeSummaryModal: document.getElementById('closeSummaryModal'),
    closeSummaryBtn: document.getElementById('closeSummaryBtn'),
    summaryBody: document.getElementById('summaryBody'),
    copySummaryBtn: document.getElementById('copySummaryBtn'),

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
    if (typeof amount !== 'number' || isNaN(amount)) return '$ 0,00';
    return '$ ' + amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function updateMonthFilterOptions() {
    if (!els.monthFilterSelect) return;
    const monthsSet = new Set();
    const currentMonthStr = getToday().substring(0, 7);
    monthsSet.add(currentMonthStr);

    clients.forEach(c => {
        if (c.periodMonth) monthsSet.add(c.periodMonth);
        if (c.payments && Array.isArray(c.payments)) {
            c.payments.forEach(p => {
                if (p.periodMonth) monthsSet.add(p.periodMonth);
            });
        }
    });

    const sortedMonths = Array.from(monthsSet).sort().reverse();

    const selectedValue = currentMonthFilter;
    let optionsHtml = `<option value="all"${selectedValue === 'all' ? ' selected' : ''}>Todos los meses</option>`;

    sortedMonths.forEach(m => {
        const label = formatMonthYear(m);
        optionsHtml += `<option value="${m}"${selectedValue === m ? ' selected' : ''}>${label}</option>`;
    });

    els.monthFilterSelect.innerHTML = optionsHtml;
}

function updateStats() {
    els.totalClients.textContent = clients.length;
    els.pendingPayments.textContent = clients.filter(c => c.paymentStatus === 'pending').length;
    els.overdueClients.textContent = clients.filter(c => c.paymentStatus === 'overdue').length;
}

function getFilteredClients() {
    let filtered = [...clients];
    const todayDay = new Date().getDate();

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

    if (currentMonthFilter !== 'all') {
        filtered = filtered.filter(c => c.periodMonth === currentMonthFilter);
    }

    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.branchNumber && c.branchNumber.toLowerCase().includes(q)) ||
            (c.requestNumber && c.requestNumber.toLowerCase().includes(q)) ||
            (c.installmentNumber && c.installmentNumber.toString().toLowerCase().includes(q)) ||
            (c.dni && c.dni.toLowerCase().includes(q)) ||
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
    const order = ['jubilado', 'docente', 'policia', 'privado', 'municipal', 'provincial'];

    filtered.forEach(client => {
        if (!groups[client.type]) groups[client.type] = [];
        groups[client.type].push(client);
    });

    return { groups, order: order.filter(t => groups[t] && groups[t].length > 0) };
}

function renderClients() {
    updateMonthFilterOptions();
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
    const isSalaryDay = currentDay === client.salaryDay;

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

    const punitorios = (client.paymentStatus === 'overdue' && client.daysOverdue > 0) ? calculatePunitorios(client.installmentAmount, client.daysOverdue, client.penaltyRate) : 0;

    let overdueHtml = '';
    if (client.paymentStatus === 'overdue' && client.daysOverdue > 0) {
        overdueHtml = `<span class="overdue-badge"><i class="fas fa-clock"></i> ${client.daysOverdue} días de mora</span>`;
        if (punitorios > 0) {
            overdueHtml += `<span class="penalty-badge" title="Interés punitorio por mora (${client.penaltyRate || 1.0}% diario)"><i class="fas fa-percent"></i> Punitorios: ${formatCurrency(punitorios)}</span>`;
        }
    }

    let todayBadgeHtml = '';
    if (isSalaryDay) {
        todayBadgeHtml = `<span class="badge badge-today"><i class="fas fa-wallet"></i> Cobra Sueldo Hoy (día ${client.salaryDay})</span>`;
    } else if (isPayDay && client.paymentStatus !== 'paid') {
        todayBadgeHtml = `<span class="badge badge-today"><i class="fas fa-exclamation-circle"></i> Vence Cuota Hoy</span>`;
    } else if (isTomorrow && client.paymentStatus !== 'paid') {
        todayBadgeHtml = `<span class="badge badge-tomorrow"><i class="fas fa-bell"></i> Vence Cuota Mañana</span>`;
    }

    const dniTermination = getDniTermination(client.dni);
    let dniHtml = '';
    if (client.dni) {
        dniHtml = `<span class="client-dni" title="DNI / Documento">
            <i class="fas fa-id-card"></i> DNI: ${escapeHtml(client.dni)} ${dniTermination !== null ? `<span class="dni-term">(Term. ${dniTermination})</span>` : ''}
        </span>`;
    }

    const branchNumStr = formatBranchNumber(client.branchNumber);
    const reqNumStr = formatRequestNumber(client.requestNumber);

    let branchBadgeHtml = branchNumStr ? `<span class="badge badge-branch" title="Número de sucursal"><i class="fas fa-store"></i> Suc. ${escapeHtml(branchNumStr)}</span>` : '';
    let reqBadgeHtml = reqNumStr ? `<span class="badge badge-request" title="Número de solicitud"><i class="fas fa-file-invoice"></i> Sol. N° ${escapeHtml(reqNumStr)}</span>` : '';

    let instText = client.totalInstallments ? `${client.installmentNumber || 1} de ${client.totalInstallments}` : `${client.installmentNumber || 1}`;
    let instBadgeHtml = `<span class="badge badge-installment" title="Número de cuota"><i class="fas fa-list-ol"></i> Cuota ${escapeHtml(instText)}</span>`;
    let monthLabel = formatMonthYear(client.periodMonth);
    let monthBadgeHtml = monthLabel ? `<span class="badge badge-period-month ${client.paymentStatus === 'overdue' ? 'overdue' : ''}" title="Mes del período"><i class="fas fa-calendar-alt"></i> Mes: ${escapeHtml(monthLabel)}</span>` : '';

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
                        ${branchBadgeHtml}
                        ${reqBadgeHtml}
                        ${instBadgeHtml}
                        ${monthBadgeHtml}
                        ${dniHtml}
                        ${todayBadgeHtml}
                        <span class="payment-day" title="Día de cobro de sueldo">
                            <i class="fas fa-wallet"></i> Sueldo: día ${client.salaryDay || '-'}
                        </span>
                        <span class="payment-day" title="Día de vencimiento de cuota">
                            <i class="fas fa-calendar-day"></i> Venc. Cuota: día ${client.paymentDay}
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
    els.branchNumber.value = '';
    els.requestNumber.value = '';
    els.installmentNumber.value = '1';
    els.totalInstallments.value = '12';
    els.penaltyRate.value = '1.0';
    els.periodMonth.value = getToday().substring(0, 7);
    els.clientDni.value = '';
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
    els.branchNumber.value = client.branchNumber || '';
    els.requestNumber.value = client.requestNumber || '';
    els.installmentNumber.value = client.installmentNumber || 1;
    els.totalInstallments.value = client.totalInstallments || 12;
    els.penaltyRate.value = client.penaltyRate !== undefined ? client.penaltyRate : 1.0;
    els.periodMonth.value = client.periodMonth || getToday().substring(0, 7);
    els.clientDni.value = client.dni || '';
    els.clientType.value = client.type;
    els.salaryDay.value = client.salaryDay || 10;
    els.paymentDay.value = client.paymentDay;
    els.loanAmount.value = client.loanAmount ? client.loanAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    els.installmentAmount.value = client.installmentAmount ? client.installmentAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
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
        branchNumber: formatBranchNumber(els.branchNumber.value),
        requestNumber: formatRequestNumber(els.requestNumber.value),
        installmentNumber: parseInt(els.installmentNumber.value) || 1,
        totalInstallments: parseInt(els.totalInstallments.value) || 12,
        penaltyRate: parseFloat(els.penaltyRate.value) >= 0 ? parseFloat(els.penaltyRate.value) : 1.0,
        periodMonth: els.periodMonth.value || getToday().substring(0, 7),
        dni: els.clientDni.value.trim(),
        type: els.clientType.value,
        salaryDay: parseInt(els.salaryDay.value) || 10,
        paymentDay: parseInt(els.paymentDay.value),
        loanAmount: parseCurrencyInput(els.loanAmount.value),
        installmentAmount: parseCurrencyInput(els.installmentAmount.value),
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

    const dniTermination = getDniTermination(client.dni);
    const dniText = client.dni ? ` • DNI: ${escapeHtml(client.dni)}${dniTermination !== null ? ` (Term. ${dniTermination})` : ''}` : '';
    const branchText = client.branchNumber ? ` • Suc. N° ${escapeHtml(client.branchNumber)}` : '';
    const reqText = client.requestNumber ? ` • Sol. N° ${escapeHtml(client.requestNumber)}` : '';
    const instText = client.totalInstallments ? `${client.installmentNumber || 1} de ${client.totalInstallments}` : `${client.installmentNumber || 1}`;

    els.paymentClientId.value = id;
    els.paymentClientPreview.innerHTML = `
        <div class="preview-name">${escapeHtml(client.name)}</div>
        <div class="preview-type">${TYPE_CONFIG[client.type].label}${branchText}${reqText}${dniText} • Cuota ${escapeHtml(instText)} • Sueldo: día ${client.salaryDay || '-'} • Vence: día ${client.paymentDay}</div>
        ${client.installmentAmount > 0 ? `<div style="font-size:0.8125rem;color:var(--primary);font-weight:700;margin-top:2px;">Valor Cuota: ${formatCurrency(client.installmentAmount)}</div>` : ''}
    `;

    els.paymentType.value = 'total';
    els.paidAmount.value = client.installmentAmount ? client.installmentAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    els.amountGiven.value = '';
    els.hasPaid.checked = client.paymentStatus === 'paid';
    els.isOverdue.checked = client.isOverdue;
    els.daysOverdue.value = client.daysOverdue || 1;
    els.paymentDate.value = client.lastPaymentDate || getToday();
    els.paymentPeriodMonth.value = client.periodMonth || getToday().substring(0, 7);
    els.paymentInstallmentNumber.value = instText;
    els.paymentNotes.value = '';

    updatePaymentCalculationBox(client);
    renderPaymentHistory(client);
    toggleOverdueFields();
    openModal(els.paymentModal);
}

function updatePaymentCalculationBox(client) {
    if (!els.paymentCalculationBox) return;

    const pType = els.paymentType.value;
    const toCharge = parseCurrencyInput(els.paidAmount.value) || client.installmentAmount || 0;
    const given = parseCurrencyInput(els.amountGiven.value);
    const isOverdueChecked = els.isOverdue ? els.isOverdue.checked : client.isOverdue;
    const daysOverdueVal = els.daysOverdue ? (parseInt(els.daysOverdue.value) || 0) : client.daysOverdue;

    const punitorios = isOverdueChecked && daysOverdueVal > 0 ? calculatePunitorios(toCharge, daysOverdueVal, client.penaltyRate) : 0;
    const totalWithPenalty = toCharge + punitorios;

    let html = `<div class="calc-row"><span>Subtotal Cuota:</span> <strong>${formatCurrency(toCharge)}</strong></div>`;

    if (punitorios > 0) {
        html += `<div class="calc-row penalty"><span>Punitorios por Mora (${client.daysOverdue} días, ${client.penaltyRate || 1.0}%/día):</span> <strong>+ ${formatCurrency(punitorios)}</strong></div>`;
        html += `<div class="calc-row total"><span>Total con Punitorios:</span> <strong>${formatCurrency(totalWithPenalty)}</strong></div>`;
    }

    if (pType === 'partial') {
        const remaining = totalWithPenalty - toCharge;
        html += `<div class="calc-row partial"><span>Pago Parcial - Saldo Pendiente:</span> <strong>${formatCurrency(remaining > 0 ? remaining : 0)}</strong></div>`;
    } else if (pType === 'advance') {
        html += `<div class="calc-row advance"><span>Adelanto de Cuota:</span> <strong>Se acredita para el período siguiente</strong></div>`;
    }

    if (given > 0) {
        const change = given - totalWithPenalty;
        if (change >= 0) {
            html += `<div class="calc-row change"><span>Vuelto a entregar al cliente:</span> <strong>${formatCurrency(change)}</strong></div>`;
        } else {
            html += `<div class="calc-row pending"><span>Falta para completar:</span> <strong>${formatCurrency(Math.abs(change))}</strong></div>`;
        }
    }

    els.paymentCalculationBox.innerHTML = html;
}

function renderPaymentHistory(client) {
    if (!client.payments || client.payments.length === 0) {
        els.paymentHistoryList.innerHTML = `<div class="no-history">No hay pagos registrados anteriormente.</div>`;
        return;
    }

    // Sort descending by date
    const sorted = [...client.payments].sort((a, b) => b.date.localeCompare(a.date));

    els.paymentHistoryList.innerHTML = sorted.map(p => {
        const mLabel = formatMonthYear(p.periodMonth);
        const instLabel = p.installmentNumber ? ` (Cuota ${escapeHtml(p.installmentNumber)})` : '';
        return `
            <div class="history-item">
                <div>
                    <span class="hist-date"><i class="fas fa-calendar"></i> ${formatDate(p.date)} - Período: ${escapeHtml(mLabel)}${instLabel}</span>
                    ${p.notes ? `<div class="hist-note">${escapeHtml(p.notes)}</div>` : ''}
                </div>
                <span class="hist-amount">${formatCurrency(p.amount)}</span>
            </div>
        `;
    }).join('');
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

    const pType = els.paymentType.value;
    const hasPaid = els.hasPaid.checked;
    const isOverdue = els.isOverdue.checked;
    const daysOverdue = parseInt(els.daysOverdue.value) || 0;
    const paymentDate = els.paymentDate.value || getToday();
    const paidAmountVal = parseCurrencyInput(els.paidAmount.value) || client.installmentAmount || 0;
    const amountGivenVal = parseCurrencyInput(els.amountGiven.value);
    const payPeriodMonth = els.paymentPeriodMonth.value || client.periodMonth || paymentDate.substring(0, 7);
    const payInstallmentNumber = els.paymentInstallmentNumber.value.trim() || `${client.installmentNumber || 1}`;
    const payNote = els.paymentNotes.value.trim();

    const punitorios = (isOverdue && daysOverdue > 0) ? calculatePunitorios(client.installmentAmount, daysOverdue, client.penaltyRate) : 0;

    let status = 'pending';
    if (hasPaid || pType === 'total' || pType === 'advance') {
        status = 'paid';
    } else if (pType === 'partial') {
        status = 'pending';
    } else if (isOverdue) {
        status = 'overdue';
    }

    client.paymentStatus = status;
    client.isOverdue = (status === 'overdue');
    client.daysOverdue = (status === 'overdue') ? daysOverdue : 0;

    if (payPeriodMonth) client.periodMonth = payPeriodMonth;

    // Advance installment count if total or advance paid
    if ((hasPaid || pType === 'total' || pType === 'advance') && typeof client.installmentNumber === 'number') {
        if (!client.totalInstallments || client.installmentNumber < client.totalInstallments) {
            client.installmentNumber += 1;
        }
    }

    if (hasPaid || paidAmountVal > 0) {
        client.lastPaymentDate = paymentDate;

        const typeLabels = { total: 'Pago Total', partial: 'Pago Parcial', advance: 'Adelanto de Cuota' };
        let noteDetails = `[${typeLabels[pType] || 'Pago'}]`;
        if (punitorios > 0) noteDetails += ` (Incluye Punitorios: ${formatCurrency(punitorios)})`;
        if (amountGivenVal > 0) noteDetails += ` (Entregó: ${formatCurrency(amountGivenVal)})`;
        if (payNote) noteDetails += ` - ${payNote}`;

        const newPayment = {
            id: generateId(),
            amount: paidAmountVal,
            amountGiven: amountGivenVal,
            punitorios: punitorios,
            paymentType: pType,
            date: paymentDate,
            periodMonth: payPeriodMonth,
            installmentNumber: payInstallmentNumber,
            notes: noteDetails
        };
        if (!client.payments) client.payments = [];
        client.payments.push(newPayment);
    }

    updateOverdueStatuses();
    saveClients();
    renderClients();

    const msg = (hasPaid || pType === 'total' || pType === 'advance') ? 'Pago registrado correctamente' : 'Estado de pago actualizado';
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

    if (els.monthFilterSelect) {
        els.monthFilterSelect.addEventListener('change', (e) => {
            currentMonthFilter = e.target.value;
            displayLimit = 20;
            renderClients();
        });
    }
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

    // Summary modal listeners
    if (els.summaryBtn) {
        els.summaryBtn.addEventListener('click', openSummaryModal);
    }
    if (els.closeSummaryModal) {
        els.closeSummaryModal.addEventListener('click', () => closeModalFn(els.summaryModal));
    }
    if (els.closeSummaryBtn) {
        els.closeSummaryBtn.addEventListener('click', () => closeModalFn(els.summaryModal));
    }
    if (els.copySummaryBtn) {
        els.copySummaryBtn.addEventListener('click', copySummaryToClipboard);
    }

    els.paymentForm.addEventListener('submit', handleSavePayment);
    els.isOverdue.addEventListener('change', () => {
        toggleOverdueFields();
        const client = clients.find(c => c.id === els.paymentClientId.value);
        if (client) updatePaymentCalculationBox(client);
    });

    ['paymentType', 'paidAmount', 'amountGiven', 'daysOverdue'].forEach(id => {
        const input = els[id];
        if (input) {
            input.addEventListener('input', () => {
                const client = clients.find(c => c.id === els.paymentClientId.value);
                if (client) updatePaymentCalculationBox(client);
            });
            input.addEventListener('change', () => {
                const client = clients.find(c => c.id === els.paymentClientId.value);
                if (client) updatePaymentCalculationBox(client);
            });
        }
    });

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
// SUMMARY VIEW
// ========================================

function openSummaryModal() {
    renderSummaryView();
    openModal(els.summaryModal);
}

function renderSummaryView() {
    if (!els.summaryBody) return;

    if (clients.length === 0) {
        els.summaryBody.innerHTML = `
            <div class="empty-state show">
                <i class="fas fa-users-slash"></i>
                <h3>No hay clientes registrados</h3>
            </div>
        `;
        return;
    }

    const { groups, order } = groupClients(clients);

    let html = `<div class="summary-total-banner">
        <span>Total de Clientes: <strong>${clients.length}</strong></span>
    </div>`;

    order.forEach(type => {
        const config = TYPE_CONFIG[type];
        const groupClientsList = groups[type] || [];

        html += `
            <div class="summary-group group-${type}">
                <div class="summary-group-header">
                    <span class="group-title"><i class="fas ${config.icon}"></i> ${config.label}s</span>
                    <span class="group-count">${groupClientsList.length}</span>
                </div>
                <ol class="summary-list">
                    ${groupClientsList.map((client) => {
                        const status = STATUS_CONFIG[client.paymentStatus];
                        const dniText = client.dni ? ` (DNI: ${escapeHtml(client.dni)})` : '';
                        const branchText = client.branchNumber ? ` [Suc. N° ${escapeHtml(client.branchNumber)}]` : '';
                        const reqText = client.requestNumber ? ` [Sol. N° ${escapeHtml(client.requestNumber)}]` : '';
                        const instText = client.totalInstallments ? `${client.installmentNumber || 1}/${client.totalInstallments}` : `${client.installmentNumber || 1}`;
                        const instNumText = ` [Cuota ${escapeHtml(instText)}]`;
                        const monthText = client.periodMonth ? ` [Mes: ${escapeHtml(formatMonthYear(client.periodMonth))}]` : '';
                        const installmentText = client.installmentAmount > 0 ? ` - Monto: ${formatCurrency(client.installmentAmount)}` : '';
                        return `
                            <li class="summary-item">
                                <div class="summary-item-content">
                                    <span class="summary-item-name">${escapeHtml(client.name)}</span>${escapeHtml(branchText)}${escapeHtml(reqText)}${escapeHtml(instNumText)}${escapeHtml(monthText)}${escapeHtml(dniText)}${escapeHtml(installmentText)}
                                </div>
                                <span class="summary-status-badge status-${client.paymentStatus}">${status.label}</span>
                            </li>
                        `;
                    }).join('')}
                </ol>
            </div>
        `;
    });

    els.summaryBody.innerHTML = html;
}

function copySummaryToClipboard() {
    if (clients.length === 0) {
        showToast('No hay clientes para copiar', 'error');
        return;
    }

    const { groups, order } = groupClients(clients);
    let text = `RESUMEN GENERAL DE CLIENTES (${clients.length})\n\n`;

    order.forEach(type => {
        const config = TYPE_CONFIG[type];
        const list = groups[type] || [];
        text += `${config.label}s (${list.length}):\n`;
        list.forEach((client, index) => {
            const dniText = client.dni ? ` - DNI: ${client.dni}` : '';
            const branchText = client.branchNumber ? ` - Suc. N°: ${client.branchNumber}` : '';
            const reqText = client.requestNumber ? ` - Sol. N°: ${client.requestNumber}` : '';
            const instText = client.totalInstallments ? `${client.installmentNumber || 1}/${client.totalInstallments}` : `${client.installmentNumber || 1}`;
            const instNumText = ` - Cuota N°: ${instText}`;
            const monthText = client.periodMonth ? ` - Mes: ${formatMonthYear(client.periodMonth)}` : '';
            const statusLabel = STATUS_CONFIG[client.paymentStatus] ? STATUS_CONFIG[client.paymentStatus].label : '';
            const installmentText = client.installmentAmount > 0 ? ` - Monto: ${formatCurrency(client.installmentAmount)}` : '';
            text += `${index + 1}. ${client.name}${branchText}${reqText}${instNumText}${monthText}${dniText}${installmentText} [${statusLabel}]\n`;
        });
        text += '\n';
    });

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text.trim()).then(() => {
            showToast('Resumen copiado al portapapeles', 'success');
        }).catch(() => {
            fallbackCopyText(text.trim());
        });
    } else {
        fallbackCopyText(text.trim());
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('Resumen copiado al portapapeles', 'success');
    } catch (err) {
        showToast('No se pudo copiar el resumen', 'error');
    }
    document.body.removeChild(textArea);
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
