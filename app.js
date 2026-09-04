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
    partial: { label: 'Pago Parcial', class: 'partial', dotClass: 'partial' },
    pending: { label: 'Pendiente', class: 'pending', dotClass: 'pending' },
    overdue: { label: 'Atrasado', class: 'overdue', dotClass: 'overdue' }
};

let clients = [];
let currentFilter = 'all';
let currentStatusFilter = 'active';
let currentMonthFilter = 'all';
let currentSortBy = 'status-asc';
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

    // Ensure schema migration for existing records and remove duplicates
    clients.forEach(c => sanitizeClientSchema(c));
    deduplicateClients();

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

function getCurrentTime() {
    const d = new Date();
    const hrs = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
}

function generateReceiptNumber() {
    let maxNum = 100;
    if (Array.isArray(clients)) {
        clients.forEach(c => {
            if (Array.isArray(c.payments)) {
                c.payments.forEach(p => {
                    if (p.receiptNumber) {
                        const num = parseInt(p.receiptNumber.replace(/\D/g, ''), 10);
                        if (!isNaN(num) && num > maxNum) {
                            maxNum = num;
                        }
                    }
                });
            }
        });
    }
    const nextNum = maxNum + 1;
    return String(nextNum).padStart(8, '0');
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

    if (client.installmentNumber > client.totalInstallments) {
        const minicuotaParsed = parseMinicuota(`${client.installmentNumber}/${client.totalInstallments}`);
        client.installmentNumber = minicuotaParsed.currentInstallment;
        client.totalInstallments = minicuotaParsed.totalInstallments;
    }
    if (client.penaltyRate === undefined || client.penaltyRate === null) client.penaltyRate = 1.0; // 1% per day default
    if (!client.periodMonth) client.periodMonth = getToday().substring(0, 7);

    if (!client.domicilio) client.domicilio = '';
    if (!client.localidad) client.localidad = '';
    if (!client.cpos) client.cpos = '';
    if (!client.zona) client.zona = '';
    if (!client.garante) client.garante = '';
    if (!client.apellido) client.apellido = '';
    if (!client.apenom) client.apenom = '';
    if (!client.phone) client.phone = client.celular || '';
    if (!client.celular) client.celular = client.phone || '';

    if (!Array.isArray(client.gestiones)) client.gestiones = [];
    if (!Array.isArray(client.promises)) client.promises = [];
    if (!Array.isArray(client.payments)) client.payments = [];

    // Sanitize payments
    client.payments.forEach((p) => {
        if (!p.id) p.id = generateId();
        if (!p.receiptNumber) {
            p.receiptNumber = generateReceiptNumber();
        }
        if (typeof p.amount !== 'number') p.amount = parseCurrencyInput(p.amount);
        if (typeof p.installmentAmount !== 'number') p.installmentAmount = p.amount || client.installmentAmount || 0;
        if (typeof p.amountGiven !== 'number') p.amountGiven = p.amount || 0;
        if (typeof p.punitorios !== 'number') p.punitorios = 0;
        if (typeof p.punitoriosWaived !== 'number') p.punitoriosWaived = 0;
        if (typeof p.totalTheoretical !== 'number') {
            p.totalTheoretical = (p.installmentAmount || 0) + (p.punitorios || 0) - (p.punitoriosWaived || 0);
        }
        if (!p.paymentType) p.paymentType = 'total';
        if (!p.paymentMethod) p.paymentMethod = 'Efectivo';
        if (!p.date) p.date = getToday();
        if (!p.time) p.time = '12:00';
        if (!p.periodMonth) p.periodMonth = client.periodMonth || getToday().substring(0, 7);
        if (!p.installmentNumber) p.installmentNumber = `${client.installmentNumber || 1}`;
        if (typeof p.daysOverdue !== 'number') p.daysOverdue = 0;
        if (!p.notes) p.notes = '';
        if (!p.user) p.user = 'Cobrador';
        if (typeof p.exported !== 'boolean') p.exported = false;
        if (p.exportedAt === undefined) p.exportedAt = null;
        if (p.promiseId === undefined) p.promiseId = null;
        if (p.gestionId === undefined) p.gestionId = null;
    });

    // Sanitize gestiones
    client.gestiones.forEach(g => {
        if (!g.id) g.id = generateId();
        if (!g.date) g.date = getToday();
        if (!g.time) g.time = getCurrentTime();
        if (!g.type) g.type = 'Llamada telefónica';
        if (!g.result) g.result = 'Contactado';
        if (!g.observations) g.observations = '';
        if (!g.nextAction) g.nextAction = '';
        if (g.nextFollowUpDate === undefined) g.nextFollowUpDate = '';
        if (g.promiseId === undefined) g.promiseId = null;
        if (!g.createdAt) g.createdAt = new Date().toISOString();
    });

    // Sanitize promises
    client.promises.forEach(pr => {
        if (!pr.id) pr.id = generateId();
        if (!pr.periodMonth) pr.periodMonth = client.periodMonth || getToday().substring(0, 7);
        if (!pr.installmentNumber) pr.installmentNumber = `${client.installmentNumber || 1}`;
        if (!pr.creationDate) pr.creationDate = getToday();
        if (!pr.promisedDate) pr.promisedDate = getToday();
        if (typeof pr.promisedAmount !== 'number') pr.promisedAmount = parseCurrencyInput(pr.promisedAmount);
        if (!pr.paymentMethod) pr.paymentMethod = 'Sucursal';
        if (!pr.observations) pr.observations = '';
        if (!pr.status) pr.status = 'pendiente';
        if (pr.gestionId === undefined) pr.gestionId = null;
        if (pr.paymentId === undefined) pr.paymentId = null;
        if (!pr.createdAt) pr.createdAt = new Date().toISOString();
    });
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

function getNextPeriodMonth(periodMonthStr) {
    if (!periodMonthStr || typeof periodMonthStr !== 'string' || !periodMonthStr.includes('-')) {
        return periodMonthStr;
    }
    const [yearStr, monthStr] = periodMonthStr.split('-');
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);
    month += 1;
    if (month > 12) {
        month = 1;
        year += 1;
    }
    return `${year}-${String(month).padStart(2, '0')}`;
}

function calcularDiasVencidoDesdePeriodo(periodMonthStr, paymentDay, todayDate) {
    const [yearStr, monthStr] = periodMonthStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const dueDate = new Date(year, month - 1, paymentDay || 1);
    const todayMidnight = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate());
    const diffMs = todayMidnight - dueDate;
    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
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
    if (!numStr) return '';
    const trimmed = numStr.toString().trim().replace(/\D/g, '');
    if (!trimmed) return '';
    return trimmed.length === 1 ? '0' + trimmed : trimmed;
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
        if (client.paymentStatus === 'partial') return; // no tocar pagos parciales

        const clientPeriod = client.periodMonth || currentMonthStr;

        // Préstamo saldado por completo (última cuota ya pagada): nunca vuelve a vencer
        const isLoanCompleted = client.paymentStatus === 'paid'
            && client.totalInstallments
            && client.installmentNumber >= client.totalInstallments;
        if (isLoanCompleted) {
            client.isOverdue = false;
            client.daysOverdue = 0;
            return;
        }

        if (clientPeriod > currentMonthStr) {
            // Ya pagó y quedó con el período adelantado: todavía no corresponde cobrarle
            client.paymentStatus = 'pending';
            client.isOverdue = false;
            client.daysOverdue = 0;
            return;
        }

        if (clientPeriod < currentMonthStr) {
            // Quedó atrás uno o más meses sin pagar
            client.paymentStatus = 'overdue';
            client.isOverdue = true;
            client.daysOverdue = calcularDiasVencidoDesdePeriodo(clientPeriod, client.paymentDay, today);
            return;
        }

        // Período actual: misma lógica de día que ya existía antes
        if (currentDay > client.paymentDay) {
            client.paymentStatus = 'overdue';
            client.isOverdue = true;
            client.daysOverdue = currentDay - client.paymentDay;
        } else {
            client.paymentStatus = 'pending';
            client.isOverdue = false;
            client.daysOverdue = 0;
        }
    });

    updatePromisesStatuses();
}

function updatePromisesStatuses() {
    const todayStr = getToday();
    clients.forEach(client => {
        if (!Array.isArray(client.promises)) return;
        client.promises.forEach(pr => {
            if (pr.status === 'pendiente' && pr.promisedDate < todayStr) {
                pr.status = 'vencida';
            }
        });
    });
}

