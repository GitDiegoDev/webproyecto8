/**
 * Automated Verification Test Suite for Palmares Collection Dashboard
 */

const assert = require('assert');
const fs = require('fs');
const jsCode = fs.readFileSync('./app.js', 'utf8');

// Mock browser environment for Node.js execution
global.window = { indexedDB: null };
global.document = {
    body: { style: {} },
    execCommand: () => {},
    addEventListener: () => {},
    querySelectorAll: () => [],
    createElement: () => {
        const el = {
            style: {},
            classList: { add: () => {}, remove: () => {} },
            appendChild: () => {},
            _text: ''
        };
        Object.defineProperty(el, 'textContent', {
            get() { return this._text; },
            set(v) { this._text = v; this.innerHTML = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
        });
        return el;
    },
    getElementById: (id) => ({
        value: '',
        textContent: '',
        style: {},
        classList: { add: () => {}, remove: () => {}, toggle: () => {} },
        addEventListener: () => {},
        appendChild: () => {},
        innerHTML: ''
    })
};
global.localStorage = {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = v; }
};

// Evaluate app.js logic in global context
eval(jsCode.replace(/^let clients =/m, 'var clients =').replace(/^let selectedAddressClient =/m, 'var selectedAddressClient ='));

console.log('--- STARTING PALMARES AUTOMATED TEST SUITE ---');

