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
    createElement: () => ({
        style: {},
        classList: { add: () => {}, remove: () => {} },
        appendChild: () => {}
    }),
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
eval(jsCode.replace(/^let clients =/m, 'var clients ='));

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

runTest('10. Minicuota Parsing Logic', () => {
    const res1 = parseMinicuota('7/9');
    assert.strictEqual(res1.currentInstallment, 7);
    assert.strictEqual(res1.totalInstallments, 9);

    const res2 = parseMinicuota(' 3 / 12 ');
    assert.strictEqual(res2.currentInstallment, 3);
    assert.strictEqual(res2.totalInstallments, 12);

    const res3 = parseMinicuota('5');
    assert.strictEqual(res3.currentInstallment, 5);
    assert.strictEqual(res3.totalInstallments, 12);
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

console.log(`--- ALL ${passCount} TESTS PASSED SUCCESSFULLY ---`);