function updateDailyDashboard() {
    const todayStr = getToday();
    const todayDay = new Date().getDate();

    const currentDashboardDateEl = document.getElementById('currentDashboardDate');
    if (currentDashboardDateEl) {
        currentDashboardDateEl.textContent = formatDate(todayStr);
    }

    const portfolioPeriodLabel = document.getElementById('portfolioPeriodLabel');
    if (portfolioPeriodLabel) {
        portfolioPeriodLabel.textContent = currentMonthFilter === 'all' ? 'TODOS LOS MESES' : formatMonthYear(currentMonthFilter).toUpperCase();
    }

    // Filter portfolio for stats based on currentMonthFilter
    let targetClients = clients;
    if (currentMonthFilter !== 'all') {
        targetClients = clients.filter(c => c.periodMonth === currentMonthFilter);
    }

    let monthTotalAmount = 0;
    let monthCollectedAmount = 0;
    let monthPendingAmount = 0;
    let monthTotalCount = targetClients.length;
    let monthPaidCount = 0;
    let monthPendingCount = 0;
    let monthPartialCount = 0;
    let unmanagedCount = 0;
    let followUpTodayCount = 0;

    let todayDueCount = 0;
    let todayDueAmount = 0;
    let promisesTodayCount = 0;
    let promisesTodayAmount = 0;
    let promisesOverdueCount = 0;
    let promisesPendingCount = 0;
    let promisesFulfilledCount = 0;
    let promisesFulfilledAmount = 0;
    let promisesBrokenCount = 0;
    let paymentsTodayCount = 0;
    let paymentsTodayAmount = 0;

    targetClients.forEach(client => {
        const instVal = client.installmentAmount || 0;
        monthTotalAmount += instVal;

        // Calculate paid vs pending for this client/installment
        let totalPaidForCuota = 0;
        if (Array.isArray(client.payments)) {
            client.payments.forEach(p => {
                totalPaidForCuota += (p.amount || 0);
                if (p.date === todayStr) {
                    paymentsTodayCount++;
                    paymentsTodayAmount += (p.amount || 0);
                }
            });
        }

        if (client.paymentStatus === 'paid') {
            monthPaidCount++;
            monthCollectedAmount += instVal;
        } else if (client.paymentStatus === 'partial') {
            monthPartialCount++;
            monthCollectedAmount += totalPaidForCuota;
            monthPendingAmount += Math.max(0, instVal - totalPaidForCuota);
        } else {
            monthPendingCount++;
            monthPendingAmount += instVal;
        }

        // Unmanaged check
        if (!Array.isArray(client.gestiones) || client.gestiones.length === 0) {
            unmanagedCount++;
        }

        // Follow up today check
        if (Array.isArray(client.gestiones)) {
            const hasTodayFollowUp = client.gestiones.some(g => g.nextFollowUpDate === todayStr);
            if (hasTodayFollowUp) followUpTodayCount++;
        }

        // Due today
        if (client.paymentDay === todayDay && client.paymentStatus !== 'paid') {
            todayDueCount++;
            todayDueAmount += Math.max(0, instVal - totalPaidForCuota);
        }

        // Promises
        if (Array.isArray(client.promises)) {
            client.promises.forEach(pr => {
                if (pr.promisedDate === todayStr && pr.status === 'pendiente') {
                    promisesTodayCount++;
                    promisesTodayAmount += (pr.promisedAmount || 0);
                }
                if (pr.status === 'vencida' || pr.status === 'incumplida' || (pr.promisedDate < todayStr && pr.status === 'pendiente')) {
                    promisesOverdueCount++;
                    promisesBrokenCount++;
                } else if (pr.status === 'pendiente' && pr.promisedDate > todayStr) {
                    promisesPendingCount++;
                } else if (pr.status === 'cumplida') {
                    promisesFulfilledCount++;
                    promisesFulfilledAmount += (pr.promisedAmount || 0);
                }
            });
        }
    });

    const recoveryRate = monthTotalAmount > 0 ? ((monthCollectedAmount / monthTotalAmount) * 100).toFixed(1) : '0,0';
    const totalPromisesEvaluated = promisesFulfilledCount + promisesBrokenCount;
    const promiseEffectiveness = totalPromisesEvaluated > 0 ? ((promisesFulfilledCount / totalPromisesEvaluated) * 100).toFixed(1) : '0,0';

    // Update DOM
    const setTxt = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    setTxt('dashMonthTotalAmount', formatCurrency(monthTotalAmount));
    setTxt('dashMonthTotalClientsCount', `${monthTotalCount} cuotas`);
    setTxt('dashMonthCollectedAmount', formatCurrency(monthCollectedAmount));
    setTxt('dashMonthPaidCount', `${monthPaidCount} pagados`);
    setTxt('dashMonthPendingAmount', formatCurrency(monthPendingAmount));
    setTxt('dashMonthPendingCount', `${monthPendingCount} pendientes`);
    setTxt('dashMonthRecoveryRate', `${recoveryRate.replace('.', ',')}%`);
    setTxt('dashMonthPartialCount', `${monthPartialCount} pagos parciales`);

    setTxt('dashUnmanagedCount', unmanagedCount);
    setTxt('dashFollowUpTodayCount', followUpTodayCount);
    setTxt('dashTodayDueCount', todayDueCount);
    setTxt('dashTodayDueAmount', formatCurrency(todayDueAmount));
    setTxt('dashPromisesTodayCount', promisesTodayCount);
    setTxt('dashPromisesTodayAmount', formatCurrency(promisesTodayAmount));
    setTxt('dashPromisesOverdueCount', promisesOverdueCount);
    setTxt('dashPromisesBrokenCount', promisesOverdueCount);
    setTxt('dashPromisesPendingCount', promisesPendingCount);
    setTxt('dashPromisesFulfilledCount', promisesFulfilledCount);
    setTxt('dashPromisesFulfilledAmount', formatCurrency(promisesFulfilledAmount));
    setTxt('dashPaymentsTodayCount', paymentsTodayCount);
    setTxt('dashPaymentsTodayAmount', formatCurrency(paymentsTodayAmount));
    setTxt('dashPromiseEffectiveness', `${promiseEffectiveness.replace('.', ',')}%`);
    setTxt('dashPromiseEffectivenessSub', `${promisesFulfilledCount} de ${totalPromisesEvaluated} cumplidas`);
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
    clientDomicilio: document.getElementById('clientDomicilio'),
    clientLocalidad: document.getElementById('clientLocalidad'),
    clientZona: document.getElementById('clientZona'),
    clientCpos: document.getElementById('clientCpos'),
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
    if (!modal) return;
    const currentlyOpen = document.querySelectorAll('.modal.open');
    const baseZIndex = 1000;
    const stackIndex = currentlyOpen.length;
    if (modal.style) {
        modal.style.zIndex = baseZIndex + (stackIndex * 20);
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModalFn(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    if (modal.style) {
        modal.style.zIndex = '';
    }
    const remainingOpen = document.querySelectorAll('.modal.open');
    if (remainingOpen.length === 0) {
        document.body.style.overflow = '';
    }
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function buildWhatsAppLink(client, message = '') {
    if (!client) return '#';
    const rawPhone = client.phone || client.celular || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    if (!cleanPhone) return '#';
    const msg = message || `Hola ${client.name}, me comunico de Palmares Efectivo en el Acto por tu cuota de ${formatMonthYear(client.periodMonth)}`;
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
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

function getClientUniqueKey(c) {
    if (!c) return '';
    const dni = (c.dni || '').toString().trim().replace(/\D/g, '');
    const branch = formatBranchNumber(c.branchNumber);
    const req = formatRequestNumber(c.requestNumber);
    const period = (c.periodMonth || getToday().substring(0, 7)).trim();

    if (dni || branch || req) {
        return `${dni}_${branch}_${req}_${period}`;
    }
    // Fallback if DNI/request numbers are absent
    const cleanName = (c.name || '').toLowerCase().trim().replace(/\s+/g, '_');
    return `${cleanName}_${period}`;
}

function deduplicateClients() {
    if (!Array.isArray(clients) || clients.length <= 1) return;

    const map = new Map();
    const uniqueClients = [];

    clients.forEach(c => {
        sanitizeClientSchema(c);
        const key = getClientUniqueKey(c);
        if (!key) {
            uniqueClients.push(c);
            return;
        }

        if (!map.has(key)) {
            map.set(key, c);
            uniqueClients.push(c);
        } else {
            const existing = map.get(key);

            // Merge gestiones, promises, payments
            if (Array.isArray(c.gestiones)) {
                c.gestiones.forEach(g => {
                    if (!existing.gestiones.some(eg => eg.id === g.id)) {
                        existing.gestiones.push(g);
                    }
                });
            }

            if (Array.isArray(c.promises)) {
                c.promises.forEach(pr => {
                    if (!existing.promises.some(epr => epr.id === pr.id)) {
                        existing.promises.push(pr);
                    }
                });
            }

            if (Array.isArray(c.payments)) {
                c.payments.forEach(p => {
                    if (!existing.payments.some(ep => ep.id === p.id)) {
                        existing.payments.push(p);
                    }
                });
            }

            // Prefer valid and latest cuota number (installmentNumber <= totalInstallments)
            if (c.totalInstallments) existing.totalInstallments = c.totalInstallments;
            if (typeof c.installmentNumber === 'number' && c.installmentNumber <= c.totalInstallments) {
                if (existing.installmentNumber > existing.totalInstallments || c.installmentNumber >= existing.installmentNumber) {
                    existing.installmentNumber = c.installmentNumber;
                }
            }

            // Update fields if existing has empty/missing ones
            if (!existing.phone && c.phone) existing.phone = c.phone;
            if (!existing.celular && c.celular) existing.celular = c.celular;
            if (!existing.domicilio && c.domicilio) existing.domicilio = c.domicilio;
            if (!existing.localidad && c.localidad) existing.localidad = c.localidad;
            if (!existing.zona && c.zona) existing.zona = c.zona;
            if (!existing.cpos && c.cpos) existing.cpos = c.cpos;
            if (!existing.garante && c.garante) existing.garante = c.garante;
        }
    });

    clients = uniqueClients;
}

function parseMinicuota(value) {
    if (value === null || value === undefined) {
        return { currentInstallment: 1, totalInstallments: 12 };
    }

    let curr = 1;
    let tot = 12;

    // Handle JS Date objects (SheetJS with cellDates: true can convert "7/9" to Date)
    if (value instanceof Date && !isNaN(value.getTime())) {
        const day = value.getDate();
        const month = value.getMonth() + 1;
        if (day <= month) {
            curr = day;
            tot = month;
        } else {
            curr = month;
            tot = day;
        }
        return { currentInstallment: curr, totalInstallments: tot };
    }

    const valStr = value.toString().trim();
    if (!valStr) {
        return { currentInstallment: 1, totalInstallments: 12 };
    }

    // Standardize separators ("7 de 9", "7-9", "7 / 9")
    const cleaned = valStr.replace(/\s+de\s+/gi, '/').replace(/-/g, '/');

    if (cleaned.includes('/')) {
        const parts = cleaned.split('/').map(p => p.trim());
        curr = parseInt(parts[0].replace(/\D/g, ''), 10);
        tot = parseInt(parts[1].replace(/\D/g, ''), 10);
        if (isNaN(tot) || tot <= 0) tot = 12;

        if (!isNaN(curr) && curr > tot) {
            const currStr = parts[0].replace(/\D/g, '');
            if (currStr.length >= 2) {
                const firstDigit = parseInt(currStr.slice(0, 1), 10);
                const restDigits = parseInt(currStr.slice(1), 10);
                if (!isNaN(firstDigit) && !isNaN(restDigits) && firstDigit <= restDigits) {
                    curr = firstDigit;
                    tot = restDigits;
                } else if (!isNaN(firstDigit) && firstDigit <= tot) {
                    curr = firstDigit;
                }
            }
        }
    } else {
        const num = parseInt(cleaned.replace(/\D/g, ''), 10);
        curr = isNaN(num) || num <= 0 ? 1 : num;
        tot = 12;
    }

    if (isNaN(curr) || curr <= 0) curr = 1;
    if (isNaN(tot) || tot <= 0) tot = 12;

    if (curr > tot) {
        curr = tot;
    }

    return {
        currentInstallment: curr,
        totalInstallments: tot
    };
}

function getRowValue(row, keywords) {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);
    for (const kw of keywords) {
        const matchKey = keys.find(k => k.toLowerCase().trim() === kw.toLowerCase().trim());
        if (matchKey && row[matchKey] !== undefined && row[matchKey] !== null) {
            return row[matchKey].toString().trim();
        }
    }
    for (const kw of keywords) {
        const matchKey = keys.find(k => k.toLowerCase().trim().includes(kw.toLowerCase().trim()));
        if (matchKey && row[matchKey] !== undefined && row[matchKey] !== null) {
            return row[matchKey].toString().trim();
        }
    }
    return '';
}

function parseOfficialSpreadsheetRows(rowsData) {
    const parsedClients = [];
    const errors = [];
    const recognizedColsSet = new Set();
    const ignoredColsSet = new Set();

    const OFFICIAL_MAPPED_KEYS = [
        'sucursal', 'solicitud', 'apellido', 'apenom', 'segmento',
        'domicilio', 'teléfono', 'telefono', 'celular', 'zona', 'localidad',
        'cpos', 'vencido', 'punitorios', 'vence', 'minicuota', 'mini cuota',
        'mini_cuota', 'cuota', 'nro cuota', 'cuota actual', 'día pago',
        'dia pago', 'nro documento', 'garante'
    ];

    if (rowsData.length > 0) {
        const sampleKeys = Object.keys(rowsData[0]);
        sampleKeys.forEach(key => {
            const cleanK = key.toLowerCase().trim();
            if (OFFICIAL_MAPPED_KEYS.some(k => cleanK.includes(k))) {
                recognizedColsSet.add(key);
            } else {
                ignoredColsSet.add(key);
            }
        });
    }

    rowsData.forEach((row, idx) => {
        const rowNum = idx + 2;

        const sucursal = formatBranchNumber(getRowValue(row, ['sucursal', 'suc']));
        const solicitud = formatRequestNumber(getRowValue(row, ['solicitud', 'operacion', 'operación', 'nro solicitud']));
        const apellido = getRowValue(row, ['apellido']);
        const apenom = getRowValue(row, ['apenom', 'nombre', 'cliente']);
        const segmento = getRowValue(row, ['segmento', 'tipo', 'categoria']);
        const domicilio = getRowValue(row, ['domicilio', 'direccion', 'dirección']);
        const telefono = getRowValue(row, ['teléfono', 'telefono', 'tel']);
        const celular = getRowValue(row, ['celular', 'cel']);
        const zona = getRowValue(row, ['zona']);
        const localidad = getRowValue(row, ['localidad', 'ciudad']);
        const cpos = getRowValue(row, ['cpos', 'cpo', 'cp', 'código postal', 'codigo postal']);
        const vencidoRaw = getRowValue(row, ['vencido', 'monto cuota', 'monto_cuota', 'monto', 'importe']);
        const punitoriosRaw = getRowValue(row, ['punitorios', 'punitorio']);
        const venceRaw = getRowValue(row, ['vence', 'vencimiento', 'fecha vence']);
        const minicuotaRaw = getRowValue(row, ['minicuota', 'mini cuota', 'mini_cuota', 'cuota', 'nro cuota', 'cuota actual']);
        const diaPagoRaw = getRowValue(row, ['día pago', 'dia pago', 'dia_pago', 'día_pago', 'sueldo']);
        const dniRaw = getRowValue(row, ['nro documento', 'nro_documento', 'documento', 'dni']);
        const garante = getRowValue(row, ['garante']);

        if (!dniRaw && !solicitud && !apenom && !apellido) {
            errors.push(`Fila ${rowNum}: Falta DNI, N.º de solicitud y nombre.`);
            return;
        }

        const dni = dniRaw.replace(/\D/g, '');
        const { currentInstallment, totalInstallments } = parseMinicuota(minicuotaRaw);

        let name = '';
        if (apellido && apenom) {
            if (apenom.toUpperCase().includes(apellido.toUpperCase())) {
                name = apenom;
            } else {
                name = `${apellido} ${apenom}`;
            }
        } else {
            name = apenom || apellido || `Cliente DNI ${dni}`;
        }

        let type = 'privado';
        const segLower = (segmento || '').toLowerCase();
        if (segLower.includes('jubilad')) type = 'jubilado';
        else if (segLower.includes('docent')) type = 'docente';
        else if (segLower.includes('polic')) type = 'policia';
        else if (segLower.includes('municip')) type = 'municipal';
        else if (segLower.includes('provin')) type = 'provincial';

        let salaryDay = parseInt(diaPagoRaw, 10);
        if (isNaN(salaryDay) || salaryDay < 1 || salaryDay > 31) salaryDay = 10;

        let paymentDay = salaryDay;
        if (venceRaw) {
            const dayMatch = venceRaw.match(/\b([0-2]?[0-9]|3[01])\b/);
            if (dayMatch) {
                const d = parseInt(dayMatch[1], 10);
                if (d >= 1 && d <= 31) paymentDay = d;
            }
        }

        const installmentAmount = parseCurrencyInput(vencidoRaw);
        const punitorios = parseCurrencyInput(punitoriosRaw);

        const newC = {
            id: generateId(),
            name: name,
            apellido: apellido,
            apenom: apenom,
            dni: dni,
            branchNumber: sucursal,
            requestNumber: solicitud,
            installmentNumber: currentInstallment,
            totalInstallments: totalInstallments,
            periodMonth: getToday().substring(0, 7),
            segmento: segmento,
            type: type,
            domicilio: domicilio,
            localidad: localidad,
            cpos: cpos,
            zona: zona,
            phone: telefono || celular,
            celular: celular || telefono,
            garante: garante,
            salaryDay: salaryDay,
            paymentDay: paymentDay,
            installmentAmount: installmentAmount,
            punitorios: punitorios,
            vence: venceRaw,
            loanAmount: 0,
            notes: '',
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            gestiones: [],
            promises: [],
            payments: []
        };

        sanitizeClientSchema(newC);
        parsedClients.push(newC);
    });

    return {
        parsedClients,
        totalRecords: rowsData.length,
        recognizedCols: Array.from(recognizedColsSet),
        importedCols: [
            'Sucursal (sucursal)',
            'N.º Solicitud (solicitud)',
            'Apellido y Nombre (apellido / apenom)',
            'Segmento (segmento)',
            'Dirección (domicilio)',
            'Teléfono / Celular (teléfono / celular)',
            'Zona (zona)',
            'Localidad (localidad)',
            'Código Postal (CPOs)',
            'Importe Vencido (vencido)',
            'Punitorios (punitorios)',
            'Fecha Vencimiento (vence)',
            'Cuota Actual y Totales (minicuota p.ej. 7/9)',
            'Día de Pago (día pago)',
            'DNI / Documento (nro documento)',
            'Garante (garante)'
        ],
        ignoredCols: Array.from(ignoredColsSet),
        errors
    };
}

function parseCSVToClients(csvText) {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return [];

    const delimiter = lines[0].includes(';') ? ';' : ',';
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

    const findIndex = (keywords) => {
        return headers.findIndex(h => keywords.some(k => h.includes(k)));
    };

    const idxName = findIndex(['nombre', 'cliente']);
    const idxDni = findIndex(['dni', 'documento']);
    const idxBranch = findIndex(['sucursal', 'suc']);
    const idxRequest = findIndex(['solicitud', 'operacion', 'operación']);
    const idxInst = findIndex(['cuota', 'n_cuota', 'numero_cuota']);
    const idxTotalInst = findIndex(['total_cuotas', 'cuotas_totales']);
    const idxPeriod = findIndex(['periodo', 'período', 'mes']);
    const idxType = findIndex(['tipo', 'categoria']);
    const idxSalaryDay = findIndex(['sueldo', 'dia_sueldo']);
    const idxPaymentDay = findIndex(['vencimiento', 'venc', 'dia_pago']);
    const idxLoanAmount = findIndex(['prestamo', 'préstamo', 'monto_prestamo']);
    const idxInstAmount = findIndex(['monto', 'monto_cuota', 'importe']);
    const idxPhone = findIndex(['telefono', 'teléfono', 'celular', 'phone']);
    const idxEmail = findIndex(['email', 'mail']);
    const idxDomicilio = findIndex(['domicilio', 'direccion', 'dirección']);
    const idxLocalidad = findIndex(['localidad', 'ciudad']);
    const idxZona = findIndex(['zona']);
    const idxCpos = findIndex(['cpos', 'cpo', 'cp', 'codigo_postal', 'código_postal']);
    const idxNotes = findIndex(['notas', 'observaciones']);

    const parsedClients = [];

    for (let i = 1; i < lines.length; i++) {
        const rawRow = lines[i];
        if (!rawRow.trim()) continue;

        // Smart split taking quotes into account
        const values = [];
        let insideQuotes = false;
        let currentVal = '';
        for (let ch of rawRow) {
            if (ch === '"') {
                insideQuotes = !insideQuotes;
            } else if (ch === delimiter && !insideQuotes) {
                values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
                currentVal = '';
            } else {
                currentVal += ch;
            }
        }
        values.push(currentVal.trim().replace(/^["']|["']$/g, ''));

        const getVal = (idx) => (idx !== -1 && values[idx] !== undefined) ? values[idx] : '';

        const name = getVal(idxName);
        if (!name) continue;

        const newC = {
            id: generateId(),
            name: name,
            dni: getVal(idxDni),
            branchNumber: formatBranchNumber(getVal(idxBranch)),
            requestNumber: formatRequestNumber(getVal(idxRequest)),
            installmentNumber: parseInt(getVal(idxInst)) || 1,
            totalInstallments: parseInt(getVal(idxTotalInst)) || 12,
            periodMonth: getVal(idxPeriod) || getToday().substring(0, 7),
            type: getVal(idxType).toLowerCase() || 'privado',
            salaryDay: parseInt(getVal(idxSalaryDay)) || 10,
            paymentDay: parseInt(getVal(idxPaymentDay)) || 10,
            loanAmount: parseCurrencyInput(getVal(idxLoanAmount)),
            installmentAmount: parseCurrencyInput(getVal(idxInstAmount)),
            phone: getVal(idxPhone),
            email: getVal(idxEmail),
            domicilio: getVal(idxDomicilio),
            localidad: getVal(idxLocalidad),
            zona: getVal(idxZona),
            cpos: getVal(idxCpos),
            notes: getVal(idxNotes),
            paymentStatus: 'pending',
            isOverdue: false,
            daysOverdue: 0,
            lastPaymentDate: '',
            gestiones: [],
            promises: [],
            payments: []
        };

        if (!TYPE_CONFIG[newC.type]) newC.type = 'privado';

        sanitizeClientSchema(newC);
        parsedClients.push(newC);
    }

    return parsedClients;
}

let pendingImportData = null;
let currentReceiptData = null;

function openImportPreviewModal(previewData) {
    pendingImportData = previewData;

    const {
        parsedClients,
        totalRecords,
        recognizedCols,
        importedCols,
        ignoredCols,
        errors
    } = previewData;

    let updatedCount = 0;
    let newCount = 0;

    parsedClients.forEach(importedItem => {
        const key = getClientUniqueKey(importedItem);
        if (clients.some(c => getClientUniqueKey(c) === key)) {
            updatedCount++;
        } else {
            newCount++;
        }
    });

    const bodyEl = document.getElementById('importPreviewBody');
    if (!bodyEl) return;

    let sampleRowsHtml = '';
    const sampleList = parsedClients.slice(0, 5);
    sampleList.forEach((c) => {
        const fullAddr = [c.domicilio, c.localidad, c.zona].filter(Boolean).join(', ') || '-';
        sampleRowsHtml += `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong><br><small>DNI: ${escapeHtml(c.dni || '-')}</small></td>
                <td>Suc. ${escapeHtml(c.branchNumber || '-')}<br>Sol. ${escapeHtml(c.requestNumber || '-')}</td>
                <td><span class="badge badge-installment">Cuota ${c.installmentNumber} de ${c.totalInstallments}</span></td>
                <td>${formatCurrency(c.installmentAmount)}</td>
                <td><small><i class="fas fa-map-marker-alt"></i> ${escapeHtml(fullAddr)}</small></td>
            </tr>
        `;
    });

    let errorsHtml = '';
    if (errors && errors.length > 0) {
        errorsHtml = `
            <div class="alert-box alert-warning" style="margin-bottom: 1rem; padding: 0.75rem; background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.4); border-radius: 8px;">
                <h4 style="margin:0 0 0.5rem 0; color: #facc15;"><i class="fas fa-exclamation-triangle"></i> Posibles Advertencias / Filas Omitidas (${errors.length}):</h4>
                <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.85rem;">
                    ${errors.slice(0, 5).map(e => `<li>${escapeHtml(e)}</li>`).join('')}
                    ${errors.length > 5 ? `<li>...y ${errors.length - 5} advertencias más</li>` : ''}
                </ul>
            </div>
        `;
    }

    bodyEl.innerHTML = `
        <div class="preview-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
            <div class="stat-card" style="background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 8px; text-align: center;">
                <span class="stat-num" style="display:block; font-size: 1.4rem; font-weight: 700;">${totalRecords}</span>
                <span class="stat-lbl" style="font-size: 0.75rem; opacity: 0.8;">Encontrados</span>
            </div>
            <div class="stat-card" style="background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                <span class="stat-num text-success" style="display:block; font-size: 1.4rem; font-weight: 700; color: #4ade80;">${newCount}</span>
                <span class="stat-lbl" style="font-size: 0.75rem; opacity: 0.8;">Nuevos</span>
            </div>
            <div class="stat-card" style="background: rgba(14,165,233,0.1); border: 1px solid rgba(14,165,233,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                <span class="stat-num text-info" style="display:block; font-size: 1.4rem; font-weight: 700; color: #38bdf8;">${updatedCount}</span>
                <span class="stat-lbl" style="font-size: 0.75rem; opacity: 0.8;">A actualizar</span>
            </div>
            <div class="stat-card" style="background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                <span class="stat-num text-warning" style="display:block; font-size: 1.4rem; font-weight: 700; color: #facc15;">${errors ? errors.length : 0}</span>
                <span class="stat-lbl" style="font-size: 0.75rem; opacity: 0.8;">Advertencias</span>
            </div>
        </div>

        ${errorsHtml}

        <div class="cols-breakdown-box" style="margin-bottom: 1.25rem; background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px;">
            <h3 style="font-size: 0.95rem; margin-top: 0; margin-bottom: 0.5rem;"><i class="fas fa-columns"></i> Análisis de Columnas</h3>
            <div class="cols-detail" style="font-size: 0.85rem; line-height: 1.5;">
                <p style="margin: 0.25rem 0;"><strong><i class="fas fa-check-circle text-success" style="color:#4ade80;"></i> Columnas Reconocidas (${recognizedCols.length}):</strong> ${recognizedCols.map(c => `<code style="background:rgba(255,255,255,0.1); padding:2px 5px; border-radius:3px;">${escapeHtml(c)}</code>`).join(', ') || 'Ninguna'}</p>
                <p style="margin: 0.25rem 0;"><strong><i class="fas fa-download text-primary" style="color:#38bdf8;"></i> Datos que serán Importados:</strong> ${importedCols.join(', ')}</p>
                <p style="margin: 0.25rem 0;"><strong><i class="fas fa-eye-slash text-muted" style="opacity:0.6;"></i> Columnas Ignoradas (${ignoredCols.length}):</strong> ${ignoredCols.map(c => `<code style="background:rgba(255,255,255,0.05); padding:2px 5px; border-radius:3px; opacity:0.7;">${escapeHtml(c)}</code>`).join(', ') || 'Ninguna (debe, haber, sigla, empresas, etc.)'}</p>
            </div>
        </div>

        <div class="sample-table-box">
            <h3 style="font-size: 0.95rem; margin-top: 0; margin-bottom: 0.5rem;"><i class="fas fa-table"></i> Vista Previa (Muestra de primeros ${sampleList.length} registros)</h3>
            <div class="history-table-container">
                <table class="history-table">
                    <thead>
                        <tr>
                            <th>Cliente / DNI</th>
                            <th>Suc / Solicitud</th>
                            <th>Cuota ("minicuota")</th>
                            <th>Importe Vencido</th>
                            <th>Ubicación</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sampleRowsHtml || '<tr><td colspan="5">No hay muestra para visualizar</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const modal = document.getElementById('importPreviewModal');
    if (modal) openModal(modal);
}

function closeImportPreviewModal() {
    const modal = document.getElementById('importPreviewModal');
    if (modal) closeModalFn(modal);
    pendingImportData = null;
    const fileInput = document.getElementById('importFileInput');
    if (fileInput) fileInput.value = '';
}

function mergeMonthlyPortfolio(importedList) {
    let updatedCount = 0;
    let addedCount = 0;

    importedList.forEach(importedItem => {
        sanitizeClientSchema(importedItem);
        const key = getClientUniqueKey(importedItem);

        const existingIndex = clients.findIndex(c => getClientUniqueKey(c) === key);

        if (existingIndex !== -1) {
            const existing = clients[existingIndex];

            // Update official system fields ONLY
            if (importedItem.name) existing.name = importedItem.name;
            if (importedItem.apellido) existing.apellido = importedItem.apellido;
            if (importedItem.apenom) existing.apenom = importedItem.apenom;
            if (importedItem.branchNumber) existing.branchNumber = importedItem.branchNumber;
            if (importedItem.requestNumber) existing.requestNumber = importedItem.requestNumber;
            if (importedItem.installmentNumber) existing.installmentNumber = importedItem.installmentNumber;
            if (importedItem.totalInstallments) existing.totalInstallments = importedItem.totalInstallments;
            if (importedItem.periodMonth) existing.periodMonth = importedItem.periodMonth;
            if (importedItem.type) existing.type = importedItem.type;
            if (importedItem.segmento) existing.segmento = importedItem.segmento;
            if (importedItem.domicilio) existing.domicilio = importedItem.domicilio;
            if (importedItem.localidad) existing.localidad = importedItem.localidad;
            if (importedItem.cpos) existing.cpos = importedItem.cpos;
            if (importedItem.zona) existing.zona = importedItem.zona;
            if (importedItem.phone) existing.phone = importedItem.phone;
            if (importedItem.celular) existing.celular = importedItem.celular;
            if (importedItem.garante) existing.garante = importedItem.garante;
            if (importedItem.installmentAmount !== undefined && importedItem.installmentAmount > 0) {
                existing.installmentAmount = importedItem.installmentAmount;
            }
            if (importedItem.punitorios !== undefined) existing.punitorios = importedItem.punitorios;
            if (importedItem.vence) existing.vence = importedItem.vence;
            if (importedItem.salaryDay) existing.salaryDay = importedItem.salaryDay;
            if (importedItem.paymentDay) existing.paymentDay = importedItem.paymentDay;
            if (importedItem.dni) existing.dni = importedItem.dni;

            if (importedItem.notes && !existing.notes.includes(importedItem.notes)) {
                existing.notes = (existing.notes ? existing.notes + ' | ' : '') + importedItem.notes;
            }

            // CRITICAL: RETAIN INTERNAL GESTION DATA INTACT
            sanitizeClientSchema(existing);
            updatedCount++;
        } else {
            // New client entry in monthly portfolio
            if (!importedItem.id) importedItem.id = generateId();
            clients.push(importedItem);
            addedCount++;
        }
    });

    updateOverdueStatuses();
    saveClients();
    renderClients();

    return { updatedCount, addedCount };
}

function importData(file) {
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xls') || fileName.endsWith('.xlsx');
    const isCsv = fileName.endsWith('.csv') || fileName.endsWith('.txt');
    const isJson = fileName.endsWith('.json');

    const reader = new FileReader();

    if (isExcel) {
        reader.onload = (e) => {
            try {
                if (typeof XLSX === 'undefined') {
                    throw new Error('Librería XLSX no disponible');
                }
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                const firstSheetName = workbook.SheetNames[0];
                const firstSheet = workbook.Sheets[firstSheetName];
                const rowsData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

                if (!rowsData || rowsData.length === 0) {
                    throw new Error('La planilla Excel está vacía.');
                }

                const previewData = parseOfficialSpreadsheetRows(rowsData);
                if (previewData.parsedClients.length === 0) {
                    throw new Error('No se encontraron registros válidos en la planilla Excel.');
                }

                openImportPreviewModal(previewData);
            } catch (err) {
                showToast('Error al procesar la planilla Excel: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (isCsv) {
        reader.onload = (e) => {
            try {
                let previewData;
                if (typeof XLSX !== 'undefined') {
                    const workbook = XLSX.read(e.target.result, { type: 'string' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rowsData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
                    previewData = parseOfficialSpreadsheetRows(rowsData);
                } else {
                    const clientsList = parseCSVToClients(e.target.result);
                    previewData = {
                        parsedClients: clientsList,
                        totalRecords: clientsList.length,
                        recognizedCols: ['nombre', 'dni', 'sucursal', 'solicitud', 'cuota', 'monto'],
                        importedCols: ['Datos de cliente CSV'],
                        ignoredCols: [],
                        errors: []
                    };
                }

                if (!previewData.parsedClients || previewData.parsedClients.length === 0) {
                    throw new Error('No se encontraron registros válidos en el archivo CSV.');
                }

                openImportPreviewModal(previewData);
            } catch (err) {
                showToast('Error al importar el archivo CSV: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    } else if (isJson) {
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                const items = Array.isArray(parsed) ? parsed : [parsed];
                items.forEach(c => sanitizeClientSchema(c));

                const previewData = {
                    parsedClients: items,
                    totalRecords: items.length,
                    recognizedCols: ['JSON Object Schema'],
                    importedCols: ['Todos los campos JSON del cliente'],
                    ignoredCols: [],
                    errors: []
                };

                openImportPreviewModal(previewData);
            } catch (err) {
                showToast('Error al importar archivo JSON: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    } else {
        showToast('Formato de archivo no soportado. Seleccione .xls, .xlsx, .csv o .json', 'error');
    }
}

function resetDemoData() {
    const confirmationWord = "RESTABLECER";
    const userInput = prompt(
        `⚠️ ATENCIÓN: Estás a punto de restablecer los datos de la aplicación.\n\n` +
        `Esta acción BORRARÁ permanentemente todos los datos de clientes reales, gestiones, promesas y pagos cargados en el dispositivo, reemplazándolos con datos de demostración.\n\n` +
        `Para confirmar que deseas continuar, escribe exactamente la palabra: ${confirmationWord}`
    );

    if (userInput && userInput.trim().toUpperCase() === confirmationWord) {
        clients = getDemoData();
        saveClients();
        renderClients();
        showToast('Datos de demostración restablecidos', 'info');
    } else if (userInput !== null) {
        showToast('Palabra de confirmación incorrecta. No se restablecieron los datos.', 'error');
    }
}

// ========================================
// RENDER & FILTERING & SORTING
// ========================================

function updateMonthFilterOptions() {
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
    let optionsHtml = `<option value="all"${selectedValue === 'all' ? ' selected' : ''}>Todas las carteras (Todos)</option>`;

    sortedMonths.forEach(m => {
        const label = formatMonthYear(m);
        optionsHtml += `<option value="${m}"${selectedValue === m ? ' selected' : ''}>${label}</option>`;
    });

    if (els.monthFilterSelect) {
        els.monthFilterSelect.innerHTML = optionsHtml;
    }

    const headerMonthSelect = document.getElementById('headerMonthSelect');
    if (headerMonthSelect) {
        headerMonthSelect.innerHTML = optionsHtml;
    }
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

    const todayStr = getToday();
    if (currentStatusFilter === 'active') {
        filtered = filtered.filter(c => c.paymentStatus !== 'paid');
    } else if (currentStatusFilter !== 'all') {
        if (currentStatusFilter === 'today' || currentStatusFilter === 'today_due') {
            filtered = filtered.filter(c => c.paymentDay === todayDay && c.paymentStatus !== 'paid');
        } else if (currentStatusFilter === 'unmanaged') {
            filtered = filtered.filter(c => !Array.isArray(c.gestiones) || c.gestiones.length === 0);
        } else if (currentStatusFilter === 'partial') {
            filtered = filtered.filter(c => c.paymentStatus === 'partial');
        } else if (currentStatusFilter === 'promises') {
            filtered = filtered.filter(c => Array.isArray(c.promises) && c.promises.some(p => p.status === 'pendiente'));
        } else if (currentStatusFilter === 'promises_today') {
            filtered = filtered.filter(c => Array.isArray(c.promises) && c.promises.some(p => p.promisedDate === todayStr && p.status === 'pendiente'));
        } else if (currentStatusFilter === 'promises_broken') {
            filtered = filtered.filter(c => Array.isArray(c.promises) && c.promises.some(p => p.status === 'vencida' || p.status === 'incumplida' || (p.promisedDate < todayStr && p.status === 'pendiente')));
        } else if (currentStatusFilter === 'followup_today') {
            filtered = filtered.filter(c => Array.isArray(c.gestiones) && c.gestiones.some(g => g.nextFollowUpDate === todayStr));
        } else if (currentStatusFilter === 'payments_today') {
            filtered = filtered.filter(c => Array.isArray(c.payments) && c.payments.some(p => p.date === todayStr));
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
    updateDailyDashboard();
    updateDailyRouteBtnVisibility();

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

function toggleCardDetails(clientId) {
    const detailsEl = document.getElementById(`card-details-${clientId}`);
    const toggleBtn = document.getElementById(`card-toggle-btn-${clientId}`);
    if (!detailsEl || !toggleBtn) return;

    const isHidden = detailsEl.style.display === 'none' || !detailsEl.style.display;
    detailsEl.style.display = isHidden ? 'block' : 'none';
    toggleBtn.innerHTML = isHidden ? '<i class="fas fa-chevron-up"></i> Menos detalles' : '<i class="fas fa-chevron-down"></i> Ver detalles';
}

function renderClientCard(client) {
    const typeConfig = TYPE_CONFIG[client.type];
    const statusConfig = STATUS_CONFIG[client.paymentStatus];
    const today = new Date();
    const currentDay = today.getDate();
    const isPayDay = currentDay === client.paymentDay;
    const isTomorrow = (currentDay === 31 ? 1 : currentDay + 1) === client.paymentDay;
    const isSalaryDay = currentDay === client.salaryDay;

    // Fused Single Status / Urgency Indicator
    let combinedStatusLabel = statusConfig.label;
    if (client.paymentStatus === 'paid' && client.installmentNumber === client.totalInstallments) {
        combinedStatusLabel = `✅ Préstamo Completado`;
    } else if (client.paymentStatus === 'overdue' && client.daysOverdue > 0) {
        combinedStatusLabel = `🔴 Atrasado - ${client.daysOverdue} ${client.daysOverdue === 1 ? 'día' : 'días'}`;
    } else if (client.paymentStatus === 'paid') {
        combinedStatusLabel = `🟢 Pagado`;
    } else if (client.paymentStatus === 'partial') {
        combinedStatusLabel = `🟡 Pago Parcial`;
    } else if (isPayDay) {
        combinedStatusLabel = `🔵 Vence Hoy`;
    } else if (isTomorrow) {
        combinedStatusLabel = `🔵 Vence Mañana`;
    } else {
        combinedStatusLabel = `⚪ Pendiente`;
    }

    const punitorios = (client.paymentStatus === 'overdue' && client.daysOverdue > 0) ? calculatePunitorios(client.installmentAmount, client.daysOverdue, client.penaltyRate) : 0;

    let overduePenaltyHtml = '';
    if (client.paymentStatus === 'overdue' && punitorios > 0) {
        overduePenaltyHtml = `<span class="penalty-badge" title="Interés punitorio por mora (${client.penaltyRate || 1.0}% diario)"><i class="fas fa-percent"></i> Punitorios: ${formatCurrency(punitorios)}</span>`;
    }

    let todayBadgeHtml = '';
    if (isSalaryDay) {
        todayBadgeHtml = `<span class="badge badge-today"><i class="fas fa-wallet"></i> Cobra Sueldo Hoy (día ${client.salaryDay})</span>`;
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
    if (client.paymentStatus === 'paid' && client.installmentNumber === client.totalInstallments) {
        instBadgeHtml += `<span class="badge" style="background:#d1e7dd;color:#0f5132;font-weight:700;" title="Préstamo Completado"><i class="fas fa-check-double"></i> Préstamo Completado</span>`;
    }
    let monthLabel = formatMonthYear(client.periodMonth);
    let monthBadgeHtml = monthLabel ? `<span class="badge badge-period-month ${client.paymentStatus === 'overdue' ? 'overdue' : ''}" title="Mes del período"><i class="fas fa-calendar-alt"></i> Mes: ${escapeHtml(monthLabel)}</span>` : '';

    let contactHtml = '';
    if (client.email) {
        contactHtml = `<div class="client-contact"><span><i class="fas fa-envelope"></i> ${escapeHtml(client.email)}</span></div>`;
    }

    let notesHtml = client.notes ? `<div class="client-notes"><i class="fas fa-sticky-note"></i> ${escapeHtml(client.notes)}</div>` : '';

    const payBtnText = client.paymentStatus === 'paid' ? '<i class="fas fa-check"></i> Pagado' : 'Registrar pago';
    const payBtnClass = client.paymentStatus === 'paid' ? 'paid' : '';

    // Active promise badge if exists
    let activePromiseHtml = '';
    if (Array.isArray(client.promises) && client.promises.length > 0) {
        const sortedPromises = [...client.promises].sort((a, b) => b.promisedDate.localeCompare(a.promisedDate));
        const activePr = sortedPromises.find(p => p.status === 'pendiente' || p.status === 'vencida') || sortedPromises[0];
        if (activePr) {
            const todayStr = getToday();
            let pClass = activePr.status;
            let pLabel = activePr.status.toUpperCase();
            if (activePr.promisedDate === todayStr && activePr.status === 'pendiente') {
                pClass = 'hoy';
                pLabel = 'PROMESA HOY';
            }
            activePromiseHtml = `<div class="promise-badge-card ${pClass}" title="Promesa de pago">
                <i class="fas fa-handshake"></i> Promesa: ${formatDate(activePr.promisedDate)} - ${formatCurrency(activePr.promisedAmount)} [${pLabel}]
            </div>`;
        }
    }

    return `
        <div class="client-card ${client.paymentStatus}">
            <!-- CAPA PRINCIPAL (SIEMPRE VISIBLE) -->
            <div class="card-header">
                <div class="client-info">
                    <div class="client-name">${escapeHtml(client.name)}</div>
                    <div class="status-indicator">
                        <span class="status-dot ${statusConfig.dotClass}"></span>
                        <span class="status-text ${statusConfig.class}">${escapeHtml(combinedStatusLabel)}</span>
                    </div>
                </div>
                <div class="amount-badge primary-amount">
                    <span class="label">Cuota:</span>
                    <span class="value">${formatCurrency(client.installmentAmount)}</span>
                </div>
            </div>

            <div class="payment-status">
                <button class="btn-pay ${payBtnClass}" onclick="openPaymentModal('${client.id}')" style="width: 100%;">
                    ${payBtnText}
                </button>
            </div>

            <!-- Máximo 3 acciones rápidas visibles -->
            <div class="card-quick-actions">
                ${client.phone ? `<a href="${escapeHtml(buildWhatsAppLink(client))}" target="_blank" class="btn-card-action btn-whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp</a>` : ''}
                ${client.phone ? `<a href="tel:${escapeHtml(client.phone)}" class="btn-card-action btn-call"><i class="fas fa-phone"></i> Llamar</a>` : ''}
                <button type="button" class="btn-card-action btn-action-gestion" onclick="openGestionModal('${client.id}')">
                    <i class="fas fa-headset"></i> Gestión
                </button>
            </div>

            <div class="card-toggle-wrapper" style="text-align: center; margin-top: 0.5rem;">
                <button type="button" id="card-toggle-btn-${client.id}" class="btn-card-toggle" onclick="toggleCardDetails('${client.id}')">
                    <i class="fas fa-chevron-down"></i> Ver detalles
                </button>
            </div>

            <!-- CAPA SECUNDARIA (COLAPSADA POR DEFECTO) -->
            <div id="card-details-${client.id}" class="card-secondary-layer" style="display: none;">
                <div class="client-meta" style="margin-top: 0.5rem; margin-bottom: 0.5rem;">
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
                    ${client.loanAmount > 0 ? `<span class="payment-day"><i class="fas fa-hand-holding-dollar"></i> Préstamo: ${formatCurrency(client.loanAmount)}</span>` : ''}
                </div>

                ${contactHtml}
                ${notesHtml}
                ${activePromiseHtml}
                ${overduePenaltyHtml ? `<div style="margin-top:0.35rem;">${overduePenaltyHtml}</div>` : ''}

                <div class="secondary-actions-row" style="display: flex; gap: 0.35rem; margin-top: 0.65rem; padding-top: 0.5rem; border-top: 1px dashed var(--border); flex-wrap: wrap;">
                    <button type="button" class="btn-card-action btn-action-promise" onclick="openPromiseModal('${client.id}')">
                        <i class="fas fa-handshake"></i> Promesa
                    </button>
                    <button type="button" class="btn-card-action btn-action-address" onclick="openAddressModal('${client.id}')" title="Ver ubicación y dirección">
                        <i class="fas fa-location-dot"></i> Dirección
                    </button>
                    <button type="button" class="btn-card-action btn-action-history" onclick="openClientHistoryModal('${client.id}')">
                        <i class="fas fa-folder-open"></i> Historial (${(client.gestiones||[]).length + (client.promises||[]).length})
                    </button>
                    <button type="button" class="btn-card-action" onclick="editClient('${client.id}')" title="Editar">
                        <i class="fas fa-pen"></i> Editar
                    </button>
                    <button type="button" class="btn-card-action btn-outline-danger" onclick="confirmDelete('${client.id}')" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ========================================
// GESTIONES DIARIAS & HISTORIAL
// ========================================

let currentGestionClient = null;

function openGestionModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    currentGestionClient = client;

    const gestionClientId = document.getElementById('gestionClientId');
    const gestionClientPreview = document.getElementById('gestionClientPreview');
    const gestionDate = document.getElementById('gestionDate');
    const gestionTime = document.getElementById('gestionTime');
    const gestionType = document.getElementById('gestionType');
    const gestionResult = document.getElementById('gestionResult');
    const gestionObservations = document.getElementById('gestionObservations');
    const nextAction = document.getElementById('nextAction');
    const nextFollowUpDate = document.getElementById('nextFollowUpDate');
    const promiseAutoFields = document.getElementById('promiseAutoFields');
    const autoPromisedDate = document.getElementById('autoPromisedDate');
    const autoPromisedAmount = document.getElementById('autoPromisedAmount');
    const autoPromiseMethod = document.getElementById('autoPromiseMethod');

    if (gestionClientId) gestionClientId.value = id;
    if (gestionClientPreview) {
        const dniText = client.dni ? ` • DNI: ${escapeHtml(client.dni)}` : '';
        gestionClientPreview.innerHTML = `
            <div class="preview-name">${escapeHtml(client.name)}</div>
            <div class="preview-type">${TYPE_CONFIG[client.type].label}${dniText} • Cuota: ${client.installmentNumber || 1}/${client.totalInstallments || 12} • Valor: ${formatCurrency(client.installmentAmount)}</div>
        `;
    }

    if (gestionDate) gestionDate.value = getToday();
    if (gestionTime) gestionTime.value = getCurrentTime();
    if (gestionType) gestionType.value = 'WhatsApp / mensaje';
    if (gestionResult) gestionResult.value = 'Prometió pagar';
    if (gestionObservations) gestionObservations.value = '';
    if (nextAction) nextAction.value = '';
    if (nextFollowUpDate) nextFollowUpDate.value = '';

    if (autoPromisedDate) autoPromisedDate.value = getToday();
    if (autoPromisedAmount) autoPromisedAmount.value = client.installmentAmount ? client.installmentAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    if (autoPromiseMethod) autoPromiseMethod.value = 'Sucursal';

    if (promiseAutoFields) {
        promiseAutoFields.style.display = (gestionResult.value === 'Prometió pagar') ? 'block' : 'none';
    }

    toggleGestionWaBtn();

    openModal(document.getElementById('gestionModal'));
}

function toggleGestionWaBtn() {
    const gestionType = document.getElementById('gestionType');
    const container = document.getElementById('openGestionWaContainer');
    if (gestionType && container) {
        const isWa = gestionType.value === 'WhatsApp / mensaje';
        const hasPhone = currentGestionClient && (currentGestionClient.phone || currentGestionClient.celular);
        container.style.display = (isWa && hasPhone) ? 'block' : 'none';
    }
}

function handleSaveGestion(e) {
    e.preventDefault();

    const id = document.getElementById('gestionClientId').value;
    const client = clients.find(c => c.id === id);
    if (!client) return;

    const gDate = document.getElementById('gestionDate').value || getToday();
    const gTime = document.getElementById('gestionTime').value || getCurrentTime();
    const gType = document.getElementById('gestionType').value;
    const gResult = document.getElementById('gestionResult').value;
    const gObs = document.getElementById('gestionObservations').value.trim();
    const nextAct = document.getElementById('nextAction').value.trim();
    const nextDate = document.getElementById('nextFollowUpDate').value;

    const newGestion = {
        id: generateId(),
        date: gDate,
        time: gTime,
        type: gType,
        result: gResult,
        observations: gObs,
        nextAction: nextAct,
        nextFollowUpDate: nextDate,
        promiseId: null,
        createdAt: new Date().toISOString()
    };

    if (gResult === 'Prometió pagar') {
        const pDate = document.getElementById('autoPromisedDate').value || gDate;
        const pAmount = parseCurrencyInput(document.getElementById('autoPromisedAmount').value) || client.installmentAmount || 0;
        const pMethod = document.getElementById('autoPromiseMethod').value || 'Sucursal';

        const newPromise = {
            id: generateId(),
            periodMonth: client.periodMonth || getToday().substring(0, 7),
            installmentNumber: `${client.installmentNumber || 1}`,
            creationDate: gDate,
            promisedDate: pDate,
            promisedAmount: pAmount,
            paymentMethod: pMethod,
            observations: gObs ? `Generada por gestión (${gType}): ${gObs}` : `Generada por gestión (${gType})`,
            status: (pDate < getToday()) ? 'vencida' : 'pendiente',
            gestionId: newGestion.id,
            paymentId: null,
            createdAt: new Date().toISOString()
        };

        if (!client.promises) client.promises = [];
        client.promises.push(newPromise);
        newGestion.promiseId = newPromise.id;
    }

    if (!client.gestiones) client.gestiones = [];
    client.gestiones.push(newGestion);

    updateOverdueStatuses();
    saveClients();
    renderClients();

    showToast('Gestión de cobranza registrada', 'success');
    closeModalFn(document.getElementById('gestionModal'));
}

let selectedAddressClient = null;

function openAddressModal(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    selectedAddressClient = client;

    const bodyEl = document.getElementById('addressModalBody');
    if (!bodyEl) return;

    const fullAddress = client.domicilio || 'No registrada';
    const locality = client.localidad || 'No registrada';
    const cpos = client.cpos || 'No registrado';
    const zone = client.zona || 'No registrada';
    const garante = client.garante || '';

    bodyEl.innerHTML = `
        <div class="address-details-card">
            <div class="address-header-info">
                <h3><i class="fas fa-user-circle"></i> ${escapeHtml(client.name)}</h3>
                ${client.dni ? `<span class="badge badge-secondary">DNI: ${escapeHtml(client.dni)}</span>` : ''}
            </div>

            <div class="address-grid">
                <div class="address-item full-width">
                    <span class="addr-label"><i class="fas fa-road"></i> Dirección Completa</span>
                    <span class="addr-value highlight">${escapeHtml(fullAddress)}</span>
                </div>
                <div class="address-item">
                    <span class="addr-label"><i class="fas fa-city"></i> Localidad</span>
                    <span class="addr-value">${escapeHtml(locality)}</span>
                </div>
                <div class="address-item">
                    <span class="addr-label"><i class="fas fa-mail-bulk"></i> Código Postal</span>
                    <span class="addr-value">${escapeHtml(cpos)}</span>
                </div>
                <div class="address-item">
                    <span class="addr-label"><i class="fas fa-map-signs"></i> Zona</span>
                    <span class="addr-value">${escapeHtml(zone)}</span>
                </div>
                ${garante ? `
                <div class="address-item full-width">
                    <span class="addr-label"><i class="fas fa-user-shield"></i> Garante</span>
                    <span class="addr-value">${escapeHtml(garante)}</span>
                </div>` : ''}
            </div>
        </div>
    `;

    const modal = document.getElementById('addressModal');
    if (modal) openModal(modal);
}

function closeAddressModal() {
    const modal = document.getElementById('addressModal');
    if (modal) closeModalFn(modal);
    selectedAddressClient = null;
}

function copyAddressToClipboard() {
    if (!selectedAddressClient) return;

    const parts = [];
    if (selectedAddressClient.domicilio) parts.push(`Dirección: ${selectedAddressClient.domicilio}`);
    if (selectedAddressClient.localidad) parts.push(`Localidad: ${selectedAddressClient.localidad}`);
    if (selectedAddressClient.cpos) parts.push(`CP: ${selectedAddressClient.cpos}`);
    if (selectedAddressClient.zona) parts.push(`Zona: ${selectedAddressClient.zona}`);

    const textToCopy = `${selectedAddressClient.name} - ${parts.join(', ')}`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            showToast('Dirección copiada al portapapeles', 'success');
        }).catch(() => {
            fallbackCopyText(textToCopy);
        });
    } else {
        fallbackCopyText(textToCopy);
    }
}

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('Dirección copiada al portapapeles', 'success');
    } catch (e) {
        showToast('No se pudo copiar la dirección', 'error');
    }
    document.body.removeChild(textarea);
}

function openAddressInGoogleMaps() {
    if (!selectedAddressClient) return;

    const queryParts = [];
    if (selectedAddressClient.domicilio) queryParts.push(selectedAddressClient.domicilio);
    if (selectedAddressClient.cpos) queryParts.push(selectedAddressClient.cpos);
    if (selectedAddressClient.localidad) queryParts.push(selectedAddressClient.localidad);

    const queryStr = queryParts.length > 0 ? queryParts.join(', ') : selectedAddressClient.name;
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryStr)}`;

    window.open(mapsUrl, '_blank');
}

function openDailyRoute() {
    const visibleClients = getFilteredClients();
    const clientsWithAddr = visibleClients.filter(c => c.domicilio || c.cpos || c.localidad);

    if (clientsWithAddr.length === 0) {
        showToast('No hay clientes visibles con dirección registrada para armar la ruta', 'error');
        return;
    }

    const addresses = clientsWithAddr.map(c => {
        const parts = [c.domicilio, c.cpos, c.localidad].filter(Boolean);
        return parts.join(', ');
    });

    const destination = addresses[addresses.length - 1];
    let routeUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

    if (addresses.length > 1) {
        const waypoints = addresses.slice(0, addresses.length - 1).join('|');
        routeUrl += `&waypoints=${encodeURIComponent(waypoints)}`;
    }

    window.open(routeUrl, '_blank');
}

function updateDailyRouteBtnVisibility() {
    const routeBtn = document.getElementById('dailyRouteBtn');
    if (!routeBtn) return;
    const isTodayOrOverdue = (
        currentStatusFilter === 'today' ||
        currentStatusFilter === 'today_due' ||
        currentStatusFilter === 'overdue'
    );
    routeBtn.style.display = isTodayOrOverdue ? 'inline-flex' : 'none';
}

function openClientHistoryModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    const preview = document.getElementById('clientHistoryPreview');
    if (preview) {
        const dniText = client.dni ? ` • DNI: ${escapeHtml(client.dni)}` : '';
        preview.innerHTML = `
            <div class="preview-name">${escapeHtml(client.name)}</div>
            <div class="preview-type">${TYPE_CONFIG[client.type].label}${dniText} • Cuota actual: ${client.installmentNumber || 1}/${client.totalInstallments || 12} • Valor: ${formatCurrency(client.installmentAmount)}</div>
        `;
    }

    renderClientHistoryTimeline(client);

    // Setup tab buttons
    document.querySelectorAll('#clientHistoryModal .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#clientHistoryModal .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#clientHistoryModal .tab-content').forEach(tc => tc.classList.remove('active'));
            btn.classList.add('active');
            const target = btn.dataset.tab;
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.add('active');
        };
    });

    openModal(document.getElementById('clientHistoryModal'));
}

function renderClientHistoryTimeline(client) {
    const gestionesList = document.getElementById('gestionesList');
    const promisesList = document.getElementById('promisesList');
    const clientPaymentsList = document.getElementById('clientPaymentsList');

    const countGestiones = document.getElementById('countGestiones');
    const countPromises = document.getElementById('countPromises');
    const countPayments = document.getElementById('countPayments');

    const gestiones = Array.isArray(client.gestiones) ? [...client.gestiones].sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time)) : [];
    const promises = Array.isArray(client.promises) ? [...client.promises].sort((a,b) => (b.promisedDate + b.createdAt).localeCompare(a.promisedDate + a.createdAt)) : [];
    const payments = Array.isArray(client.payments) ? [...client.payments].sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time)) : [];

    if (countGestiones) countGestiones.textContent = gestiones.length;
    if (countPromises) countPromises.textContent = promises.length;
    if (countPayments) countPayments.textContent = payments.length;

    // 1. Gestiones
    if (gestionesList) {
        if (gestiones.length === 0) {
            gestionesList.innerHTML = `<div class="no-history">No hay gestiones registradas para este cliente.</div>`;
        } else {
            gestionesList.innerHTML = gestiones.map(g => `
                <div class="timeline-item gestion">
                    <div class="timeline-header">
                        <span><i class="fas fa-calendar"></i> ${formatDate(g.date)} — ${escapeHtml(g.time)}</span>
                        <span class="timeline-badge" style="background:#e0f2fe;color:#0369a1;"><i class="fas fa-headset"></i> ${escapeHtml(g.type)}</span>
                    </div>
                    <div class="timeline-title">Resultado: ${escapeHtml(g.result)}</div>
                    ${g.observations ? `<div class="timeline-body">"${escapeHtml(g.observations)}"</div>` : ''}
                    ${g.nextAction ? `<div class="timeline-body" style="color:var(--primary-dark);font-weight:600;margin-top:4px;"><i class="fas fa-arrow-right"></i> Próxima acción: ${escapeHtml(g.nextAction)}${g.nextFollowUpDate ? ` (${formatDate(g.nextFollowUpDate)})` : ''}</div>` : ''}
                </div>
            `).join('');
        }
    }

    // 2. Promises
    if (promisesList) {
        if (promises.length === 0) {
            promisesList.innerHTML = `<div class="no-history">No hay promesas de pago registradas.</div>`;
        } else {
            promisesList.innerHTML = promises.map(pr => {
                let badgeBg = '#fff3cd';
                let badgeColor = '#856404';
                if (pr.status === 'cumplida') { badgeBg = '#d1e7dd'; badgeColor = '#0f5132'; }
                else if (pr.status === 'vencida' || pr.status === 'incumplida') { badgeBg = '#f8d7da'; badgeColor = '#721c24'; }

                return `
                    <div class="timeline-item promise ${pr.status}">
                        <div class="timeline-header">
                            <span>Acordada: ${formatDate(pr.creationDate)} — Período: ${escapeHtml(formatMonthYear(pr.periodMonth))}</span>
                            <span class="timeline-badge" style="background:${badgeBg};color:${badgeColor};">${pr.status.toUpperCase()}</span>
                        </div>
                        <div class="timeline-title"><i class="fas fa-handshake"></i> Fecha Prometida: ${formatDate(pr.promisedDate)} — Importe: ${formatCurrency(pr.promisedAmount)}</div>
                        <div class="timeline-body">Medio de pago acordado: <strong>${escapeHtml(pr.paymentMethod)}</strong></div>
                        ${pr.observations ? `<div class="timeline-body">"${escapeHtml(pr.observations)}"</div>` : ''}
                        <div class="promise-actions-row">
                            <button type="button" class="btn-promise-status btn-fulfilled ${pr.status === 'cumplida' ? 'active' : ''}" onclick="updatePromiseStatus('${client.id}', '${pr.id}', 'cumplida')">
                                <i class="fas fa-check-circle"></i> Cumplida
                            </button>
                            <button type="button" class="btn-promise-status btn-broken ${pr.status === 'incumplida' ? 'active' : ''}" onclick="updatePromiseStatus('${client.id}', '${pr.id}', 'incumplida')">
                                <i class="fas fa-times-circle"></i> Incumplida
                            </button>
                            <button type="button" class="btn-promise-status btn-pending ${pr.status === 'pendiente' ? 'active' : ''}" onclick="updatePromiseStatus('${client.id}', '${pr.id}', 'pendiente')">
                                <i class="fas fa-clock"></i> Pendiente
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // 3. Payments
    if (clientPaymentsList) {
        if (payments.length === 0) {
            clientPaymentsList.innerHTML = `<div class="no-history">No hay pagos registrados para este cliente.</div>`;
        } else {
            clientPaymentsList.innerHTML = payments.map(p => `
                <div class="timeline-item payment">
                    <div class="timeline-header">
                        <span><i class="fas fa-calendar"></i> ${formatDate(p.date)} ${p.time ? p.time : ''} — N° Comp: <strong>${escapeHtml(p.receiptNumber)}</strong></span>
                        <span class="timeline-badge" style="background:#d1e7dd;color:#0f5132;"><i class="fas fa-check-circle"></i> PAGADO</span>
                    </div>
                    <div class="timeline-title">${formatCurrency(p.amount)} — Período: ${escapeHtml(formatMonthYear(p.periodMonth))} (Cuota ${escapeHtml(p.installmentNumber)})</div>
                    <div class="timeline-body">Medio de pago: <strong>${escapeHtml(p.paymentMethod)}</strong> ${p.punitorios > 0 ? ` | Punitorios: ${formatCurrency(p.punitorios)}` : ''}</div>
                    ${p.notes ? `<div class="timeline-body">Obs: "${escapeHtml(p.notes)}"</div>` : ''}
                    <div style="margin-top:6px;">
                        <button type="button" class="btn-card-action btn-sm" onclick="showReceiptModal('${client.id}', '${p.id}')">
                            <i class="fas fa-file-invoice"></i> Ver comprobante
                        </button>
                    </div>
                </div>
            `).join('');
        }
    }
}

