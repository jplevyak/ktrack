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
    const doc = new CollabJSON("{}");
    assert.deepStrictEqual(doc.getData(), {});
    const arrDoc = new CollabJSON("[]");
    assert.deepStrictEqual(arrDoc.getData(), []);
    const indDoc = new CollabJSON();
    assert.strictEqual(indDoc.getData(), undefined);
});

test('Indeterminate type resolution', () => {
    const arrDoc = new CollabJSON();
    arrDoc.addItem(0, { text: 'a' });
    assert.strictEqual(arrDoc.type, 'array');
    assert.deepStrictEqual(arrDoc.getData(), [{ text: 'a' }]);

    const objDoc = new CollabJSON();
    objDoc.setItem('a', { text: 'value a' });
    assert.strictEqual(objDoc.type, 'object');
    assert.deepStrictEqual(objDoc.getData(), { a: { text: 'value a' } });
});

test('Constructor initializes with data from JSON string', () => {
    const objDoc = new CollabJSON('{"a": 1, "b": {"c": 2}}');
    assert.strictEqual(objDoc.type, 'object');
    assert.deepStrictEqual(objDoc.getData(), {"a": 1, "b": {"c": 2}});

    const arrDoc = new CollabJSON('[{"a": 1}, {"b": 2}]');
    assert.strictEqual(arrDoc.type, 'array');
    assert.deepStrictEqual(arrDoc.getData(), [{"a": 1}, {"b": 2}]);
});

test('Array: addItem at beginning, middle, and end', () => {
    const doc = new CollabJSON("[]");
    doc.addItem(0, { text: 'a' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }]);
    doc.addItem(1, { text: 'c' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
    doc.addItem(1, { text: 'b' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
});

test('Array: deleteItem', () => {
    const doc = new CollabJSON("[]");
    doc.addItem(0, { text: 'a' });
    doc.addItem(1, { text: 'b' });
    doc.addItem(2, { text: 'c' });
    doc.deleteItem(1);
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
});

test('Array: moveItem', () => {
    const doc = new CollabJSON("[]");
    doc.addItem(0, { text: 'a' });
    doc.addItem(1, { text: 'b' });
    doc.addItem(2, { text: 'c' });
    doc.moveItem(0, 2);
    assert.deepStrictEqual(doc.getData(), [{ text: 'b' }, { text: 'c' }, { text: 'a' }]);
    doc.moveItem(2, 0); // move 'a' back to index 0
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
});

test('Object: setItem can add and overwrite keys', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('a', { text: 'value a' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'value a' } });
    doc.setItem('b', { text: 'value b' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'value a' }, b: { text: 'value b' } });
    doc.setItem('a', { text: 'new value a' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'new value a' }, b: { text: 'value b' } });
});

test('Array: updateItem', () => {
    const doc = new CollabJSON("[]");
    doc.addItem(0, { text: 'a' });
    doc.addItem(1, { text: 'b' });
    doc.updateItem([0], { text: 'A' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'A' }, { text: 'b' }]);
});

test('Object: updateItem', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('a', { text: 'value a' });
    doc.setItem('b', { text: 'value b' });
    doc.updateItem(['a'], { text: 'new value a' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'new value a' }, b: { text: 'value b' } });
});

test('Object: removeItem', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('a', 1);
    doc.setItem('b', 2);
    doc.setItem('c', 3);
    doc.removeItem('b');
    assert.deepStrictEqual(doc.getData(), { a: 1, c: 3 });
});

test('Successive updates to the same item are compressed', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('item1', { text: 'initial' });
    assert.strictEqual(doc.ops.length, 1);
    assert.strictEqual(doc.ops[0].type, 'SET_ITEM');

    // First update
    doc.updateItem(['item1'], { text: 'update 1' });
    assert.strictEqual(doc.ops.length, 2, 'Should have SET and one UPDATE op');
    assert.strictEqual(doc.ops[1].type, 'UPDATE_ITEM');
    assert.deepStrictEqual(doc.ops[1].data, { text: 'update 1' });
    assert.deepStrictEqual(doc.ops[1].path, [], 'Path should be empty for top-level update');
    const firstUpdateTimestamp = doc.ops[1].timestamp;

    // Second update (should compress)
    doc.updateItem(['item1'], { text: 'update 2' });
    assert.strictEqual(doc.ops.length, 2, 'Should still have 2 ops after compression');
    const lastOp = doc.ops[1];
    assert.strictEqual(lastOp.type, 'UPDATE_ITEM');
    assert.deepStrictEqual(lastOp.data, { text: 'update 2' }, 'Last op should contain data from second update');
    assert.ok(lastOp.timestamp > firstUpdateTimestamp, 'Timestamp should be updated');

    // Check final state
    assert.deepStrictEqual(doc.getData(), { item1: { text: 'update 2' } });
});

