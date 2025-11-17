import { CollabJSON } from './_crdt.js';
import assert from 'assert';

let tests = [];
let failures = 0;

function test(description, fn) {
    tests.push({ description, fn });
}

function runTests() {
    console.log('Running CollabJSON tests...');
    for (const t of tests) {
        try {
            t.fn();
            console.log(`✅ ${t.description}`);
        } catch (error) {
            console.error(`❌ ${t.description}`);
            console.error(error);
            failures++;
        }
    }
    console.log(`\n${tests.length} tests, ${failures} failures`);
    process.exit(failures > 0 ? 1 : 0);
}

// --- Basic Tests ---

test('Initialization', () => {
    const doc = new CollabJSON();
    assert.deepStrictEqual(doc.getData(), []);
});

test('addItem at beginning, middle, and end', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }]);
    doc.addItem([1], { text: 'c' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
    doc.addItem([1], { text: 'b' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
});

test('updateItem', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    doc.addItem([1], { text: 'b' });
    doc.updateItem([0], { text: 'A' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'A' }, { text: 'b' }]);
});

test('deleteItem', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    doc.addItem([1], { text: 'b' });
    doc.addItem([2], { text: 'c' });
    doc.deleteItem([1]);
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
});

test('moveItem', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    doc.addItem([1], { text: 'b' });
    doc.addItem([2], { text: 'c' });
    doc.moveItem([0], [2]);
    assert.deepStrictEqual(doc.getData(), [{ text: 'b' }, { text: 'c' }, { text: 'a' }]);
    doc.moveItem([2], [0]); // move 'a' back to index 0
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
});

// --- Nested Structure Tests ---

test('addItem with nested CollabJSON', () => {
    const doc = new CollabJSON();
    const nestedDoc = new CollabJSON();
    nestedDoc.addItem([0], { val: 1 });
    doc.addItem([0], nestedDoc);
    doc.addItem([1], { text: 'item 2' });
    assert.deepStrictEqual(doc.getData(), [[{ val: 1 }], { text: 'item 2' }]);
});

test('addItem into a nested structure', () => {
    const doc = new CollabJSON();
    doc.addItem([0], new CollabJSON());
    doc.addItem([0, 0], { text: 'nested' });
    assert.deepStrictEqual(doc.getData(), [[{ text: 'nested' }]]);
});

test('updateItem in a nested structure', () => {
    const doc = new CollabJSON();
    doc.addItem([0], new CollabJSON());
    doc.addItem([0, 0], { text: 'nested' });
    doc.updateItem([0, 0], { text: 'updated nested' });
    assert.deepStrictEqual(doc.getData(), [[{ text: 'updated nested' }]]);
});

test('deleteItem from a nested structure', () => {
    const doc = new CollabJSON();
    doc.addItem([0], new CollabJSON());
    doc.addItem([0, 0], { text: 'a' });
    doc.addItem([0, 1], { text: 'b' });
    doc.deleteItem([0, 0]);
    assert.deepStrictEqual(doc.getData(), [[{ text: 'b' }]]);
});

test('moveItem within a nested structure', () => {
    const doc = new CollabJSON();
    doc.addItem([0], new CollabJSON());
    doc.addItem([0, 0], { text: 'a' });
    doc.addItem([0, 1], { text: 'b' });
    doc.moveItem([0, 0], [0, 2]); // move 'a' after 'b'
    assert.deepStrictEqual(doc.getData(), [[{ text: 'b' }, { text: 'a' }]]);
});

test('moveItem between nested and root structures', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'root a' });
    doc.addItem([1], new CollabJSON());
    doc.addItem([1, 0], { text: 'nested b' });
    doc.addItem([1, 1], { text: 'nested c' });

    // move 'nested b' to root at index 1
    doc.moveItem([1, 0], [1]);
    assert.deepStrictEqual(doc.getData(), [{ text: 'root a' }, { text: 'nested b' }, [{ text: 'nested c' }]]);

    // move 'root a' into nested doc at index 0
    doc.moveItem([0], [2, 0]);
    assert.deepStrictEqual(doc.getData(), [{ text: 'nested b' }, [{ text: 'root a' }, { text: 'nested c' }]]);
});

test('getItem', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    assert.deepStrictEqual(doc.getItem([0]), { text: 'a' });

    const nested = new CollabJSON();
    nested.addItem([0], { val: 1 });
    doc.addItem([1], nested);
    
    const extracted = doc.getItem([1]);
    assert.ok(extracted instanceof CollabJSON);
    assert.deepStrictEqual(extracted.getData(), [{ val: 1 }]);
    // ensure it's a copy
    extracted.addItem([1], { val: 2 });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, [{ val: 1 }]]);
});