// ========================================
// PROMESAS DE PAGO
// ========================================

function openPromiseModal(id) {
    const client = clients.find(c => c.id === id);
    if (!client) return;

    const promiseClientId = document.getElementById('promiseClientId');
    const promiseClientPreview = document.getElementById('promiseClientPreview');
    const promisePeriodMonth = document.getElementById('promisePeriodMonth');
    const promiseInstallmentNumber = document.getElementById('promiseInstallmentNumber');
    const promiseCreationDate = document.getElementById('promiseCreationDate');
    const promisedDate = document.getElementById('promisedDate');
    const promisedAmount = document.getElementById('promisedAmount');
    const promisePaymentMethod = document.getElementById('promisePaymentMethod');
    const promiseObservations = document.getElementById('promiseObservations');

    if (promiseClientId) promiseClientId.value = id;
    if (promiseClientPreview) {
        const dniText = client.dni ? ` • DNI: ${escapeHtml(client.dni)}` : '';
        promiseClientPreview.innerHTML = `
            <div class="preview-name">${escapeHtml(client.name)}</div>
            <div class="preview-type">${TYPE_CONFIG[client.type].label}${dniText} • Cuota: ${client.installmentNumber || 1}/${client.totalInstallments || 12} • Valor: ${formatCurrency(client.installmentAmount)}</div>
        `;
    }

    if (promisePeriodMonth) promisePeriodMonth.value = client.periodMonth || getToday().substring(0, 7);
    if (promiseInstallmentNumber) promiseInstallmentNumber.value = `${client.installmentNumber || 1} de ${client.totalInstallments || 12}`;
    if (promiseCreationDate) promiseCreationDate.value = getToday();
    if (promisedDate) promisedDate.value = getToday();
    if (promisedAmount) promisedAmount.value = client.installmentAmount ? client.installmentAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    if (promisePaymentMethod) promisePaymentMethod.value = 'Sucursal';
    if (promiseObservations) promiseObservations.value = '';

    openModal(document.getElementById('promiseModal'));
}