test('updateItem can update nested properties', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('item1', {
        text: 'top level',
        details: {
            author: 'John',
            tags: ['a', 'b']
        }
    });

    // Update a nested property
    doc.updateItem(['item1', 'details', 'author'], 'Jane');
    let data = doc.getData();
    assert.deepStrictEqual(data.item1.details.author, 'Jane');

    // Update a nested array element
    doc.updateItem(['item1', 'details', 'tags', 1], 'B');
    data = doc.getData();
    assert.deepStrictEqual(data.item1.details.tags, ['a', 'B']);

    // Add a new property
    doc.updateItem(['item1', 'details', 'year'], 2024);
    data = doc.getData();
    assert.deepStrictEqual(data.item1.details.year, 2024);

    // Update the whole top-level item
    doc.updateItem(['item1'], { text: 'new top level' });
    data = doc.getData();
    assert.deepStrictEqual(data.item1, { text: 'new top level' });
});

test('Successive nested updates are compressed', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('item1', { details: { author: 'John' } });
    
    doc.updateItem(['item1', 'details', 'author'], 'Jane');
    assert.strictEqual(doc.ops.length, 2);
    
    doc.updateItem(['item1', 'details', 'author'], 'Joan');
    assert.strictEqual(doc.ops.length, 2, 'Should compress updates to same nested path');
    assert.deepStrictEqual(doc.ops[1].data, 'Joan');
    assert.deepStrictEqual(doc.getData(), { item1: { details: { author: 'Joan' } } });
    
    doc.updateItem(['item1', 'details'], { author: 'James' });
    assert.strictEqual(doc.ops.length, 3, 'Should not compress updates to different path');
});

test('Can create and update a nested map object', () => {
    const doc = new CollabJSON("{}");

    // Add a nested map as an item
    doc.setItem('map1', { "a": { "b": 1, "c": 2 }, "d": 3 });
    assert.deepStrictEqual(doc.getData(), { map1: { "a": { "b": 1, "c": 2 }, "d": 3 } });

    // Update a deeply nested value
    doc.updateItem(['map1', 'a', 'b'], 10);
    assert.deepStrictEqual(doc.getData(), { map1: { "a": { "b": 10, "c": 2 }, "d": 3 } });

    // Update a top-level value in the item
    doc.updateItem(['map1', 'd'], 30);
    assert.deepStrictEqual(doc.getData(), { map1: { "a": { "b": 10, "c": 2 }, "d": 30 } });
});

// --- Nested Structure Tests (Removed) ---

test('findPath finds path to object containing a key, with optional basePath', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('item1', {
        id: 1,
        details: {
            author: 'John',
            meta: {
                year: 2024
            }
        }
    });
    doc.setItem('item2', {
        id: 2,
        details: {
            author: 'Jane',
            meta: {
                year: 2025
            }
        }
    });
    doc.setItem('item3', {
        id: 3,
        tags: [
            { name: 'tagA' },
            { name: 'tagB', info: { deepKey: true } }
        ]
    });

    // Search from root
    assert.deepStrictEqual(doc.findPath('year'), ['item1', 'details', 'meta'], 'Should find first nested key from root');

    // Search with basePath for top-level item
    assert.deepStrictEqual(doc.findPath('author', ['item2']), ['item2', 'details'], 'Should find key within specified top-level item');
    
    // Search with nested basePath
    assert.deepStrictEqual(doc.findPath('year', ['item2', 'details']), ['item2', 'details', 'meta'], 'Should find key within nested path');

    // Search for key in the base path object itself
    assert.deepStrictEqual(doc.findPath('year', ['item1', 'details', 'meta']), ['item1', 'details', 'meta'], 'Should return base path if key is in the base object');

    // Search for non-existent key
    assert.strictEqual(doc.findPath('title'), null, 'Should return null for non-existent key from root');
    assert.strictEqual(doc.findPath('nonexistent', ['item1']), null, 'Should return null for non-existent key within a path');

    // Search within a nested array
    assert.deepStrictEqual(doc.findPath('deepKey'), ['item3', 'tags', 1, 'info'], 'Should find key within a nested array');
});


// --- Synchronization Tests ---

test('Basic sync: one-way propagation', () => {
    const doc1 = new CollabJSON("[]");
    const doc2 = new CollabJSON("[]", {id: doc1.id});

    doc1.addItem(0, { text: 'a' });
    doc1.addItem(1, { text: 'b' });

    // Sync ops from 1 to 2
    doc1.ops.forEach(op => doc2.applyOp(op));

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
});

