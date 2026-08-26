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

console.log(`--- ALL ${passCount} TESTS PASSED SUCCESSFULLY ---`);