function updatePromiseStatus(clientId, promiseId, newStatus) {
    const client = clients.find(c => c.id === clientId);
    if (!client || !Array.isArray(client.promises)) return;
    const promise = client.promises.find(p => p.id === promiseId);
    if (!promise) return;

    promise.status = newStatus;
    updateOverdueStatuses();
    saveClients();
    renderClients();

    if (document.getElementById('clientHistoryModal') && document.getElementById('clientHistoryModal').classList.contains('open')) {
        renderClientHistoryTimeline(client);
    }

    const labelMap = { cumplida: 'Cumplida', incumplida: 'Incumplida', pendiente: 'Pendiente', vencida: 'Vencida' };
    showToast(`Promesa de pago marcada como ${labelMap[newStatus] || newStatus}`, 'info');
}

function handleSavePromise(e) {
    e.preventDefault();

    const id = document.getElementById('promiseClientId').value;
    const client = clients.find(c => c.id === id);
    if (!client) return;

    const periodMonth = document.getElementById('promisePeriodMonth').value || client.periodMonth || getToday().substring(0, 7);
    const instNum = document.getElementById('promiseInstallmentNumber').value.trim() || `${client.installmentNumber || 1}`;
    const creationDate = document.getElementById('promiseCreationDate').value || getToday();
    const pDate = document.getElementById('promisedDate').value || getToday();
    const pAmount = parseCurrencyInput(document.getElementById('promisedAmount').value) || client.installmentAmount || 0;
    const pMethod = document.getElementById('promisePaymentMethod').value || 'Sucursal';
    const obs = document.getElementById('promiseObservations').value.trim();

    const newPromise = {
        id: generateId(),
        periodMonth: periodMonth,
        installmentNumber: instNum,
        creationDate: creationDate,
        promisedDate: pDate,
        promisedAmount: pAmount,
        paymentMethod: pMethod,
        observations: obs,
        status: (pDate < getToday()) ? 'vencida' : 'pendiente',
        gestionId: null,
        paymentId: null,
        createdAt: new Date().toISOString()
    };

    if (!client.promises) client.promises = [];
    client.promises.push(newPromise);

    updateOverdueStatuses();
    saveClients();
    renderClients();

    showToast('Promesa de pago registrada', 'success');
    closeModalFn(document.getElementById('promiseModal'));
}