test('Concurrent array adds converge', () => {
    const doc1 = new CollabJSON("[]", {clientId: 'c1'});
    doc1.addItem(0, { text: 'common' });
    const doc2 = new CollabJSON("[]", {id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds
    doc1.addItem(1, { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.addItem(1, { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(doc1.getData().length, 3);
});

test('Concurrent sets converge', () => {
    const doc1 = new CollabJSON("{}", {clientId: 'c1'});
    doc1.setItem('common', { text: 'value' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds
    doc1.setItem('a', { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.setItem('b', { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(Object.keys(doc1.getData()).length, 3);
});

test('Concurrent update (LWW)', () => {
    const doc1 = new CollabJSON("{}", {clientId: 'c1'});
    doc1.setItem('item1', { text: 'original' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent updates. Force clock to determine winner.
    doc1.clock = 10;
    doc1.updateItem(['item1'], { text: 'update from 1' }); // This one is later
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
    doc2.updateItem(['item1'], { text: 'update from 2' }); // This one is earlier
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), { item1: { text: 'update from 1' } });
    assert.deepStrictEqual(doc2.getData(), { item1: { text: 'update from 1' } });
});

test('Concurrent delete and update converge', () => {
    const doc1 = new CollabJSON("{}", {clientId: 'c1'});
    doc1.setItem('item1', { text: 'original' });
    const doc2 = new CollabJSON({id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent update and delete
    doc1.clock = 10;
    doc1.removeItem('item1'); // delete wins (later timestamp)
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
    doc2.updateItem(['item1'], { text: 'update from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), {});
    assert.deepStrictEqual(doc2.getData(), {});
});

// --- Boundary and Error Tests ---

test('Throws error on invalid path for update (Object)', () => {
    const doc = new CollabJSON("{}");
    doc.setItem('a', { text: 'value a' });
    assert.throws(() => doc.updateItem(['b'], { text: 'value b' }), /Item not found/);
});

test('Throws error on invalid path for update (Array)', () => {
    const doc = new CollabJSON("[]");
    doc.addItem(0, { text: 'a' });
    assert.throws(() => doc.updateItem([1], { text: 'b' }), /Item not found/);
});

// --- DVV Sync Tests ---

test('getSyncRequest is repeatable', () => {
    const client = new CollabJSON("{}");
    client.setItem('a', { text: 'value a' });
    const req1 = client.getSyncRequest();
    const req2 = client.getSyncRequest();
    assert.deepStrictEqual(req1, req2);
    assert.strictEqual(req1.ops.length, 1);
});

test('applySyncResponse is idempotent', () => {
    const docId = 'doc1';
    const client = new CollabJSON("{}", { id: docId });
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });

    client.setItem('a', { text: 'value a' });
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
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client1 = new CollabJSON("{}", { clientId: 'c1', id: docId });
    const client2 = new CollabJSON("{}", { clientId: 'c2', id: docId });

    // C1 adds item, syncs with server
    client1.setItem('c1_item', { text: 'from c1' });
    let req1 = client1.getSyncRequest();
    let res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.deepStrictEqual(server.getData(), { c1_item: { text: 'from c1' } });

    // C2 syncs with server, gets C1's changes
    let req2 = client2.getSyncRequest();
    let res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    assert.deepStrictEqual(client2.getData(), { c1_item: { text: 'from c1' } });

    // C2 adds item, syncs with server
    client2.setItem('c2_item', { text: 'from c2' });
    req2 = client2.getSyncRequest();
    res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    assert.deepStrictEqual(server.getData(), { c1_item: { text: 'from c1' }, c2_item: { text: 'from c2' } });

    // C1 syncs again, gets C2's changes
    req1 = client1.getSyncRequest();
    res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.deepStrictEqual(client1.getData(), server.getData());
});

test('Concurrent setItem (LWW)', () => {
    const docId = 'doc1';
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client1 = new CollabJSON("{}", { clientId: 'c1', id: docId });
    const client2 = new CollabJSON("{}", { clientId: 'c2', id: docId });

    // C1 and C2 both set the same key. C2 has a higher clock, so it should win.
    client1.clock = 5;
    client1.setItem('item', { text: 'from c1' });
    client2.clock = 10;
    client2.setItem('item', { text: 'from c2' });

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
    assert.strictEqual(Object.keys(client1.getData()).length, 1);
    assert.deepStrictEqual(client1.getData(), { item: { text: 'from c2' } });
    assert.deepStrictEqual(client1.getData(), server.getData());
});



test('Client ops are pruned after successful sync', () => {
    const docId = 'prune-ops-doc';
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client = new CollabJSON("{}", { clientId: 'c1', id: docId });

    // 1. Client creates an operation
    client.setItem('op1', { text: 'value1' });
    assert.strictEqual(client.ops.length, 1);

    // 2. Client syncs with server
    const req1 = client.getSyncRequest();
    const res1 = server.getSyncResponse(req1);
    
    // 3. Client applies response
    client.applySyncResponse(res1);

    // 4. Assert local ops are pruned
    assert.strictEqual(client.ops.length, 0, 'Ops should be pruned after sync');

    // 5. Client creates another op to ensure log is still functional
    client.setItem('op2', { text: 'value2' });
    assert.strictEqual(client.ops.length, 1);

    const req2 = client.getSyncRequest();
    assert.strictEqual(req2.ops.length, 1, 'New sync request should contain only the new op');
    assert.strictEqual(req2.ops[0].value.text, 'value2');
});


test('Sync with a pruned server sends snapshot', () => {
    const docId = 'prune-doc';
    let server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client1 = new CollabJSON("{}", { clientId: 'c1', id: docId });
    const client2 = new CollabJSON("{}", { clientId: 'c2', id: docId }); // New client

    // Make > 100 ops from client1
    for (let i = 0; i < 101; i++) {
        client1.setItem(`item${i}`, { val: i });
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