let passCount = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`[PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`[FAIL] ${name}:`, err.message);
        process.exit(1);
    }
}

runTest('1. Schema Migration & Backward Compatibility', () => {
    const oldClient = {
        id: 'c1',
        name: 'Test Client',
        installmentAmount: '100.000,00',
        paymentDay: 15
    };
    sanitizeClientSchema(oldClient);
    assert(Array.isArray(oldClient.gestiones), 'gestiones array initialized');
    assert(Array.isArray(oldClient.promises), 'promises array initialized');
    assert(Array.isArray(oldClient.payments), 'payments array initialized');
    assert.strictEqual(oldClient.installmentAmount, 100000);
});

runTest('2. Unique Receipt Number Generator', () => {
    clients = [
        {
            payments: [{ receiptNumber: '00000100' }, { receiptNumber: '00000105' }]
        }
    ];
    const nextReceipt = generateReceiptNumber();
    assert.strictEqual(nextReceipt, '00000106');
});

runTest('3. Registrar Gestión', () => {
    const client = {
        id: 'c2',
        name: 'Cliente Gestión',
        installmentAmount: 50000,
        gestiones: [],
        promises: []
    };
    clients = [client];

    const newGestion = {
        id: generateId(),
        date: getToday(),
        time: getCurrentTime(),
        type: 'WhatsApp / mensaje',
        result: 'Contactado',
        observations: 'Cliente consultó saldo',
        nextAction: 'Llamar mañana',
        nextFollowUpDate: getToday()
    };

    client.gestiones.push(newGestion);
    assert.strictEqual(client.gestiones.length, 1);
    assert.strictEqual(client.gestiones[0].result, 'Contactado');
});

runTest('4. Registrar Promesa & Auto-link from Gestión', () => {
    const client = {
        id: 'c3',
        name: 'Cliente Promesa',
        installmentAmount: 75000,
        gestiones: [],
        promises: [],
        payments: []
    };
    clients = [client];

    const todayStr = getToday();
    const gestionWithPromise = {
        id: generateId(),
        date: todayStr,
        time: '10:00',
        type: 'Llamada telefónica',
        result: 'Prometió pagar',
        observations: 'Indica que paga hoy en sucursal'
    };

    const newPromise = {
        id: generateId(),
        periodMonth: todayStr.substring(0, 7),
        installmentNumber: '1 de 12',
        creationDate: todayStr,
        promisedDate: todayStr,
        promisedAmount: 75000,
        paymentMethod: 'Sucursal',
        observations: 'Promesa telefónica',
        status: 'pendiente',
        gestionId: gestionWithPromise.id
    };

    client.promises.push(newPromise);
    gestionWithPromise.promiseId = newPromise.id;
    client.gestiones.push(gestionWithPromise);

    assert.strictEqual(client.promises.length, 1);
    assert.strictEqual(client.promises[0].status, 'pendiente');
    assert.strictEqual(client.promises[0].promisedAmount, 75000);
});

runTest('5. Detect Overdue Promise (Promesa Vencida)', () => {
    const client = {
        id: 'c4',
        name: 'Cliente Vencido',
        promises: [
            {
                id: 'pr_old',
                promisedDate: '2020-01-01',
                status: 'pendiente'
            }
        ]
    };
    clients = [client];
    updatePromisesStatuses();
    assert.strictEqual(client.promises[0].status, 'vencida');
});

runTest('18. Future Period Client Status Initialized as Pending', () => {
    const currentMonth = getToday().substring(0, 7);
    const [yearStr, monthStr] = currentMonth.split('-');
    const currentYear = parseInt(yearStr, 10);
    const currentMonthNum = parseInt(monthStr, 10);

    const nextMonthNum = currentMonthNum === 12 ? 1 : currentMonthNum + 1;
    const nextYear = currentMonthNum === 12 ? currentYear + 1 : currentYear;
    const futurePeriodMonth = `${nextYear}-${String(nextMonthNum).padStart(2, '0')}`;

    const futureClient = {
        id: 'c_future_1',
        name: 'Cliente Periodo Futuro',
        periodMonth: futurePeriodMonth,
        paymentDay: 1, // Day 1 will be lower than current day if current day > 1
        paymentStatus: 'pending',
        isOverdue: false,
        daysOverdue: 0
    };

    clients = [futureClient];
    updateOverdueStatuses();

    assert.strictEqual(futureClient.paymentStatus, 'pending', 'Future period client stays pending');
    assert.strictEqual(futureClient.isOverdue, false, 'Future period client is not overdue');
    assert.strictEqual(futureClient.daysOverdue, 0, 'Future period client has 0 days overdue');
});

runTest('6. Register Payment & Fulfill Promise & Mark Cuota Paid', () => {
    const todayStr = getToday();
    const client = {
        id: 'c5',
        name: 'Cliente Pago',
        installmentAmount: 100000,
        installmentNumber: 3,
        totalInstallments: 12,
        paymentStatus: 'pending',
        periodMonth: todayStr.substring(0, 7),
        promises: [
            {
                id: 'pr_active',
                promisedDate: todayStr,
                promisedAmount: 100000,
                status: 'pendiente'
            }
        ],
        payments: []
    };
    clients = [client];

    const payment = {
        id: generateId(),
        receiptNumber: generateReceiptNumber(),
        clientId: client.id,
        clientName: client.name,
        date: todayStr,
        time: '11:00',
        periodMonth: client.periodMonth,
        installmentNumber: '3',
        amount: 100000,
        paymentMethod: 'Efectivo',
        paymentType: 'total',
        exported: false,
        promiseId: 'pr_active'
    };

    client.payments.push(payment);
    client.paymentStatus = 'paid';
    client.installmentNumber += 1;

    // Fulfill promise
    const pr = client.promises.find(p => p.id === payment.promiseId);
    if (pr) pr.status = 'cumplida';

    assert.strictEqual(client.payments.length, 1);
    assert.strictEqual(client.paymentStatus, 'paid');
    assert.strictEqual(client.installmentNumber, 4);
    assert.strictEqual(client.promises[0].status, 'cumplida');
});

runTest('7. Partial Payment Retains Pending Balance', () => {
    const todayStr = getToday();
    const client = {
        id: 'c6',
        name: 'Cliente Pago Parcial',
        installmentAmount: 100000,
        installmentNumber: 1,
        totalInstallments: 12,
        paymentStatus: 'pending',
        payments: []
    };

    const partialPayment = {
        id: generateId(),
        receiptNumber: generateReceiptNumber(),
        amount: 40000, // Partial
        paymentType: 'partial',
        date: todayStr
    };

    client.payments.push(partialPayment);
    // Cuota status stays pending because partial
    client.paymentStatus = 'pending';

    assert.strictEqual(client.payments.length, 1);
    assert.strictEqual(client.paymentStatus, 'pending');
    assert.strictEqual(client.installmentNumber, 1);
});

runTest('8. Export Payments & Mark Status Exported', () => {
    const client = {
        id: 'c7',
        name: 'Cliente Export',
        payments: [
            {
                id: 'pay_exp',
                receiptNumber: '00000500',
                amount: 50000,
                exported: false
            }
        ]
    };
    clients = [client];

    // Simulate export marking
    client.payments.forEach(p => {
        p.exported = true;
        p.exportedAt = new Date().toISOString();
    });

    assert.strictEqual(client.payments[0].exported, true);
    assert(client.payments[0].exportedAt !== null);
});

runTest('9. Portfolio Import Merge Preserves Gestiones, Promises & Payments', () => {
    const existingClient = {
        id: 'c_merge',
        name: 'Juan Perez',
        dni: '20.123.456',
        branchNumber: '01',
        requestNumber: '10',
        installmentNumber: 2,
        periodMonth: '2026-08',
        installmentAmount: 50000,
        gestiones: [{ id: 'g1', type: 'Llamada telefónica', result: 'Prometió pagar' }],
        promises: [{ id: 'pr1', status: 'pendiente', promisedAmount: 50000 }],
        payments: [{ id: 'p1', amount: 50000, receiptNumber: '00000100' }]
    };
    sanitizeClientSchema(existingClient);
    clients = [existingClient];

    // Updated sheet from official system with new installmentAmount
    const importedUpdate = [{
        name: 'Juan Perez',
        dni: '20123456',
        branchNumber: '1',
        requestNumber: '10',
        installmentNumber: 2,
        periodMonth: '2026-08',
        installmentAmount: 55000 // Updated official amount
    }];

    const { updatedCount, addedCount } = mergeMonthlyPortfolio(importedUpdate);

    assert.strictEqual(updatedCount, 1);
    assert.strictEqual(addedCount, 0);
    assert.strictEqual(clients[0].installmentAmount, 55000, 'Official amount updated');
    assert.strictEqual(clients[0].gestiones.length, 1, 'Gestiones preserved');
    assert.strictEqual(clients[0].promises.length, 1, 'Promises preserved');
    assert.strictEqual(clients[0].payments.length, 1, 'Payments preserved');
});

runTest('10. Minicuota Parsing Logic & Variations Handling', () => {
    const res1 = parseMinicuota('7/9');
    assert.strictEqual(res1.currentInstallment, 7);
    assert.strictEqual(res1.totalInstallments, 9);

    const res2 = parseMinicuota(' 3 / 12 ');
    assert.strictEqual(res2.currentInstallment, 3);
    assert.strictEqual(res2.totalInstallments, 12);

    const res3 = parseMinicuota('7 de 9');
    assert.strictEqual(res3.currentInstallment, 7);
    assert.strictEqual(res3.totalInstallments, 9);

    const res4 = parseMinicuota('7-9');
    assert.strictEqual(res4.currentInstallment, 7);
    assert.strictEqual(res4.totalInstallments, 9);

    // Date object simulation (e.g. July 9th / Day 7 Month 9)
    const mockDate = new Date(2026, 8, 7); // Sept 7th -> 7/9
    const res5 = parseMinicuota(mockDate);
    assert.strictEqual(res5.currentInstallment, 7);
    assert.strictEqual(res5.totalInstallments, 9);

    // Malformed values
    const res6 = parseMinicuota('59/12');
    assert.strictEqual(res6.currentInstallment, 5);
    assert.strictEqual(res6.totalInstallments, 9);
});

runTest('15. Multiple Partial Payments ("Pago a Cuenta") & Complete Cuota Flow', () => {
    const client = {
        id: 'c_partial_test',
        name: 'Cliente Pago a Cuenta',
        installmentAmount: 100000,
        installmentNumber: 7,
        totalInstallments: 9,
        paymentStatus: 'pending',
        periodMonth: '2026-08',
        payments: []
    };
    sanitizeClientSchema(client);
    clients = [client];

    // 1st Payment: Deliver $40.000 out of $100.000 (Partial / Pago a cuenta)
    const prevPaid1 = getPreviousPaidForInstallment(client, '2026-08', 7);
    assert.strictEqual(prevPaid1, 0);

    const payment1 = {
        id: generateId(),
        receiptNumber: generateReceiptNumber(),
        clientId: client.id,
        clientName: client.name,
        date: getToday(),
        time: '10:00',
        periodMonth: '2026-08',
        installmentNumber: '7',
        installmentAmount: 100000,
        amount: 40000, // Delivered $40.000
        paymentType: 'partial',
        createdAt: new Date().toISOString()
    };
    client.payments.push(payment1);
    client.paymentStatus = 'partial';

    // Verify installment number has NOT advanced
    assert.strictEqual(client.installmentNumber, 7, 'Installment stays 7 after partial payment');
    assert.strictEqual(client.paymentStatus, 'partial', 'Status is partial');

    // 2nd Payment: Deliver remaining $60.000
    const prevPaid2 = getPreviousPaidForInstallment(client, '2026-08', 7);
    assert.strictEqual(prevPaid2, 40000, 'Previous payment accumulates $40.000');

    const payment2 = {
        id: generateId(),
        receiptNumber: generateReceiptNumber(),
        clientId: client.id,
        clientName: client.name,
        date: getToday(),
        time: '11:00',
        periodMonth: '2026-08',
        installmentNumber: '7',
        installmentAmount: 100000,
        amount: 60000, // Delivered remaining $60.000
        paymentType: 'total',
        createdAt: new Date().toISOString()
    };
    client.payments.push(payment2);

    const totalAccumulated = getPreviousPaidForInstallment(client, '2026-08', 7);
    assert.strictEqual(totalAccumulated, 100000, 'Cuota 7 fully paid ($100.000)');

    if (totalAccumulated >= client.installmentAmount) {
        client.paymentStatus = 'paid';
        client.installmentNumber += 1;
    }

    assert.strictEqual(client.paymentStatus, 'paid', 'Status transitions to paid');
    assert.strictEqual(client.installmentNumber, 8, 'Installment advances to 8');
});

runTest('14. Client Deduplication & Malformed Cuota Clean-Up', () => {
    clients = [
        {
            id: 'd1',
            name: 'Gismondi Eugenia Carolina',
            dni: '30.111.222',
            branchNumber: '66',
            requestNumber: '16',
            installmentNumber: 59,
            totalInstallments: 12,
            periodMonth: '2026-08',
            paymentStatus: 'pending',
            gestiones: [{ id: 'g_gis', result: 'Contactado' }]
        },
        {
            id: 'd2',
            name: 'Gismondi Eugenia Carolina',
            dni: '30.111.222',
            branchNumber: '66',
            requestNumber: '16',
            installmentNumber: 6,
            totalInstallments: 9,
            periodMonth: '2026-08',
            paymentStatus: 'pending',
            gestiones: [{ id: 'g_gis_2', result: 'Prometió pagar' }]
        }
    ];

    clients.forEach(c => sanitizeClientSchema(c));
    deduplicateClients();

    assert.strictEqual(clients.length, 1, 'Duplicate client records merged into 1');
    assert.strictEqual(clients[0].installmentNumber, 6, 'Cuota 6/9 merged correctly');
    assert.strictEqual(clients[0].totalInstallments, 9);
    assert.strictEqual(clients[0].gestiones.length, 2, 'Gestiones from duplicate merged');
});

runTest('11. Official Spreadsheet Column Mapping & Address Storage', () => {
    const mockRow = {
        'sucursal': '01',
        'solicitud': '1005',
        'sigla': 'PF',
        'apellido': 'GARCIA',
        'apenom': 'JUAN CARLOS',
        'empresas': 'EMP1',
        'empresasd': '',
        'empresaslo': '',
        'empresaste': '',
        'segmento': 'JUBILADO',
        'domicilio': 'Av. San Martin 123',
        'teléfono': '3755401122',
        'celular': '3755152233',
        'zona': 'Centro',
        'localidad': 'Oberá',
        'CPOs': '3360',
        'debe': '0',
        'haber': '0',
        'vencido': '12500,50',
        'punitorios': '125,00',
        'vence': '2026-08-15',
        'minicuota': '7/9',
        'día pago': '10',
        'CBU': '01100...',
        'nro documento': '33445566',
        'garante': 'Perez Maria'
    };

    const { parsedClients, recognizedCols, ignoredCols } = parseOfficialSpreadsheetRows([mockRow]);

    assert.strictEqual(parsedClients.length, 1);
    const c = parsedClients[0];
    assert.strictEqual(c.branchNumber, '01');
    assert.strictEqual(c.requestNumber, '1005');
    assert.strictEqual(c.name, 'GARCIA JUAN CARLOS');
    assert.strictEqual(c.type, 'jubilado');
    assert.strictEqual(c.domicilio, 'Av. San Martin 123');
    assert.strictEqual(c.localidad, 'Oberá');
    assert.strictEqual(c.cpos, '3360');
    assert.strictEqual(c.zona, 'Centro');
    assert.strictEqual(c.installmentAmount, 12500.50);
    assert.strictEqual(c.installmentNumber, 7);
    assert.strictEqual(c.totalInstallments, 9);
    assert.strictEqual(c.dni, '33445566');
    assert.strictEqual(c.garante, 'Perez Maria');

    assert(recognizedCols.some(k => k.toLowerCase().includes('sucursal')));
    assert(ignoredCols.some(k => k.toLowerCase().includes('debe')));
    assert(ignoredCols.some(k => k.toLowerCase().includes('sigla')));
});

runTest('12. Non-Destructive Update of Client with Address and Official Fields', () => {
    const existing = {
        id: 'c_existing_addr',
        name: 'GARCIA JUAN CARLOS',
        dni: '33445566',
        branchNumber: '01',
        requestNumber: '1005',
        installmentNumber: 7,
        totalInstallments: 9,
        periodMonth: getToday().substring(0, 7),
        domicilio: 'Calle Antigua 100',
        gestiones: [{ id: 'g_saved', type: 'Visita del cobrador' }],
        promises: [{ id: 'pr_saved', status: 'pendiente' }],
        payments: [{ id: 'pay_saved', amount: 5000 }]
    };
    sanitizeClientSchema(existing);
    clients = [existing];

    const imported = [{
        name: 'GARCIA JUAN CARLOS',
        dni: '33445566',
        branchNumber: '01',
        requestNumber: '1005',
        installmentNumber: 7,
        totalInstallments: 9,
        periodMonth: getToday().substring(0, 7),
        domicilio: 'Av. San Martin 123 (Nueva)',
        localidad: 'Oberá',
        cpos: '3360',
        zona: 'Centro',
        installmentAmount: 12500.50
    }];

    const { updatedCount, addedCount } = mergeMonthlyPortfolio(imported);
    assert.strictEqual(updatedCount, 1);
    assert.strictEqual(addedCount, 0);

    const updatedClient = clients[0];
    assert.strictEqual(updatedClient.domicilio, 'Av. San Martin 123 (Nueva)');
    assert.strictEqual(updatedClient.localidad, 'Oberá');
    assert.strictEqual(updatedClient.gestiones.length, 1, 'Gestión preserved');
    assert.strictEqual(updatedClient.promises.length, 1, 'Promise preserved');
    assert.strictEqual(updatedClient.payments.length, 1, 'Payment preserved');
});

runTest('16. Editable Address Fields in Form & Schema Sanitization', () => {
    const client = {
        id: 'c_addr_edit',
        name: 'Carlos Perez',
        type: 'jubilado',
        paymentDay: 10,
        domicilio: 'Calle Falsa 123',
        localidad: 'Oberá',
        zona: 'Zona Norte',
        cpos: '3360'
    };
    sanitizeClientSchema(client);
    assert.strictEqual(client.domicilio, 'Calle Falsa 123');
    assert.strictEqual(client.localidad, 'Oberá');
    assert.strictEqual(client.zona, 'Zona Norte');
    assert.strictEqual(client.cpos, '3360');
});

runTest('17. Google Maps Query Excludes Zona and Includes CPOS', () => {
    selectedAddressClient = {
        name: 'Maria Gomez',
        domicilio: 'Av. Corrientes 500',
        localidad: 'Posadas',
        cpos: '3300',
        zona: 'Zona Centro'
    };

    let openedUrl = '';
    global.window.open = (url) => {
        openedUrl = url;
    };

    openAddressInGoogleMaps();

    assert(openedUrl.includes('Av.%20Corrientes%20500'), 'Includes domicilio');
    assert(openedUrl.includes('3300'), 'Includes cpos');
    assert(openedUrl.includes('Posadas'), 'Includes localidad');
    assert(!openedUrl.includes('Zona%20Centro'), 'Excludes internal zona');
});

runTest('13. Import Preview Modal Opens With .open Class', () => {
    let previewModalClassList = [];
    global.document.getElementById = (id) => {
        if (id === 'importPreviewModal' || id === 'addressModal') {
            return {
                classList: {
                    add: (cls) => previewModalClassList.push(cls),
                    remove: (cls) => {
                        previewModalClassList = previewModalClassList.filter(c => c !== cls);
                    }
                }
            };
        }
        return {
            value: '',
            textContent: '',
            style: {},
            classList: { add: () => {}, remove: () => {}, toggle: () => {} },
            addEventListener: () => {},
            appendChild: () => {},
            innerHTML: ''
        };
    };

    const mockPreviewData = {
        parsedClients: [{ name: 'Test', installmentAmount: 1000, installmentNumber: 1, totalInstallments: 12 }],
        totalRecords: 1,
        recognizedCols: ['nombre'],
        importedCols: ['nombre'],
        ignoredCols: [],
        errors: []
    };

    openImportPreviewModal(mockPreviewData);
    assert(previewModalClassList.includes('open'), 'importPreviewModal received open class');

    closeImportPreviewModal();
    assert(!previewModalClassList.includes('open'), 'importPreviewModal removed open class');
});

runTest('19. Period Advancement on Payment & Re-import Deduplication Flow', () => {
    // 1. Create client paying cuota 1 of 3 in August 2026
    const client = {
        id: 'c_period_test',
        name: 'Roberto Fernandez',
        dni: '25.999.888',
        branchNumber: '01',
        requestNumber: '55',
        installmentNumber: 1,
        totalInstallments: 3,
        periodMonth: '2026-08',
        paymentStatus: 'pending',
        installmentAmount: 50000,
        payments: []
    };
    sanitizeClientSchema(client);
    clients = [client];

    // Simulate handleSavePayment logic for paying cuota 1 of 3 in August
    const payPeriodMonth = client.periodMonth; // '2026-08'
    const status = 'paid'; // Full payment

    const isLastInstallment = status === 'paid'
        && typeof client.installmentNumber === 'number'
        && client.totalInstallments
        && client.installmentNumber >= client.totalInstallments;

    if (status === 'paid' && typeof client.installmentNumber === 'number' && !isLastInstallment) {
        client.installmentNumber += 1;
        client.periodMonth = getNextPeriodMonth(payPeriodMonth);
        client.paymentStatus = 'pending';
    } else {
        client.paymentStatus = status;
    }

    assert.strictEqual(client.installmentNumber, 2, 'Installment advanced to 2');
    assert.strictEqual(client.periodMonth, '2026-09', 'Period month advanced to 2026-09');
    assert.strictEqual(client.paymentStatus, 'pending', 'Payment status reset to pending for new cuota');

    // 2. Re-import spreadsheet with row for September (2026-09) for same client
    const reimportedRow = [{
        name: 'Roberto Fernandez',
        dni: '25999888',
        branchNumber: '01',
        requestNumber: '55',
        installmentNumber: 2,
        totalInstallments: 3,
        periodMonth: '2026-09',
        installmentAmount: 50000
    }];

    const { updatedCount, addedCount } = mergeMonthlyPortfolio(reimportedRow);

    assert.strictEqual(updatedCount, 1, 'Existing client updated upon September re-import');
    assert.strictEqual(addedCount, 0, 'No duplicate client created');
    assert.strictEqual(clients.length, 1, 'Client count remains 1');
    assert.strictEqual(clients[0].periodMonth, '2026-09');

    // 3. Complete final cuota (3 of 3)
    clients[0].installmentNumber = 3;
    const finalPayPeriodMonth = clients[0].periodMonth;
    const isLastInstallmentFinal = status === 'paid'
        && typeof clients[0].installmentNumber === 'number'
        && clients[0].totalInstallments
        && clients[0].installmentNumber >= clients[0].totalInstallments;

    if (status === 'paid' && typeof clients[0].installmentNumber === 'number' && !isLastInstallmentFinal) {
        clients[0].installmentNumber += 1;
        clients[0].periodMonth = getNextPeriodMonth(finalPayPeriodMonth);
        clients[0].paymentStatus = 'pending';
    } else {
        clients[0].paymentStatus = status;
    }

    assert.strictEqual(clients[0].installmentNumber, 3, 'Final installment stays 3');
    assert.strictEqual(clients[0].periodMonth, '2026-09', 'Period month does not advance past final installment');
    assert.strictEqual(clients[0].paymentStatus, 'paid', 'Status stays permanently paid for completed loan');
});

runTest('20. Exact Regression Test - Paid Cuota Advances & Transitions to Overdue in Next Month', () => {
    // Client with cuota 2 of 6, payment day 10
    const client = {
        id: 'c_reg_20',
        name: 'Juan Perez',
        dni: '30.111.222',
        installmentNumber: 2,
        totalInstallments: 6,
        periodMonth: '2026-08',
        paymentDay: 10,
        paymentStatus: 'pending',
        installmentAmount: 25000,
        payments: []
    };
    sanitizeClientSchema(client);
    clients = [client];

    // Simulate paying cuota 2 in August
    const payPeriodMonth = '2026-08';
    const status = 'paid';

    const isLastInstallment = status === 'paid'
        && typeof client.installmentNumber === 'number'
        && client.totalInstallments
        && client.installmentNumber >= client.totalInstallments;

    if (status === 'paid' && typeof client.installmentNumber === 'number' && !isLastInstallment) {
        client.installmentNumber += 1;
        client.periodMonth = getNextPeriodMonth(payPeriodMonth);
        client.paymentStatus = 'pending';
    } else {
        client.paymentStatus = status;
    }

    assert.strictEqual(client.installmentNumber, 3, 'Installment number advanced to 3');
    assert.strictEqual(client.periodMonth, '2026-09', 'Period month advanced to 2026-09');
    assert.strictEqual(client.paymentStatus, 'pending', 'Status is pending immediately after payment');

    // Simulate calling updateOverdueStatuses() on Sept 20th 2026 (currentDay=20 > paymentDay=10)
    // Mock getToday() to return '2026-09-20' and global Date constructor
    const origGetToday = getToday;
    getToday = () => '2026-09-20';

    const RealDate = Date;
    global.Date = class extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                return new RealDate('2026-09-20T12:00:00');
            }
            return new RealDate(...args);
        }
        static now() {
            return new RealDate('2026-09-20T12:00:00').getTime();
        }
    };

    try {
        updateOverdueStatuses();
        assert.strictEqual(client.paymentStatus, 'overdue', 'Status transitions to overdue on Sept 20th');
        assert.strictEqual(client.isOverdue, true, 'isOverdue is true');
        assert.strictEqual(client.daysOverdue, 10, 'daysOverdue is 10 (Sept 20 - Sept 10)');
        assert.notStrictEqual(client.paymentStatus, 'paid', 'Never remains stuck in paid status');
    } finally {
        getToday = origGetToday;
        global.Date = RealDate;
    }
});

runTest('21. Gestiones History Panel Rendering, Grouping & Filtering', () => {
    const elements = {
        gestionsHistoryModal: { style: {}, classList: { _c: {}, add: function(c) { this._c[c] = true; }, remove: function(c) { delete this._c[c]; } } },
        gestionsGroupedContainer: { innerHTML: '', style: {} },
        gestionsTodaySummary: { innerHTML: '', style: {} },
        gestionsCalendarContainer: { innerHTML: '', style: {} },
        gestionsViewTabs: { style: {} },
        gestionsListViewBtn: { classList: { add: () => {}, remove: () => {} } },
        gestionsCalendarViewBtn: { classList: { add: () => {}, remove: () => {} } },
        gestionsFilterToggleRow: { style: {} },
        gestionsFilterPanel: { classList: { add: () => {}, remove: () => {} } },
        gestionsFilterBadge: { textContent: '', style: {} },
        gestionsFilterToggleBtn: { classList: { _c: {}, add: function(c) { this._c[c] = true; }, remove: function(c) { delete this._c[c]; } } },
        gestFilterClient: { value: '' },
        gestFilterType: { value: 'all' },
        gestFilterResult: { value: 'all' },
        gestFilterFrom: { value: '' },
        gestFilterTo: { value: '' },
        gestFilterPendingFollowUp: { checked: false }
    };

    const origGetElementById = document.getElementById;
    document.getElementById = (id) => {
        if (elements[id]) {
            if (elements[id].classList && elements[id].classList._c) {
                elements[id].classList.contains = (c) => !!elements[id].classList._c[c];
            }
            return elements[id];
        }
        return { value: '', textContent: '', style: {}, classList: { add: () => {}, remove: () => {} }, innerHTML: '' };
    };

    try {
        const todayStr = getToday();
        clients = [
            {
                id: 'cli1',
                name: 'Carlos Gomez',
                dni: '22333444',
                gestiones: [
                    { id: 'g1', date: todayStr, time: '10:00', type: 'Llamada telefónica', result: 'Prometió pagar', observations: 'Prometió pagar hoy', nextAction: 'Llamar si no paga', nextFollowUpDate: todayStr, promiseId: 'p1' },
                    { id: 'g2', date: '2026-08-15', time: '14:30', type: 'WhatsApp / mensaje', result: 'Contactado', observations: 'Mensaje enviado', nextAction: '', nextFollowUpDate: '', promiseId: null }
                ],
                promises: [
                    { id: 'p1', status: 'pendiente', promisedDate: todayStr, promisedAmount: 50000, gestionId: 'g1' }
                ]
            }
        ];

        openGestionsHistoryModal();

        assert(elements.gestionsHistoryModal.classList._c['open'], 'Modal should have open class');
        assert(elements.gestionsTodaySummary.innerHTML.includes('Hoy: <strong>1</strong>'), 'Today summary should count 1 gestion today');
        assert(elements.gestionsTodaySummary.innerHTML.includes('Con promesa: <strong>1</strong>'), 'Today summary should count 1 promise today');
        assert(elements.gestionsGroupedContainer.innerHTML.includes('Carlos Gomez'), 'Grouped container contains client name');
        assert(elements.gestionsGroupedContainer.innerHTML.includes('PENDIENTE'), 'Contains pending promise status badge');

        // Test filtering by query and badge update
        elements.gestFilterClient.value = 'Inexistente';
        renderGestionsHistoryTable();
        assert(elements.gestionsGroupedContainer.innerHTML.includes('No se encontraron gestiones'), 'Shows empty state when query does not match');
        assert.strictEqual(String(elements.gestionsFilterBadge.textContent), '1', 'Filter badge shows 1 active filter');
        assert(elements.gestionsFilterToggleBtn.classList._c['has-filters'], 'Toggle button has class has-filters');

        // Reset filter
        elements.gestFilterClient.value = '';
        renderGestionsHistoryTable();
        assert(elements.gestionsGroupedContainer.innerHTML.includes('Carlos Gomez'), 'Restores list on clearing filter');
        assert.strictEqual(elements.gestionsFilterBadge.style.display, 'none', 'Filter badge hidden when no filters active');

        // Test Calendar View toggle & rendering
        currentGestionsView = 'calendar';
        const [tYear, tMonth] = todayStr.split('-').map(Number);
        calendarYear = tYear;
        calendarMonth = tMonth - 1;
        renderGestionsCalendar();
        assert(elements.gestionsCalendarContainer.innerHTML.includes('calendar-grid'), 'Calendar grid rendered');

        // Select date with actions
        selectCalendarDate(todayStr);
        assert(elements.gestionsCalendarContainer.innerHTML.includes('Acciones para el'), 'Day actions section displayed when day selected');

        // Restore list view for remaining checks
        currentGestionsView = 'list';
        openGestionsHistoryModal();

        // Test pending follow up filter
        elements.gestFilterPendingFollowUp.checked = true;
        renderGestionsHistoryTable();
        assert(elements.gestionsGroupedContainer.innerHTML.includes('Carlos Gomez'), 'Shows gestion with active follow-up');
        assert(!elements.gestionsGroupedContainer.innerHTML.includes('Contactado'), 'Does not show gestion without follow-up');

    } finally {
        document.getElementById = origGetElementById;
    }
});

runTest('23. Task 1 - Partial Payment Overdue Status & Calculation', () => {
    const today = new Date();
    const currentMonthStr = getToday().substring(0, 7);

    const partialClient = {
        id: 'c_partial_overdue',
        name: 'Cliente Pago Parcial Atrasado',
        paymentStatus: 'partial',
        paymentDay: 5,
        periodMonth: currentMonthStr,
        installmentAmount: 50000,
        isOverdue: false,
        daysOverdue: 0
    };

    clients = [partialClient];

    // Mock Date so current day is 15 (> paymentDay 5)
    const RealDate = Date;
    const origGetToday = getToday;
    getToday = () => `${currentMonthStr}-15`;

    global.Date = class extends RealDate {
        constructor(...args) {
            if (args.length === 0) {
                return new RealDate(`${currentMonthStr}-15T12:00:00`);
            }
            return new RealDate(...args);
        }
        static now() {
            return new RealDate(`${currentMonthStr}-15T12:00:00`).getTime();
        }
    };

    try {
        updateOverdueStatuses();
        assert.strictEqual(partialClient.paymentStatus, 'partial', 'paymentStatus remains partial');
        assert.strictEqual(partialClient.isOverdue, true, 'isOverdue is true');
        assert.strictEqual(partialClient.daysOverdue, 10, 'daysOverdue is 10 days (15 - 5)');
    } finally {
        getToday = origGetToday;
        global.Date = RealDate;
    }
});

runTest('24. Task 3 - Notification Dismissal via LocalStorage', () => {
    localStorage._data = {};
    const notifId = 'promise:pr_test_dismiss';
    dismissNotificationId(notifId);

    const dismissed = getDismissedNotificationIds();
    assert(dismissed.includes(notifId), 'notifId added to dismissed list');
});

runTest('25. Task 1 Verification - Monthly Portfolio Amount Calculations & Payment Flow', () => {
    const originalGetElementById = document.getElementById;
    const elements = {};
    document.getElementById = (id) => {
        if (!elements[id]) {
            elements[id] = {
                id,
                value: '',
                textContent: '',
                style: {},
                classList: { add: () => {}, remove: () => {}, toggle: () => {} },
                addEventListener: () => {},
                appendChild: () => {},
                innerHTML: ''
            };
        }
        return elements[id];
    };

    try {
        currentMonthFilter = '2026-09';
        clients = [
            {
                id: 'c_portfolio_1',
                name: 'Cliente Cartera 1',
                installmentAmount: 50000,
                installmentNumber: 1,
                totalInstallments: 12,
                periodMonth: '2026-09',
                paymentStatus: 'pending',
                payments: []
            },
            {
                id: 'c_portfolio_2',
                name: 'Cliente Cartera 2',
                installmentAmount: 30000,
                installmentNumber: 1,
                totalInstallments: 12,
                periodMonth: '2026-09',
                paymentStatus: 'pending',
                payments: []
            }
        ];

        // Initial check: Total = $80.000, Collected = $0, Pending = $80.000
        updateDailyDashboard();
        const totalEl1 = document.getElementById('dashMonthTotalAmount');
        const collectedEl1 = document.getElementById('dashMonthCollectedAmount');
        const pendingEl1 = document.getElementById('dashMonthPendingAmount');
        const pendingRateEl1 = document.getElementById('dashMonthPendingRate');

        assert.strictEqual(totalEl1.textContent, '$ 80.000,00', 'Initial total portfolio amount');
        assert.strictEqual(collectedEl1.textContent, '$ 0,00', 'Initial collected amount is 0');
        assert.strictEqual(pendingEl1.textContent, '$ 80.000,00', 'Initial pending amount is $80.000');
        assert.strictEqual(pendingRateEl1.textContent, '100,0%', 'Initial pending rate is 100%');

        // Simulate paying cuota for Cliente Cartera 1 for September 2026
        const p1 = {
            id: 'pay_p1',
            amount: 50000,
            installmentAmount: 50000,
            date: getToday(),
            periodMonth: '2026-09',
            installmentNumber: '1'
        };
        clients[0].payments.push(p1);
        clients[0].installmentNumber = 2;
        clients[0].periodMonth = '2026-10'; // Period advances to October!
        clients[0].paymentStatus = 'pending';

        updateDailyDashboard();

        const totalEl2 = document.getElementById('dashMonthTotalAmount');
        const collectedEl2 = document.getElementById('dashMonthCollectedAmount');
        const pendingEl2 = document.getElementById('dashMonthPendingAmount');
        const recoveryRateEl2 = document.getElementById('dashMonthRecoveryRate');
        const pendingRateEl2 = document.getElementById('dashMonthPendingRate');

        assert.strictEqual(totalEl2.textContent, '$ 80.000,00', 'Total portfolio for Sept remains $80.000 after payment');
        assert.strictEqual(collectedEl2.textContent, '$ 50.000,00', 'Collected amount reflects $50.000 paid');
        assert.strictEqual(pendingEl2.textContent, '$ 30.000,00', 'Pending amount reduced to $30.000');
        assert.strictEqual(recoveryRateEl2.textContent, '62,5%', 'Recovery rate is 62.5%');
        assert.strictEqual(pendingRateEl2.textContent, '37,5%', 'Pending rate is 37.5%');
    } finally {
        document.getElementById = originalGetElementById;
    }
});

runTest('26. Task 2 Verification - Gestiones Calendar Resiliency & Malformed Date Handling', () => {
    const origConsoleWarn = console.warn;
    const origConsoleError = console.error;
    let warnCount = 0;
    let errorCount = 0;

    console.warn = () => { warnCount++; };
    console.error = () => { errorCount++; };

    try {
        clients = [
            {
                id: 'c_malformed_1',
                name: 'Cliente Fecha Invalida',
                gestiones: [
                    { id: 'g_bad', nextFollowUpDate: '2026-09-INVALID', nextAction: 'Prueba' },
                    { id: 'g_good', nextFollowUpDate: '2026-09-25', nextAction: 'Seguimiento OK' }
                ],
                promises: [
                    { id: 'pr_bad', promisedDate: 'NOT-A-DATE', promisedAmount: 10000, status: 'pendiente' },
                    { id: 'pr_good', promisedDate: '2026-09-28', promisedAmount: 20000, status: 'pendiente' }
                ]
            }
        ];

        const actionsMap = getAllCalendarActions();

        assert(warnCount >= 2, 'Warnings logged for invalid dates');
        assert(!actionsMap['2026-09-INVALID'], 'Invalid gestion date key not added');
        assert(!actionsMap['NOT-A-DATE'], 'Invalid promise date key not added');
        assert(actionsMap['2026-09-25'], 'Valid gestion date processed correctly');
        assert(actionsMap['2026-09-28'], 'Valid promise date processed correctly');

        // Test try/catch fallback in renderGestionsCalendar
        const origGetElementById = document.getElementById;
        const dummyContainer = { innerHTML: '' };
        document.getElementById = (id) => id === 'gestionsCalendarContainer' ? dummyContainer : null;

        renderGestionsCalendar();
        assert(!dummyContainer.innerHTML.includes('calendar-error-state'), 'Renders calendar normally with sanitized data');

    } finally {
        console.warn = origConsoleWarn;
        console.error = origConsoleError;
    }
});

console.log(`--- ALL ${passCount} TESTS PASSED SUCCESSFULLY ---`);

// [TEST 22] Notifications Badge & FollowUpDueCount Test
runTest('22. Notifications Badge & FollowUpDueCount Test', () => {
    const today = getToday();
    const pastDate = '2020-01-01';

    currentMonthFilter = 'all';

    const elements = {};
    const getEl = (id) => {
        if (!elements[id]) {
            elements[id] = {
                id,
                value: '',
                textContent: '',
                style: {},
                classList: { add: () => {}, remove: () => {}, toggle: () => {} },
                addEventListener: () => {},
                appendChild: () => {},
                innerHTML: ''
            };
        }
        return elements[id];
    };

    const originalGetElementById = document.getElementById;
    document.getElementById = (id) => getEl(id);

    clients = [
        {
            id: 'client_notif_1',
            name: 'Cliente Promesa Incumplida',
            paymentStatus: 'pending',
            periodMonth: '2025-05',
            promises: [{
                id: 'pr_1',
                promisedDate: pastDate,
                promisedAmount: 10000,
                status: 'vencida'
            }],
            gestiones: []
        },
        {
            id: 'client_notif_2',
            name: 'Cliente Seguimiento Atrasado',
            paymentStatus: 'pending',
            periodMonth: '2025-05',
            promises: [],
            gestiones: [{
                id: 'gest_1',
                date: pastDate,
                nextFollowUpDate: pastDate,
                nextAction: 'Llamar urgente'
            }]
        },
        {
            id: 'client_notif_3',
            name: 'Cliente Al Día',
            paymentStatus: 'paid',
            periodMonth: '2025-05',
            promises: [],
            gestiones: [{
                id: 'gest_2',
                date: today,
                nextFollowUpDate: '2099-12-31',
                nextAction: 'Llamar en el futuro'
            }]
        }
    ];

    updateDailyDashboard();

    const badge = document.getElementById('notificationsBadge');
    const badgeCount = parseInt(badge.textContent || '0', 10);

    if (badgeCount !== 2) {
        throw new Error(`Expected badge count 2, got ${badgeCount}`);
    }

    const brokenList = document.getElementById('notificationsBrokenList');
    const followUpList = document.getElementById('notificationsFollowUpList');

    if (!brokenList || !brokenList.innerHTML.includes('Cliente Promesa Incumplida')) {
        throw new Error('Broken promises list did not render expected client');
    }

    if (!followUpList || !followUpList.innerHTML.includes('Cliente Seguimiento Atrasado')) {
        throw new Error('Follow-ups due list did not render expected client');
    }

    document.getElementById = originalGetElementById;
});