// ========================================
// COMPROBANTE DE PAGO IMPRIMIBLE
// ========================================

function showReceiptModal(clientId, paymentId) {
    let targetPayment = null;
    let targetClient = null;

    if (clientId) {
        targetClient = clients.find(c => c.id === clientId);
        if (targetClient && Array.isArray(targetClient.payments)) {
            targetPayment = targetClient.payments.find(p => p.id === paymentId);
        }
    }

    if (!targetPayment) {
        for (const c of clients) {
            if (Array.isArray(c.payments)) {
                const found = c.payments.find(p => p.id === paymentId);
                if (found) {
                    targetPayment = found;
                    targetClient = c;
                    break;
                }
            }
        }
    }

    if (!targetPayment || !targetClient) {
        showToast('Comprobante no encontrado', 'error');
        return;
    }

    const receiptContainer = document.getElementById('receiptContainer');
    if (!receiptContainer) return;

    const baseCuota = targetPayment.installmentAmount || targetClient.installmentAmount || targetPayment.amount;
    const punitoriosGen = targetPayment.punitorios || 0;
    const punitoriosWaived = targetPayment.punitoriosWaived || 0;
    const totalCobrado = targetPayment.amount;

    const isPartial = targetPayment.paymentType === 'partial';

    // Calculate previous and remaining for this cuota
    let previousPaidBeforeThis = 0;
    if (Array.isArray(targetClient.payments)) {
        targetClient.payments.forEach(p => {
            const sameInst = (p.installmentNumber || '').toString().trim() === (targetPayment.installmentNumber || '').toString().trim();
            const samePeriod = p.periodMonth === targetPayment.periodMonth;
            if (sameInst && samePeriod && p.id !== targetPayment.id && p.createdAt < targetPayment.createdAt) {
                previousPaidBeforeThis += (p.amount || 0);
            }
        });
    }

    const gestionTypeSelect = document.getElementById('gestionType');
    if (gestionTypeSelect) {
        gestionTypeSelect.addEventListener('change', toggleGestionWaBtn);
    }

    const openGestionWaBtn = document.getElementById('openGestionWaBtn');
    if (openGestionWaBtn) {
        openGestionWaBtn.addEventListener('click', () => {
            if (currentGestionClient) {
                const link = buildWhatsAppLink(currentGestionClient);
                if (link !== '#') window.open(link, '_blank');
            }
        });
    }

    const totalAccumulatedSoFar = previousPaidBeforeThis + totalCobrado;
    const totalRequired = baseCuota + Math.max(0, punitoriosGen - punitoriosWaived);
    const pendingBalance = Math.max(0, totalRequired - totalAccumulatedSoFar);

    const receiptTitle = isPartial ? 'COMPROBANTE DE PAGO A CUENTA' : 'COMPROBANTE DE PAGO';

    receiptContainer.innerHTML = `
        <div class="receipt-header-box">
            <h1>Palmares</h1>
            <div class="sub-brand">Efectivo en el Acto</div>
            <div class="receipt-title">${receiptTitle}</div>
            <div class="receipt-number-badge">COMPROBANTE N.° ${escapeHtml(targetPayment.receiptNumber || '00000001')}</div>
        </div>

        <div class="receipt-section-title"><i class="fas fa-user"></i> Datos del Cliente</div>
        <div class="receipt-row"><span>Nombre Completo:</span> <strong>${escapeHtml(targetClient.name)}</strong></div>
        ${targetClient.dni ? `<div class="receipt-row"><span>DNI / Documento:</span> <strong>${escapeHtml(targetClient.dni)}</strong></div>` : ''}
        ${targetClient.branchNumber ? `<div class="receipt-row"><span>Sucursal N°:</span> <strong>${escapeHtml(targetClient.branchNumber)}</strong></div>` : ''}
        ${targetClient.requestNumber ? `<div class="receipt-row"><span>Solicitud / Operación N°:</span> <strong>${escapeHtml(targetClient.requestNumber)}</strong></div>` : ''}

        <div class="receipt-section-title"><i class="fas fa-file-invoice-dollar"></i> Detalle del Pago</div>
        <div class="receipt-row"><span>Fecha y Hora de Pago:</span> <strong>${formatDate(targetPayment.date)} — ${escapeHtml(targetPayment.time || '12:00')} hs</strong></div>
        <div class="receipt-row"><span>Período / Mes:</span> <strong>${escapeHtml(formatMonthYear(targetPayment.periodMonth))}</strong></div>
        <div class="receipt-row"><span>Número de Cuota:</span> <strong>Cuota ${escapeHtml(targetPayment.installmentNumber)}</strong></div>
        <div class="receipt-row"><span>Medio de Pago:</span> <strong>${escapeHtml(targetPayment.paymentMethod || 'Efectivo')}</strong></div>
        <div class="receipt-row"><span>Monto Total de Cuota:</span> <strong>${formatCurrency(baseCuota)}</strong></div>

        ${previousPaidBeforeThis > 0 ? `<div class="receipt-row"><span>Pagos a Cuenta Previos:</span> <strong>+ ${formatCurrency(previousPaidBeforeThis)}</strong></div>` : ''}
        ${punitoriosGen > 0 ? `<div class="receipt-row"><span>Punitorios por Mora:</span> <strong>+ ${formatCurrency(punitoriosGen)}</strong></div>` : ''}
        ${punitoriosWaived > 0 ? `<div class="receipt-row" style="color:#198754;"><span>Bonificación / Condonación Punitorios:</span> <strong>- ${formatCurrency(punitoriosWaived)}</strong></div>` : ''}

        <div class="receipt-row total-row">
            <span>MONTO ENTREGADO / COBRADO:</span>
            <span>${formatCurrency(totalCobrado)}</span>
        </div>

        ${pendingBalance > 0 ? `
            <div class="receipt-row" style="margin-top:8px; padding:6px 10px; background:#fef2f2; border:1px solid #fca5a5; border-radius:6px; color:#991b1b; font-weight:700;">
                <span>SALDO PENDIENTE CUOTA:</span>
                <span>${formatCurrency(pendingBalance)}</span>
            </div>
        ` : `
            <div class="receipt-row" style="margin-top:8px; padding:6px 10px; background:#f0fdf4; border:1px solid #86efac; border-radius:6px; color:#166534; font-weight:700;">
                <span>ESTADO CUOTA:</span>
                <span>TOTALMENTE CANCELADA</span>
            </div>
        `}

        ${targetPayment.notes ? `<div class="receipt-section-title"><i class="fas fa-sticky-note"></i> Observaciones</div><div class="receipt-row"><span>${escapeHtml(targetPayment.notes)}</span></div>` : ''}

        <div class="receipt-footer-notes">
            <p>Gracias por su pago — Palmares Efectivo en el Acto</p>
            <p style="font-size:0.7rem;margin-top:2px;opacity:0.8;">Atendido por: ${escapeHtml(targetPayment.user || 'Cobrador')} | Registrado el ${formatDate(targetPayment.date)}</p>
        </div>
    `;

    currentReceiptData = {
        client: targetClient,
        payment: targetPayment,
        totalCobrado: totalCobrado
    };

    openModal(document.getElementById('receiptModal'));
}