test('getItem, modify, and updateItem', () => {
    const doc = new CollabJSON();
    const nested = new CollabJSON();
    nested.addItem([0], { val: 1 });
    doc.addItem([0], nested);

    // 1. Extract
    const extracted = doc.getItem([0]);
    assert.deepStrictEqual(extracted.getData(), [{ val: 1 }]);

    // 2. Modify
    extracted.addItem([1], { val: 2 });
    assert.deepStrictEqual(extracted.getData(), [{ val: 1 }, { val: 2 }]);

    // 3. Update
    doc.updateItem([0], extracted);
    
    // 4. Assert
    assert.deepStrictEqual(doc.getData(), [[{ val: 1 }, { val: 2 }]]);
});


// --- Synchronization Tests ---

test('Basic sync: one-way propagation', () => {
    const doc1 = new CollabJSON();
    const doc2 = new CollabJSON({id: doc1.id});

    doc1.addItem([0], { text: 'a' });
    doc1.addItem([1], { text: 'b' });

    // Sync ops from 1 to 2
    doc1.ops.forEach(op => doc2.applyOp(op));

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
});

test('Concurrent adds at same position converge', () => {
    const doc1 = new CollabJSON({clientId: 'c1'});
    doc1.addItem([0], { text: 'common' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds
    doc1.addItem([1], { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.addItem([1], { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(doc1.getData().length, 3);
});

test('Concurrent update (LWW)', () => {
    const doc1 = new CollabJSON({clientId: 'c1'});
    doc1.addItem([0], { text: 'original' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent updates. Force clock to determine winner.
    doc1.root.clock = 10;
    doc1.updateItem([0], { text: 'update from 1' }); // This one is later
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.root.clock = 5;
    doc2.updateItem([0], { text: 'update from 2' }); // This one is earlier
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), [{ text: 'update from 1' }]);
    assert.deepStrictEqual(doc2.getData(), [{ text: 'update from 1' }]);
});

test('Concurrent delete and update converge', () => {
    const doc1 = new CollabJSON({clientId: 'c1'});
    doc1.addItem([0], { text: 'original' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent update and delete
    doc1.root.clock = 10;
    doc1.deleteItem([0]); // delete wins (later timestamp)
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.root.clock = 5;
    doc2.updateItem([0], { text: 'update from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), []);
    assert.deepStrictEqual(doc2.getData(), []);
});

// --- Boundary and Error Tests ---

test('Throws error on invalid path for update', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' });
    assert.throws(() => doc.updateItem([1], { text: 'b' }), /Item not found/);
});

test('Throws error on invalid path for resolving', () => {
    const doc = new CollabJSON();
    doc.addItem([0], { text: 'a' }); // Not a CollabJSON
    assert.throws(() => doc.addItem([0, 0], { text: 'b' }), /not a CollabJSON/);
});

// --- DVV Sync Tests ---

test('getSyncRequest is repeatable', () => {
    const client = new CollabJSON();
    client.addItem([0], { text: 'a' });
    const req1 = client.getSyncRequest();
    const req2 = client.getSyncRequest();
    assert.deepStrictEqual(req1, req2);
    assert.strictEqual(req1.ops.length, 1);
});

test('applySyncResponse is idempotent', () => {
    const docId = 'doc1';
    const client = new CollabJSON({ id: docId });
    const server = new CollabJSON({ clientId: 'server', id: docId });

    client.addItem([0], { text: 'a' });
    const request = client.getSyncRequest();
    const response = server.getSyncResponse(request);

    client.applySyncResponse(response);
    const state1 = client.getData();
    const dvv1 = client.dvv;

    client.applySyncResponse(response);
    const state2 = client.getData();
    const dvv2 = client.dvv;

    assert.deepStrictEqual(state1, state2);
    assert.deepStrictEqual(dvv1, dvv2);
});

test('Full client-server-client sync cycle', () => {
    const docId = 'doc1';
    const server = new CollabJSON({ clientId: 'server', id: docId });
    const client1 = new CollabJSON({ clientId: 'c1', id: docId });
    const client2 = new CollabJSON({ clientId: 'c2', id: docId });

    // C1 adds item, syncs with server
    client1.addItem([0], { text: 'from c1' });
    let req1 = client1.getSyncRequest();
    let res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.deepStrictEqual(server.getData(), [{ text: 'from c1' }]);

    // C2 syncs with server, gets C1's changes
    let req2 = client2.getSyncRequest();
    let res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    assert.deepStrictEqual(client2.getData(), [{ text: 'from c1' }]);

    // C2 adds item, syncs with server
    client2.addItem([1], { text: 'from c2' });
    req2 = client2.getSyncRequest();
    res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    assert.deepStrictEqual(server.getData(), [{ text: 'from c1' }, { text: 'from c2' }]);

    // C1 syncs again, gets C2's changes
    req1 = client1.getSyncRequest();
    res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.deepStrictEqual(client1.getData(), server.getData());
});

test('Concurrent changes from two clients converge', () => {
    const docId = 'doc1';
    const server = new CollabJSON({ clientId: 'server', id: docId });
    const client1 = new CollabJSON({ clientId: 'c1', id: docId });
    const client2 = new CollabJSON({ clientId: 'c2', id: docId });

    // C1 and C2 both add an item offline
    client1.addItem([0], { text: 'from c1' });
    client2.addItem([0], { text: 'from c2' });

    // C1 syncs
    const req1 = client1.getSyncRequest();
    const res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    // C2 syncs
    const req2 = client2.getSyncRequest();
    const res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    // Final sync for C1 to get C2's changes
    const finalReq1 = client1.getSyncRequest();
    const finalRes1 = server.getSyncResponse(finalReq1);
    client1.applySyncResponse(finalRes1);

    assert.deepStrictEqual(client1.getData(), client2.getData());
    assert.strictEqual(client1.getData().length, 2);
    assert.deepStrictEqual(client1.getData(), server.getData());
});

test('addItem with nested CollabJSON syncs correctly', () => {
    const docId = 'doc1';
    const server = new CollabJSON({ clientId: 'server', id: docId });
    const client1 = new CollabJSON({ clientId: 'c1', id: docId });
    const client2 = new CollabJSON({ clientId: 'c2', id: docId });

    // C1 adds a nested doc
    const nested = new CollabJSON();
    nested.addItem([0], { val: 1 });
    client1.addItem([0], nested);
    client1.addItem([0, 1], { val: 2 });
    
    // Sync C1 to server
    const req1 = client1.getSyncRequest();
    const res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    // Sync server to C2
    const req2 = client2.getSyncRequest();
    const res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);
    
    assert.deepStrictEqual(client2.getData(), [[{ val: 1 }, { val: 2 }]]);
});


test('Client ops are pruned after successful sync', () => {
    const docId = 'prune-ops-doc';
    const server = new CollabJSON({ clientId: 'server', id: docId });
    const client = new CollabJSON({ clientId: 'c1', id: docId });

    // 1. Client creates an operation
    client.addItem([0], { text: 'op1' });
    assert.strictEqual(client.ops.length, 1);

    // 2. Client syncs with server
    const req1 = client.getSyncRequest();
    const res1 = server.getSyncResponse(req1);
    
    // 3. Client applies response
    client.applySyncResponse(res1);

    // 4. Assert local ops are pruned
    assert.strictEqual(client.ops.length, 0, 'Ops should be pruned after sync');

    // 5. Client creates another op to ensure log is still functional
    client.addItem([0], { text: 'op2' });
    assert.strictEqual(client.ops.length, 1);

    const req2 = client.getSyncRequest();
    assert.strictEqual(req2.ops.length, 1, 'New sync request should contain only the new op');
    assert.strictEqual(req2.ops[0].data.text, 'op2');
});


test('Sync with a pruned server sends snapshot', () => {
    const docId = 'prune-doc';
    let server = new CollabJSON({ clientId: 'server', id: docId });
    const client1 = new CollabJSON({ clientId: 'c1', id: docId });
    const client2 = new CollabJSON({ clientId: 'c2', id: docId }); // New client

    // Make > 100 ops from client1
    for (let i = 0; i < 101; i++) {
        client1.addItem([i], { val: i });
    }
    
    // Sync client1 to server
    let req1 = client1.getSyncRequest();
    let res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.strictEqual(server.history.length, 101);

    // Prune the server
    server.prune((doc) => {}); // Dummy prune function
    assert.strictEqual(server.history.length, 50);
    assert.ok(server.snapshot);

    // Simulate saving and reloading server state from DB
    const serverState = server.toJSON();
    server = CollabJSON.fromJSON(serverState, { clientId: 'server' });

    // Now, new client (client2) tries to sync. It has an empty DVV.
    const req2 = client2.getSyncRequest();
    const res2 = server.getSyncResponse(req2);

    // It should receive a reset response
    assert.strictEqual(res2.reset, true);
    assert.ok(res2.snapshot);

    client2.applySyncResponse(res2);
    
    assert.deepStrictEqual(client2.getData(), server.getData());
});


// Run all tests
runTests();