function shareReceiptWhatsApp() {
    if (!currentReceiptData || !currentReceiptData.client || !currentReceiptData.payment) {
        showToast('No hay información de comprobante para compartir', 'error');
        return;
    }

    const { client, payment, totalCobrado } = currentReceiptData;
    const msg = `Hola ${client.name}, te enviamos tu comprobante de pago Palmares Efectivo en el Acto:
• Comprobante N°: ${payment.receiptNumber || '-'}
• Importe Cobrado: ${formatCurrency(totalCobrado)}
• Fecha: ${formatDate(payment.date)}
• Período: ${formatMonthYear(payment.periodMonth)} (Cuota ${payment.installmentNumber})
¡Muchas gracias!`;

    if (navigator.share) {
        navigator.share({
            title: `Comprobante N° ${payment.receiptNumber}`,
            text: msg
        }).catch(() => {
            openWhatsAppDirect(client, msg);
        });
    } else {
        openWhatsAppDirect(client, msg);
    }
}

function openWhatsAppDirect(client, msg) {
    const rawPhone = client.phone || client.celular || '';
    const cleanPhone = rawPhone.replace(/\D/g, '');
    if (cleanPhone) {
        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    }
}

// ========================================
// HISTORIAL PERMANENTE DE PAGOS & EXPORTACIÓN
// ========================================

function openHistoryModal() {
    // Populate period filter select
    const histFilterPeriod = document.getElementById('histFilterPeriod');
    if (histFilterPeriod) {
        const periods = new Set();
        clients.forEach(c => {
            if (Array.isArray(c.payments)) {
                c.payments.forEach(p => {
                    if (p.periodMonth) periods.add(p.periodMonth);
                });
            }
        });
        const sorted = Array.from(periods).sort().reverse();
        histFilterPeriod.innerHTML = `<option value="all">Todos los Períodos</option>` +
            sorted.map(m => `<option value="${m}">${formatMonthYear(m)}</option>`).join('');
    }

    renderHistoryTable();
    openModal(document.getElementById('historyModal'));
}

function renderHistoryTable() {
    const tableBody = document.getElementById('historyTableBody');
    if (!tableBody) return;

    const qClient = (document.getElementById('histFilterClient')?.value || '').toLowerCase().trim();
    const period = document.getElementById('histFilterPeriod')?.value || 'all';
    const fromDate = document.getElementById('histFilterFrom')?.value || '';
    const toDate = document.getElementById('histFilterTo')?.value || '';
    const method = document.getElementById('histFilterMethod')?.value || 'all';
    const exportStatus = document.getElementById('histFilterExportStatus')?.value || 'all';

    let allPayments = [];
    clients.forEach(c => {
        if (Array.isArray(c.payments)) {
            c.payments.forEach(p => {
                allPayments.push({
                    payment: p,
                    client: c
                });
            });
        }
    });

    // Apply filters
    let filtered = allPayments.filter(({ payment, client }) => {
        if (qClient) {
            const matchesName = client.name.toLowerCase().includes(qClient);
            const matchesDni = (client.dni || '').toLowerCase().includes(qClient);
            if (!matchesName && !matchesDni) return false;
        }
        if (period !== 'all' && payment.periodMonth !== period) return false;
        if (fromDate && payment.date < fromDate) return false;
        if (toDate && payment.date > toDate) return false;
        if (method !== 'all' && payment.paymentMethod !== method) return false;
        if (exportStatus === 'pending' && payment.exported) return false;
        if (exportStatus === 'exported' && !payment.exported) return false;

        return true;
    });

    // Sort newest to oldest
    filtered.sort((a, b) => (b.payment.date + (b.payment.time || '')).localeCompare(a.payment.date + (a.payment.time || '')));

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:var(--text-muted);">No se encontraron pagos registrados con los filtros seleccionados.</td></tr>`;
        return;
    }

    tableBody.innerHTML = filtered.map(({ payment, client }) => {
        const expBadge = payment.exported ?
            `<span class="timeline-badge" style="background:#d1e7dd;color:#0f5132;"><i class="fas fa-check"></i> Exportado</span>` :
            `<span class="timeline-badge" style="background:#fff3cd;color:#856404;"><i class="fas fa-clock"></i> Pendiente</span>`;

        return `
            <tr>
                <td><strong>N.° ${escapeHtml(payment.receiptNumber || '00000000')}</strong></td>
                <td>${formatDate(payment.date)} ${escapeHtml(payment.time || '')}</td>
                <td><strong>${escapeHtml(client.name)}</strong>${client.dni ? `<br><small style="color:var(--text-muted);">DNI: ${escapeHtml(client.dni)}</small>` : ''}</td>
                <td>${formatMonthYear(payment.periodMonth)} (Cuota ${escapeHtml(payment.installmentNumber)})</td>
                <td><strong style="color:var(--success);">${formatCurrency(payment.amount)}</strong></td>
                <td><span class="badge" style="background:#f1f5f9;color:#334155;">${escapeHtml(payment.paymentMethod || 'Efectivo')}</span></td>
                <td>${expBadge}</td>
                <td>
                    <button type="button" class="btn-card-action btn-sm" onclick="showReceiptModal('${client.id}', '${payment.id}')" title="Ver / Imprimir Comprobante">
                        <i class="fas fa-file-invoice"></i> Comprobante
                    </button>
                    <button type="button" class="btn-card-action btn-sm" onclick="openClientHistoryModal('${client.id}')" title="Ver ficha e historial">
                        <i class="fas fa-folder-open"></i> Ficha
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ========================================
// PANEL DE GESTIONES DEL COBRADOR
// ========================================

function openGestionsHistoryModal() {
    renderGestionsHistoryTable();
    openModal(document.getElementById('gestionsHistoryModal'));
}

function formatGroupDateHeader(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const formatted = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const cap = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    return cap.replace(',', '');
}

function renderGestionsHistoryTable() {
    const container = document.getElementById('gestionsGroupedContainer');
    if (!container) return;

    updatePromisesStatuses();

    const qClient = (document.getElementById('gestFilterClient')?.value || '').toLowerCase().trim();
    const type = document.getElementById('gestFilterType')?.value || 'all';
    const result = document.getElementById('gestFilterResult')?.value || 'all';
    const fromDate = document.getElementById('gestFilterFrom')?.value || '';
    const toDate = document.getElementById('gestFilterTo')?.value || '';
    const pendingFollowUpOnly = document.getElementById('gestFilterPendingFollowUp')?.checked || false;

    const todayStr = getToday();

    // 1. Flat list of all gestiones across clients
    let allGestiones = [];
    clients.forEach(client => {
        if (Array.isArray(client.gestiones)) {
            client.gestiones.forEach(gestion => {
                let promise = null;
                if (gestion.promiseId && Array.isArray(client.promises)) {
                    promise = client.promises.find(p => p.id === gestion.promiseId) || null;
                }
                allGestiones.push({ gestion, client, promise });
            });
        }
    });

    // 2. Compute TODAY'S fixed header summary
    const summaryEl = document.getElementById('gestionsTodaySummary');
    if (summaryEl) {
        let todayCount = 0;
        let todayPromises = 0;
        let pendingFollowUps = 0;

        allGestiones.forEach(({ gestion, promise }) => {
            if (gestion.date === todayStr) {
                todayCount++;
                if (gestion.promiseId || gestion.result === 'Prometió pagar') {
                    todayPromises++;
                }
            }
            if (gestion.nextFollowUpDate && gestion.nextFollowUpDate >= todayStr) {
                if (!promise || promise.status === 'pendiente' || promise.status === 'vencida') {
                    pendingFollowUps++;
                }
            }
        });

        summaryEl.innerHTML = `
            <div class="summary-item"><i class="fas fa-calendar-day"></i> Hoy: <strong>${todayCount}</strong> ${todayCount === 1 ? 'gestión' : 'gestiones'}</div>
            <span class="summary-sep">·</span>
            <div class="summary-item"><i class="fas fa-handshake"></i> Con promesa: <strong>${todayPromises}</strong></div>
            <span class="summary-sep">·</span>
            <div class="summary-item"><i class="fas fa-clock"></i> Seguimiento pendiente: <strong>${pendingFollowUps}</strong></div>
        `;
    }

    // 3. Update filter indicator count
    let activeFiltersCount = 0;
    if (qClient) activeFiltersCount++;
    if (type !== 'all') activeFiltersCount++;
    if (result !== 'all') activeFiltersCount++;
    if (fromDate) activeFiltersCount++;
    if (toDate) activeFiltersCount++;
    if (pendingFollowUpOnly) activeFiltersCount++;

    const badgeEl = document.getElementById('gestionsFilterBadge');
    const toggleBtnEl = document.getElementById('gestionsFilterToggleBtn');
    if (badgeEl) {
        if (activeFiltersCount > 0) {
            badgeEl.textContent = activeFiltersCount;
            badgeEl.style.display = 'inline-flex';
        } else {
            badgeEl.style.display = 'none';
        }
    }
    if (toggleBtnEl) {
        if (activeFiltersCount > 0) {
            toggleBtnEl.classList.add('has-filters');
        } else {
            toggleBtnEl.classList.remove('has-filters');
        }
    }

    // 4. Filter gestiones
    let filtered = allGestiones.filter(({ gestion, client, promise }) => {
        if (qClient) {
            const matchesName = (client.name || '').toLowerCase().includes(qClient);
            const matchesDni = (client.dni || '').toLowerCase().includes(qClient);
            if (!matchesName && !matchesDni) return false;
        }
        if (type !== 'all' && gestion.type !== type) return false;
        if (result !== 'all' && gestion.result !== result) return false;
        if (fromDate && gestion.date < fromDate) return false;
        if (toDate && gestion.date > toDate) return false;

        if (pendingFollowUpOnly) {
            if (!gestion.nextFollowUpDate) return false;
            if (promise) {
                if (promise.status !== 'pendiente' && promise.status !== 'vencida') {
                    return false;
                }
            }
        }

        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:2.5rem 1rem;color:var(--text-muted);">
                <i class="fas fa-search" style="font-size:2.25rem;margin-bottom:0.75rem;opacity:0.4;"></i>
                <p>No se encontraron gestiones registradas con los filtros seleccionados.</p>
            </div>
        `;
        return;
    }

    // 4. Group filtered by gestion.date
    let groups = {};
    filtered.forEach(item => {
        const d = item.gestion.date || 'Sin fecha';
        if (!groups[d]) groups[d] = [];
        groups[d].push(item);
    });

    // Sort dates descending
    const sortedDates = Object.keys(groups).sort().reverse();

    container.innerHTML = sortedDates.map(dateKey => {
        const items = groups[dateKey];
        // Sort items by time descending within each day
        items.sort((a, b) => (b.gestion.time || '').localeCompare(a.gestion.time || ''));

        const dateHeaderStr = formatGroupDateHeader(dateKey);
        const countText = `${items.length} ${items.length === 1 ? 'gestión' : 'gestiones'}`;

        const cardsHtml = items.map(({ gestion, client, promise }) => {
            // Determine status badge
            let badgeHtml = '';
            if (promise) {
                let badgeBg = '#fff3cd';
                let badgeColor = '#856404';
                let icon = 'fa-clock';
                if (promise.status === 'cumplida') {
                    badgeBg = '#d1e7dd'; badgeColor = '#0f5132'; icon = 'fa-check-circle';
                } else if (promise.status === 'vencida' || promise.status === 'incumplida') {
                    badgeBg = '#f8d7da'; badgeColor = '#721c24'; icon = promise.status === 'vencida' ? 'fa-exclamation-circle' : 'fa-times-circle';
                }
                badgeHtml = `<span class="timeline-badge" style="background:${badgeBg};color:${badgeColor};"><i class="fas ${icon}"></i> ${promise.status.toUpperCase()}</span>`;
            } else {
                badgeHtml = `<span class="timeline-badge" style="background:#e0f2fe;color:#0369a1;"><i class="fas fa-headset"></i> ${escapeHtml(gestion.result)}</span>`;
            }

            const clientDniStr = client.dni ? ` (DNI: ${escapeHtml(client.dni)})` : '';

            return `
                <div class="gestion-card">
                    <div class="gestion-card-header">
                        <div>
                            <span class="gestion-card-client">${escapeHtml(client.name)}</span>
                            <span class="gestion-card-dni">${clientDniStr}</span>
                        </div>
                        <span class="gestion-card-time"><i class="fas fa-clock"></i> ${escapeHtml(gestion.time || '')} hs</span>
                    </div>

                    <div class="gestion-card-meta">
                        <span class="badge" style="background:#f1f5f9;color:#334155;"><i class="fas fa-tag"></i> ${escapeHtml(gestion.type)}</span>
                        ${promise ? `<span class="badge" style="background:#f8fafc;color:#475569;">Orig: ${escapeHtml(gestion.result)}</span>` : ''}
                        ${badgeHtml}
                    </div>

                    ${gestion.observations ? `<div class="gestion-card-body">"${escapeHtml(gestion.observations)}"</div>` : ''}

                    ${gestion.nextAction ? `
                        <div class="gestion-card-next">
                            <i class="fas fa-arrow-right"></i>
                            <span><strong>Próx. acción:</strong> ${escapeHtml(gestion.nextAction)}${gestion.nextFollowUpDate ? ` (${formatDate(gestion.nextFollowUpDate)})` : ''}</span>
                        </div>
                    ` : ''}

                    <div class="gestion-card-actions">
                        <button type="button" class="btn-card-action btn-sm" onclick="openClientHistoryModal('${client.id}')" title="Ver ficha e historial del cliente">
                            <i class="fas fa-folder-open"></i> Ver Ficha
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="gestion-day-group">
                <div class="gestion-day-header">
                    <span><i class="fas fa-calendar-day"></i> ${escapeHtml(dateHeaderStr)}</span>
                    <span class="gestion-day-count">${countText}</span>
                </div>
                ${cardsHtml}
            </div>
        `;
    }).join('');
}

function openExportModal() {
    const expPeriodMonth = document.getElementById('expPeriodMonth');
    if (expPeriodMonth) {
        const periods = new Set();
        clients.forEach(c => {
            if (Array.isArray(c.payments)) {
                c.payments.forEach(p => {
                    if (p.periodMonth) periods.add(p.periodMonth);
                });
            }
        });
        const sorted = Array.from(periods).sort().reverse();
        expPeriodMonth.innerHTML = `<option value="all">Todos los Períodos</option>` +
            sorted.map(m => `<option value="${m}">${formatMonthYear(m)}</option>`).join('');
    }

    const expDateFrom = document.getElementById('expDateFrom');
    const expDateTo = document.getElementById('expDateTo');
    if (expDateFrom) expDateFrom.value = '';
    if (expDateTo) expDateTo.value = '';

    updateExportMatchCount();
    openModal(document.getElementById('exportModal'));
}

function getExportFilteredPayments() {
    const fromDate = document.getElementById('expDateFrom')?.value || '';
    const toDate = document.getElementById('expDateTo')?.value || '';
    const period = document.getElementById('expPeriodMonth')?.value || 'all';
    const scope = document.getElementById('expExportScope')?.value || 'pending';

    let matches = [];
    clients.forEach(c => {
        if (Array.isArray(c.payments)) {
            c.payments.forEach(p => {
                if (fromDate && p.date < fromDate) return;
                if (toDate && p.date > toDate) return;
                if (period !== 'all' && p.periodMonth !== period) return;
                if (scope === 'pending' && p.exported) return;

                matches.push({ payment: p, client: c });
            });
        }
    });

    return matches;
}

function updateExportMatchCount() {
    const matches = getExportFilteredPayments();
    const matchCountEl = document.getElementById('expMatchCount');
    if (matchCountEl) matchCountEl.textContent = matches.length;
}

function handleStartExport(e) {
    e.preventDefault();

    const matches = getExportFilteredPayments();
    if (matches.length === 0) {
        showToast('No hay pagos que coincidan con los filtros seleccionados para exportar', 'error');
        return;
    }

    const format = document.getElementById('expFormat')?.value || 'csv';

    if (format === 'json') {
        const exportDataList = matches.map(({ payment, client }) => ({
            id_pago: payment.id,
            id_comprobante: payment.receiptNumber,
            fecha: payment.date,
            hora: payment.time || '12:00',
            cliente_id: client.id,
            cliente_nombre: client.name,
            dni: client.dni || '',
            numero_sucursal: client.branchNumber || '',
            numero_solicitud: client.requestNumber || '',
            periodo: payment.periodMonth,
            numero_cuota: payment.installmentNumber,
            importe_cuota: payment.installmentAmount || payment.amount,
            punitorios_generados: payment.punitorios || 0,
            punitorios_condonados: payment.punitoriosWaived || 0,
            importe_cobrado: payment.amount,
            importe_entregado: payment.amountGiven || 0,
            medio_pago: payment.paymentMethod || 'Efectivo',
            dias_atraso: payment.daysOverdue || 0,
            observaciones: payment.notes || '',
            usuario_registro: payment.user || 'Cobrador'
        }));

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportDataList, null, 2));
        const anchor = document.createElement('a');
        anchor.setAttribute("href", dataStr);
        anchor.setAttribute("download", `export_pagos_palmares_${getToday()}.json`);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

    } else {
        // CSV Format
        const headers = [
            "ID Pago", "N° Comprobante", "Fecha", "Hora", "Cliente", "DNI",
            "N° Sucursal", "N° Solicitud", "Período", "N° Cuota", "Importe Cuota",
            "Punitorios", "Punitorios Condonados", "Importe Cobrado", "Medio de Pago",
            "Días Atraso", "Observaciones", "Usuario"
        ];

        let csvRows = [headers.join(';')];

        matches.forEach(({ payment, client }) => {
            const row = [
                `"${payment.id}"`,
                `"${payment.receiptNumber || ''}"`,
                `"${payment.date}"`,
                `"${payment.time || '12:00'}"`,
                `"${(client.name || '').replace(/"/g, '""')}"`,
                `"${client.dni || ''}"`,
                `"${client.branchNumber || ''}"`,
                `"${client.requestNumber || ''}"`,
                `"${payment.periodMonth || ''}"`,
                `"${payment.installmentNumber || ''}"`,
                payment.installmentAmount || payment.amount || 0,
                payment.punitorios || 0,
                payment.punitoriosWaived || 0,
                payment.amount || 0,
                `"${payment.paymentMethod || 'Efectivo'}"`,
                payment.daysOverdue || 0,
                `"${(payment.notes || '').replace(/"/g, '""')}"`,
                `"${payment.user || 'Cobrador'}"`
            ];
            csvRows.push(row.join(';'));
        });

        const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csvRows.join('\n'));
        const anchor = document.createElement('a');
        anchor.setAttribute("href", csvContent);
        anchor.setAttribute("download", `export_pagos_palmares_${getToday()}.csv`);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }

    // Mark exported status
    const exportTime = new Date().toISOString();
    matches.forEach(({ payment }) => {
        payment.exported = true;
        payment.exportedAt = exportTime;
    });

    saveClients();
    renderClients();

    showToast(`${matches.length} pagos exportados correctamente y marcados como EXPORTADOS`, 'success');
    closeModalFn(document.getElementById('exportModal'));
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
    if (els.clientDomicilio) els.clientDomicilio.value = '';
    if (els.clientLocalidad) els.clientLocalidad.value = '';
    if (els.clientZona) els.clientZona.value = '';
    if (els.clientCpos) els.clientCpos.value = '';
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
    if (els.clientDomicilio) els.clientDomicilio.value = client.domicilio || '';
    if (els.clientLocalidad) els.clientLocalidad.value = client.localidad || '';
    if (els.clientZona) els.clientZona.value = client.zona || '';
    if (els.clientCpos) els.clientCpos.value = client.cpos || '';
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
        domicilio: els.clientDomicilio ? els.clientDomicilio.value.trim() : '',
        localidad: els.clientLocalidad ? els.clientLocalidad.value.trim() : '',
        zona: els.clientZona ? els.clientZona.value.trim() : '',
        cpos: els.clientCpos ? els.clientCpos.value.trim() : '',
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

function getPreviousPaidForInstallment(client, periodMonth, installmentNumber) {
    if (!client || !Array.isArray(client.payments)) return 0;
    const instStr = `${installmentNumber || 1}`;
    let total = 0;
    client.payments.forEach(p => {
        const pInst = (p.installmentNumber || '').toString().trim();
        const isSameInst = pInst === instStr || pInst.startsWith(instStr + '/') || pInst.startsWith(instStr + ' ');
        const isSamePeriod = !periodMonth || !p.periodMonth || p.periodMonth === periodMonth;
        if (isSameInst && isSamePeriod) {
            total += (p.amount || 0);
        }
    });
    return total;
}

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

    // Check for active promise to auto-link
    const paymentPromiseId = document.getElementById('paymentPromiseId');
    const promiseLinkedAlert = document.getElementById('promiseLinkedAlert');
    let foundPromise = null;

    if (Array.isArray(client.promises)) {
        foundPromise = client.promises.find(p => p.status === 'pendiente' || p.status === 'vencida');
    }

    if (foundPromise) {
        if (paymentPromiseId) paymentPromiseId.value = foundPromise.id;
        if (promiseLinkedAlert) {
            promiseLinkedAlert.style.display = 'block';
            promiseLinkedAlert.innerHTML = `<i class="fas fa-handshake"></i> <strong>Promesa detectada:</strong> Prometió ${formatCurrency(foundPromise.promisedAmount)} el ${formatDate(foundPromise.promisedDate)} via ${escapeHtml(foundPromise.paymentMethod)}. Al guardar se marcará como <strong>CUMPLIDA</strong>.`;
        }
    } else {
        if (paymentPromiseId) paymentPromiseId.value = '';
        if (promiseLinkedAlert) promiseLinkedAlert.style.display = 'none';
    }

    const methodSelect = document.getElementById('paymentMethodSelect');
    if (methodSelect) methodSelect.value = foundPromise ? foundPromise.paymentMethod : 'Efectivo';

    const periodMonth = client.periodMonth || getToday().substring(0, 7);
    const instNum = client.installmentNumber || 1;
    const previousPaid = getPreviousPaidForInstallment(client, periodMonth, instNum);
    const remainingCuota = Math.max(0, client.installmentAmount - previousPaid);

    const defaultAmountToPay = (previousPaid > 0 && remainingCuota > 0) ? remainingCuota : client.installmentAmount;

    els.paidAmount.value = defaultAmountToPay ? defaultAmountToPay.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    els.amountGiven.value = '';

    if (previousPaid > 0 || client.paymentStatus === 'partial') {
        els.paymentType.value = remainingCuota > 0 ? 'partial' : 'total';
    } else {
        els.paymentType.value = 'total';
    }

    const punitoriosGeneratedEl = document.getElementById('punitoriosGenerated');
    const punitoriosWaivedEl = document.getElementById('punitoriosWaived');
    const paymentTimeEl = document.getElementById('paymentTime');
    const paymentUserEl = document.getElementById('paymentUser');

    const calculatedPenalty = (client.paymentStatus === 'overdue' && client.daysOverdue > 0) ? calculatePunitorios(client.installmentAmount, client.daysOverdue, client.penaltyRate) : 0;
    if (punitoriosGeneratedEl) punitoriosGeneratedEl.value = calculatedPenalty.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (punitoriosWaivedEl) punitoriosWaivedEl.value = '0,00';
    if (paymentTimeEl) paymentTimeEl.value = getCurrentTime();
    if (paymentUserEl && !paymentUserEl.value) paymentUserEl.value = 'Cobrador';

    els.hasPaid.checked = client.paymentStatus === 'paid';
    els.isOverdue.checked = client.isOverdue;
    els.daysOverdue.value = client.daysOverdue || 1;
    els.paymentDate.value = getToday();
    els.paymentPeriodMonth.value = periodMonth;
    els.paymentInstallmentNumber.value = instText;
    els.paymentNotes.value = '';

    updatePaymentCalculationBox(client);
    renderPaymentHistory(client);
    toggleOverdueFields();

    // Collapse extra details by default (Modo Cobro Rápido)
    const paymentMoreDetails = document.getElementById('paymentMoreDetails');
    const toggleBtnText = document.getElementById('togglePaymentDetailsText');
    const toggleBtn = document.getElementById('togglePaymentDetailsBtn');
    if (paymentMoreDetails) paymentMoreDetails.style.display = 'none';
    if (toggleBtnText) toggleBtnText.textContent = 'Ver más detalles';
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('i');
        if (icon) icon.className = 'fas fa-chevron-down';
    }

    openModal(els.paymentModal);
}

function updatePaymentCalculationBox(client) {
    if (!els.paymentCalculationBox) return;

    const periodMonth = els.paymentPeriodMonth ? els.paymentPeriodMonth.value : (client.periodMonth || getToday().substring(0, 7));
    const instNum = client.installmentNumber || 1;
    const previousPaid = getPreviousPaidForInstallment(client, periodMonth, instNum);

    const fullCuota = client.installmentAmount || 0;
    const enteredPaid = parseCurrencyInput(els.paidAmount.value);
    const enteredGiven = parseCurrencyInput(els.amountGiven.value);

    const isOverdueChecked = els.isOverdue ? els.isOverdue.checked : client.isOverdue;
    const daysOverdueVal = els.daysOverdue ? (parseInt(els.daysOverdue.value) || 0) : client.daysOverdue;

    const punitoriosGen = isOverdueChecked && daysOverdueVal > 0 ? calculatePunitorios(fullCuota, daysOverdueVal, client.penaltyRate) : 0;
    const punitoriosWaived = parseCurrencyInput(document.getElementById('punitoriosWaived') ? document.getElementById('punitoriosWaived').value : 0);
    const netPenalty = Math.max(0, punitoriosGen - punitoriosWaived);

    const totalRequiredForFull = fullCuota + netPenalty;
    const remainingToComplete = Math.max(0, totalRequiredForFull - previousPaid);

    let currentCollected = 0;
    if (enteredGiven > 0 && enteredGiven <= remainingToComplete) {
        currentCollected = enteredGiven;
    } else if (enteredPaid > 0) {
        currentCollected = enteredPaid;
    } else if (enteredGiven > 0) {
        currentCollected = enteredGiven;
    }

    const newAccumulatedTotal = previousPaid + currentCollected;
    const pendingBalance = Math.max(0, totalRequiredForFull - newAccumulatedTotal);

    let html = `<div class="calc-row"><span>Monto Total de Cuota:</span> <strong>${formatCurrency(fullCuota)}</strong></div>`;

    if (previousPaid > 0) {
        html += `<div class="calc-row" style="color:#0284c7; font-weight:600;"><span>Pagos a cuenta previos para esta cuota:</span> <strong>+ ${formatCurrency(previousPaid)}</strong></div>`;
    }

    if (punitoriosGen > 0) {
        html += `<div class="calc-row penalty"><span>Punitorios Generados (${daysOverdueVal} días, ${client.penaltyRate || 1.0}%/día):</span> <strong>+ ${formatCurrency(punitoriosGen)}</strong></div>`;
        if (punitoriosWaived > 0) {
            html += `<div class="calc-row" style="color:var(--success);"><span>Punitorios Condonados:</span> <strong>- ${formatCurrency(punitoriosWaived)}</strong></div>`;
        }
    }

    html += `<div class="calc-row total"><span>Monto Entregado / Cobrado en esta transacción:</span> <strong style="color:var(--success); font-size:1.05rem;">${formatCurrency(currentCollected)}</strong></div>`;

    if (previousPaid > 0) {
        html += `<div class="calc-row"><span>Total Acumulado Abonado:</span> <strong>${formatCurrency(newAccumulatedTotal)}</strong></div>`;
    }

    if (pendingBalance > 0) {
        html += `<div class="calc-row partial" style="background:rgba(239,68,68,0.12); padding:8px 12px; border-radius:6px; border:1px solid rgba(239,68,68,0.35); margin-top:6px;">
            <span style="color:#ef4444; font-weight:700;"><i class="fas fa-exclamation-circle"></i> PAGO A CUENTA — Saldo Pendiente:</span>
            <strong style="color:#ef4444; font-size:1.1rem;">${formatCurrency(pendingBalance)}</strong>
        </div>`;
    } else {
        html += `<div class="calc-row" style="background:rgba(34,197,94,0.12); padding:8px 12px; border-radius:6px; border:1px solid rgba(34,197,94,0.35); margin-top:6px;">
            <span style="color:#22c55e; font-weight:700;"><i class="fas fa-check-circle"></i> CUOTA PAGADA EN SU TOTALIDAD</span>
        </div>`;
    }

    if (enteredGiven > 0 && enteredGiven > remainingToComplete) {
        const change = enteredGiven - remainingToComplete;
        html += `<div class="calc-row change"><span>Vuelto a entregar al cliente:</span> <strong>${formatCurrency(change)}</strong></div>`;
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
                <div class="history-item-info">
                    <span class="hist-date"><i class="fas fa-calendar-alt"></i> ${formatDate(p.date)} — Comp. N.° ${escapeHtml(p.receiptNumber)}</span>
                    <span class="hist-period"><i class="fas fa-layer-group"></i> ${escapeHtml(mLabel)}${instLabel} • ${escapeHtml(p.paymentMethod || 'Efectivo')}</span>
                    ${p.notes ? `<div class="hist-note">"${escapeHtml(p.notes)}"</div>` : ''}
                </div>
                <div class="history-item-actions">
                    <span class="hist-amount">${formatCurrency(p.amount)}</span>
                    <button type="button" class="btn-card-action btn-sm" onclick="showReceiptModal('${client.id}', '${p.id}')" title="Ver / Imprimir Comprobante">
                        <i class="fas fa-file-invoice"></i> Ver
                    </button>
                </div>
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

    let pType = els.paymentType.value;
    const methodSelect = document.getElementById('paymentMethodSelect');
    const paymentMethodVal = methodSelect ? methodSelect.value : 'Efectivo';
    const isOverdue = els.isOverdue.checked;
    const daysOverdue = parseInt(els.daysOverdue.value) || 0;
    const paymentDate = els.paymentDate.value || getToday();
    const paymentTime = document.getElementById('paymentTime') ? document.getElementById('paymentTime').value : getCurrentTime();
    const paidAmountVal = parseCurrencyInput(els.paidAmount.value);
    const amountGivenVal = parseCurrencyInput(els.amountGiven.value);
    const payPeriodMonth = els.paymentPeriodMonth.value || client.periodMonth || paymentDate.substring(0, 7);
    const payInstallmentNumber = els.paymentInstallmentNumber.value.trim() || `${client.installmentNumber || 1}`;
    const payNote = els.paymentNotes.value.trim();
    const paymentUserVal = document.getElementById('paymentUser') ? document.getElementById('paymentUser').value.trim() : 'Cobrador';

    const punitoriosGen = parseCurrencyInput(document.getElementById('punitoriosGenerated') ? document.getElementById('punitoriosGenerated').value : 0);
    const punitoriosWaived = parseCurrencyInput(document.getElementById('punitoriosWaived') ? document.getElementById('punitoriosWaived').value : 0);
    const netPenalty = Math.max(0, punitoriosGen - punitoriosWaived);

    // Exact amount delivered / collected in this transaction
    let currentCollected = 0;
    if (amountGivenVal > 0 && paidAmountVal > 0) {
        currentCollected = Math.min(amountGivenVal, paidAmountVal);
    } else if (amountGivenVal > 0) {
        currentCollected = amountGivenVal;
    } else if (paidAmountVal > 0) {
        currentCollected = paidAmountVal;
    } else {
        currentCollected = client.installmentAmount || 0;
    }

    const previousPaid = getPreviousPaidForInstallment(client, payPeriodMonth, client.installmentNumber);
    const fullCuotaTotal = (client.installmentAmount || currentCollected) + netPenalty;
    const totalAccumulated = previousPaid + currentCollected;

    let status = 'pending';
    if (totalAccumulated >= fullCuotaTotal && fullCuotaTotal > 0) {
        status = 'paid';
        pType = 'total';
    } else {
        status = 'partial';
        pType = 'partial';
    }

    client.isOverdue = (status === 'overdue');
    client.daysOverdue = (status === 'overdue') ? daysOverdue : 0;

    if (payPeriodMonth) client.periodMonth = payPeriodMonth;

    const isLastInstallment = status === 'paid'
        && typeof client.installmentNumber === 'number'
        && client.totalInstallments
        && client.installmentNumber >= client.totalInstallments;

    if (status === 'paid' && typeof client.installmentNumber === 'number' && !isLastInstallment) {
        // Avanza a la cuota siguiente y adelanta el período al mes que viene.
        // El estado vuelve a 'pending' porque la cuota NUEVA todavía no está pagada
        // (el pago que se acaba de hacer ya quedó guardado en client.payments).
        client.installmentNumber += 1;
        client.periodMonth = getNextPeriodMonth(payPeriodMonth);
        client.paymentStatus = 'pending';
    } else {
        // Última cuota saldada, o pago parcial: se deja el status calculated arriba.
        client.paymentStatus = status;
    }

    const receiptNum = generateReceiptNumber();
    let linkedPromiseId = document.getElementById('paymentPromiseId') ? document.getElementById('paymentPromiseId').value : null;

    if (!linkedPromiseId && Array.isArray(client.promises)) {
        const pendingPr = client.promises.find(pr => pr.status === 'pendiente' || pr.status === 'vencida');
        if (pendingPr) linkedPromiseId = pendingPr.id;
    }

    const newPayment = {
        id: generateId(),
        receiptNumber: receiptNum,
        clientId: client.id,
        clientName: client.name,
        dni: client.dni || '',
        branchNumber: client.branchNumber || '',
        requestNumber: client.requestNumber || '',
        date: paymentDate,
        time: paymentTime,
        periodMonth: payPeriodMonth,
        installmentNumber: payInstallmentNumber,
        installmentAmount: client.installmentAmount || currentCollected,
        punitorios: punitoriosGen,
        punitoriosWaived: punitoriosWaived,
        amount: currentCollected,
        amountGiven: amountGivenVal || currentCollected,
        paymentMethod: paymentMethodVal,
        paymentType: pType,
        daysOverdue: daysOverdue,
        notes: payNote,
        user: paymentUserVal || 'Cobrador',
        exported: false,
        exportedAt: null,
        promiseId: linkedPromiseId,
        createdAt: new Date().toISOString()
    };

    if (Array.isArray(client.promises)) {
        client.promises.forEach(pr => {
            if (pr.id === linkedPromiseId || pr.status === 'pendiente' || pr.status === 'vencida') {
                pr.status = 'cumplida';
                pr.paymentId = newPayment.id;
            }
        });
    }

    if (!client.payments) client.payments = [];
    client.payments.push(newPayment);
    client.lastPaymentDate = paymentDate;

    updateOverdueStatuses();
    saveClients();
    renderClients();

    closeModalFn(els.paymentModal);
    showToast(`Pago ${pType === 'partial' ? 'a cuenta' : 'total'} registrado con éxito (Comprobante N.° ${receiptNum})`, 'success');

    // Show printable receipt modal automatically
    showReceiptModal(client.id, newPayment.id);
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

            // Sync daily dashboard card selection
            document.querySelectorAll('.daily-card.clickable').forEach(c => c.classList.remove('selected'));
            const matchingCard = document.querySelector(`.daily-card.clickable[data-quick-filter="${currentStatusFilter}"]`);
            if (matchingCard) matchingCard.classList.add('selected');

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
            const headerMonthSelect = document.getElementById('headerMonthSelect');
            if (headerMonthSelect) headerMonthSelect.value = e.target.value;
            displayLimit = 20;
            renderClients();
        });
    }

    const headerMonthSelect = document.getElementById('headerMonthSelect');
    if (headerMonthSelect) {
        headerMonthSelect.addEventListener('change', (e) => {
            currentMonthFilter = e.target.value;
            if (els.monthFilterSelect) els.monthFilterSelect.value = e.target.value;
            displayLimit = 20;
            renderClients();
        });
    }

    // Quick Filter click handlers on Daily Dashboard cards
    document.querySelectorAll('.daily-card.clickable[data-quick-filter]').forEach(card => {
        card.addEventListener('click', () => {
            const filterKey = card.dataset.quickFilter;
            currentStatusFilter = filterKey;

            // Sync selected card UI
            document.querySelectorAll('.daily-card.clickable').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            // Sync filter chips UI
            document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
            const matchingChip = document.querySelector(`[data-status="${filterKey}"]`);
            if (matchingChip) matchingChip.classList.add('active');

            displayLimit = 20;
            renderClients();

            // Scroll down smoothly to toolbar/clients container
            const toolbarEl = document.querySelector('.toolbar');
            if (toolbarEl) toolbarEl.scrollIntoView({ behavior: 'smooth' });
        });
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

    // Gestiones & Client History Modal Event Listeners
    const gestionForm = document.getElementById('gestionForm');
    if (gestionForm) gestionForm.addEventListener('submit', handleSaveGestion);

    const closeGestionModal = document.getElementById('closeGestionModal');
    if (closeGestionModal) closeGestionModal.addEventListener('click', () => closeModalFn(document.getElementById('gestionModal')));

    const cancelGestionBtn = document.getElementById('cancelGestionBtn');
    if (cancelGestionBtn) cancelGestionBtn.addEventListener('click', () => closeModalFn(document.getElementById('gestionModal')));

    const gestionResult = document.getElementById('gestionResult');
    if (gestionResult) {
        gestionResult.addEventListener('change', (e) => {
            const promiseAutoFields = document.getElementById('promiseAutoFields');
            if (promiseAutoFields) {
                promiseAutoFields.style.display = (e.target.value === 'Prometió pagar') ? 'block' : 'none';
            }
        });
    }

    const closeClientHistoryModal = document.getElementById('closeClientHistoryModal');
    if (closeClientHistoryModal) closeClientHistoryModal.addEventListener('click', () => closeModalFn(document.getElementById('clientHistoryModal')));

    const closeClientHistoryBtn = document.getElementById('closeClientHistoryBtn');
    if (closeClientHistoryBtn) closeClientHistoryBtn.addEventListener('click', () => closeModalFn(document.getElementById('clientHistoryModal')));

    // Promises Event Listeners
    const promiseForm = document.getElementById('promiseForm');
    if (promiseForm) promiseForm.addEventListener('submit', handleSavePromise);

    const closePromiseModal = document.getElementById('closePromiseModal');
    if (closePromiseModal) closePromiseModal.addEventListener('click', () => closeModalFn(document.getElementById('promiseModal')));

    const cancelPromiseBtn = document.getElementById('cancelPromiseBtn');
    if (cancelPromiseBtn) cancelPromiseBtn.addEventListener('click', () => closeModalFn(document.getElementById('promiseModal')));

    // Receipt Modal Event Listeners
    const printReceiptBtn = document.getElementById('printReceiptBtn');
    if (printReceiptBtn) printReceiptBtn.addEventListener('click', () => window.print());

    const shareReceiptWaBtn = document.getElementById('shareReceiptWaBtn');
    if (shareReceiptWaBtn) shareReceiptWaBtn.addEventListener('click', shareReceiptWhatsApp);

    const closeReceiptModal = document.getElementById('closeReceiptModal');
    if (closeReceiptModal) closeReceiptModal.addEventListener('click', () => closeModalFn(document.getElementById('receiptModal')));

    const closeReceiptBtn = document.getElementById('closeReceiptBtn');
    if (closeReceiptBtn) closeReceiptBtn.addEventListener('click', () => closeModalFn(document.getElementById('receiptModal')));

    // History Modal Event Listeners
    const historyNavBtn = document.getElementById('historyNavBtn');
    if (historyNavBtn) historyNavBtn.addEventListener('click', openHistoryModal);

    const closeHistoryModal = document.getElementById('closeHistoryModal');
    if (closeHistoryModal) closeHistoryModal.addEventListener('click', () => closeModalFn(document.getElementById('historyModal')));

    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', () => closeModalFn(document.getElementById('historyModal')));

    ['histFilterClient', 'histFilterPeriod', 'histFilterFrom', 'histFilterTo', 'histFilterMethod', 'histFilterExportStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', renderHistoryTable);
            el.addEventListener('change', renderHistoryTable);
        }
    });

    // Gestions History Modal Event Listeners
    const gestionsNavBtn = document.getElementById('gestionsNavBtn');
    if (gestionsNavBtn) gestionsNavBtn.addEventListener('click', openGestionsHistoryModal);

    const closeGestionsHistoryModal = document.getElementById('closeGestionsHistoryModal');
    if (closeGestionsHistoryModal) closeGestionsHistoryModal.addEventListener('click', () => closeModalFn(document.getElementById('gestionsHistoryModal')));

    const closeGestionsHistoryBtn = document.getElementById('closeGestionsHistoryBtn');
    if (closeGestionsHistoryBtn) closeGestionsHistoryBtn.addEventListener('click', () => closeModalFn(document.getElementById('gestionsHistoryModal')));

    const gestionsFilterToggleBtn = document.getElementById('gestionsFilterToggleBtn');
    const gestionsFilterPanel = document.getElementById('gestionsFilterPanel');
    if (gestionsFilterToggleBtn && gestionsFilterPanel) {
        gestionsFilterToggleBtn.addEventListener('click', () => {
            gestionsFilterPanel.classList.toggle('open');
            gestionsFilterToggleBtn.classList.toggle('active');
        });
    }

    ['gestFilterClient', 'gestFilterType', 'gestFilterResult', 'gestFilterFrom', 'gestFilterTo', 'gestFilterPendingFollowUp'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', renderGestionsHistoryTable);
            el.addEventListener('change', renderGestionsHistoryTable);
        }
    });

    // Export Modal Event Listeners
    const exportNavBtn = document.getElementById('exportNavBtn');
    if (exportNavBtn) exportNavBtn.addEventListener('click', openExportModal);

    const closeExportModal = document.getElementById('closeExportModal');
    if (closeExportModal) closeExportModal.addEventListener('click', () => closeModalFn(document.getElementById('exportModal')));

    const cancelExportBtn = document.getElementById('cancelExportBtn');
    if (cancelExportBtn) cancelExportBtn.addEventListener('click', () => closeModalFn(document.getElementById('exportModal')));

    ['expDateFrom', 'expDateTo', 'expPeriodMonth', 'expExportScope'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateExportMatchCount);
    });

    const exportPaymentsForm = document.getElementById('exportPaymentsForm');
    if (exportPaymentsForm) exportPaymentsForm.addEventListener('submit', handleStartExport);

    const togglePaymentDetailsBtn = document.getElementById('togglePaymentDetailsBtn');
    if (togglePaymentDetailsBtn) {
        togglePaymentDetailsBtn.addEventListener('click', () => {
            const details = document.getElementById('paymentMoreDetails');
            const text = document.getElementById('togglePaymentDetailsText');
            const icon = togglePaymentDetailsBtn.querySelector('i');
            if (details) {
                const isHidden = details.style.display === 'none' || !details.style.display;
                details.style.display = isHidden ? 'block' : 'none';
                if (text) text.textContent = isHidden ? 'Ver menos detalles' : 'Ver más detalles';
                if (icon) icon.className = isHidden ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            }
        });
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
        }
    });
    els.resetDemoBtn.addEventListener('click', resetDemoData);

    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const closeImportPreviewModalBtn = document.getElementById('closeImportPreviewModal');
    const confirmImportBtn = document.getElementById('confirmImportBtn');

    if (cancelImportBtn) cancelImportBtn.addEventListener('click', closeImportPreviewModal);
    if (closeImportPreviewModalBtn) closeImportPreviewModalBtn.addEventListener('click', closeImportPreviewModal);
    if (confirmImportBtn) {
        confirmImportBtn.addEventListener('click', () => {
            if (!pendingImportData || !pendingImportData.parsedClients) return;
            const { updatedCount, addedCount } = mergeMonthlyPortfolio(pendingImportData.parsedClients);
            showToast(`Importación completada: ${updatedCount} actualizados, ${addedCount} nuevos agregados. ¡Gestiones y pagos intactos!`, 'success');
            closeImportPreviewModal();
        });
    }

    const closeAddressModalBtn = document.getElementById('closeAddressModal');
    const closeAddressBtn = document.getElementById('closeAddressBtn');
    const copyAddressBtn = document.getElementById('copyAddressBtn');
    const openMapsBtn = document.getElementById('openMapsBtn');
    const dailyRouteBtn = document.getElementById('dailyRouteBtn');

    if (closeAddressModalBtn) closeAddressModalBtn.addEventListener('click', closeAddressModal);
    if (closeAddressBtn) closeAddressBtn.addEventListener('click', closeAddressModal);
    if (copyAddressBtn) copyAddressBtn.addEventListener('click', copyAddressToClipboard);
    if (openMapsBtn) openMapsBtn.addEventListener('click', openAddressInGoogleMaps);
    if (dailyRouteBtn) dailyRouteBtn.addEventListener('click', openDailyRoute);

    const togglePortfolioKpisBtn = document.getElementById('togglePortfolioKpisBtn');
    if (togglePortfolioKpisBtn) {
        togglePortfolioKpisBtn.addEventListener('click', () => {
            const section = document.getElementById('portfolioKpisSection');
            const text = document.getElementById('togglePortfolioKpisText');
            if (section) {
                const isHidden = section.style.display === 'none' || !section.style.display;
                section.style.display = isHidden ? 'block' : 'none';
                if (text) {
                    text.innerHTML = isHidden
                        ? '<i class="fas fa-chevron-up"></i> Ocultar resumen'
                        : '<i class="fas fa-chevron-down"></i> Ver resumen de cartera';
                }
            }
        });
    }

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
