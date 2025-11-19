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
    assert.deepStrictEqual(indDoc.getData(), {});
});

test('Constructor initializes with nested data', () => {
    const objDoc = new CollabJSON('{"a": 1, "b": {"c": [10, 20]}}');
    assert.deepStrictEqual(objDoc.getData(), {"a": 1, "b": {"c": [10, 20]}});

    const arrDoc = new CollabJSON('[{"a": 1}, {"b": 2}]');
    assert.deepStrictEqual(arrDoc.getData(), [{"a": 1}, {"b": 2}]);
});

test('Top-level Array: addItem at beginning, middle, and end', () => {
    const doc = new CollabJSON("[]");
    doc.addItem([0], { text: 'a' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }]);
    doc.addItem([1], { text: 'c' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
    doc.addItem([1], { text: 'b' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
});

test('Top-level Array: deleteItem', () => {
    const doc = new CollabJSON('[{ "text": "a" }, { "text": "b" }, { "text": "c" }]');
    doc.deleteItem([1]);
    assert.deepStrictEqual(doc.getData(), [{ text: 'a' }, { text: 'c' }]);
});

test('Top-level Array: moveItem', () => {
    const doc = new CollabJSON('["a", "b", "c", "d"]');
    
    // Move 'a' to end
    doc.moveItem([], 0, 4);
    assert.deepStrictEqual(doc.getData(), ["b", "c", "d", "a"]);

    // Move 'd' to start
    doc.moveItem([], 2, 0);
    assert.deepStrictEqual(doc.getData(), ["d", "b", "c", "a"]);

    // Move 'b' between 'c' and 'a'
    doc.moveItem([], 1, 2);
    assert.deepStrictEqual(doc.getData(), ["d", "c", "b", "a"]);
});

test('Object: updateItem can add and overwrite keys', () => {
    const doc = new CollabJSON("{}");
    doc.updateItem(['a'], { text: 'value a' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'value a' } });
    doc.updateItem(['b'], { text: 'value b' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'value a' }, b: { text: 'value b' } });
    doc.updateItem(['a'], { text: 'new value a' });
    assert.deepStrictEqual(doc.getData(), { a: { text: 'new value a' }, b: { text: 'value b' } });
});

test('Array: updateItem', () => {
    const doc = new CollabJSON('[{ "text": "a" }, { "text": "b" }]');
    doc.updateItem([0], { text: 'A' });
    assert.deepStrictEqual(doc.getData(), [{ text: 'A' }, { text: 'b' }]);
});

test('Object: deleteItem', () => {
    const doc = new CollabJSON('{"a": 1, "b": 2, "c": 3}');
    doc.deleteItem(['b']);
    assert.deepStrictEqual(doc.getData(), { a: 1, c: 3 });
});

test('addItem can add property to an object', () => {
    const doc = new CollabJSON('{"a": {"b": 1}}');
    doc.addItem(['a', 'c'], 2);
    assert.deepStrictEqual(doc.getData(), { a: { b: 1, c: 2 } });
});

test('updateItem can create nested properties (upsert)', () => {
    const doc = new CollabJSON('{}');
    doc.updateItem(['a', 'b', 'c'], 'deep value');
    assert.deepStrictEqual(doc.getData(), { a: { b: { c: 'deep value' } } });
});

test('updateItem can add or update', () => {
    const doc = new CollabJSON('{"a": {"b": 1}}');
    doc.updateItem(['a', 'b', 'c'], 2);
    assert.deepStrictEqual(doc.getData(), { a: { b: { c: 2 } } });
    doc.updateItem(['a', 'b', 'c'], 3);
    assert.deepStrictEqual(doc.getData(), { a: { b: { c: 3 } } });
});

test('getData can retrieve a subtree by path', () => {
    const doc = new CollabJSON('{"a": {"b": [10, {"c": 20}]}, "d": 30}');
    
    // Get a nested object
    assert.deepStrictEqual(doc.getData(['a']), { b: [10, { c: 20 }] });
    
    // Get a nested array
    assert.deepStrictEqual(doc.getData(['a', 'b']), [10, { c: 20 }]);
    
    // Get a nested value from within an array
    assert.deepStrictEqual(doc.getData(['a', 'b', 1]), { c: 20 });
    assert.deepStrictEqual(doc.getData(['a', 'b', 1, 'c']), 20);

    // Get a top-level value
    assert.strictEqual(doc.getData(['d']), 30);

    // Get non-existent path
    assert.strictEqual(doc.getData(['a', 'x']), undefined);
    assert.strictEqual(doc.getData(['a', 'b', 5]), undefined);

    // Get root with empty path or no path
    assert.deepStrictEqual(doc.getData([]), { a: { b: [10, { c: 20 }] }, d: 30 });
    assert.deepStrictEqual(doc.getData(), { a: { b: [10, { c: 20 }] }, d: 30 });
});

test('findPath locates items', () => {
    const doc = new CollabJSON('{"a": {"b": [{"id": "x", "val": 10}, {"id": "y", "val": 20}]}}');
    
    // We need to get the internal IDs to test findPath reliably on array items
    const root = doc._traverse([]).node;
    const arrayNode = root.a.b;
    const sorted = doc._getSortedItems(arrayNode);
    const id1 = sorted[0].id;
    const id2 = sorted[1].id;

    assert.deepStrictEqual(doc.findPath(id1), ['a', 'b', 0]);
    assert.deepStrictEqual(doc.findPath(id2), ['a', 'b', 1]);
    
    // Find by key
    assert.deepStrictEqual(doc.findPath('val'), ['a', 'b', 0, 'val']); // Finds first occurrence
});

test('Successive updates to the same item are compressed', () => {
    const doc = new CollabJSON("{}");
    doc.updateItem(['item1'], { text: 'initial' });
    const firstTimestamp = doc.ops[0].timestamp;
    doc.updateItem(['item1'], { text: 'update 1' });
    assert.strictEqual(doc.ops.length, 1, 'Should compress subsequent updates to the same path');
    assert.deepStrictEqual(doc.ops[0].data, { text: 'update 1' });
    assert.ok(doc.ops[0].timestamp > firstTimestamp, 'Timestamp should be updated on compression');
});


test('Arbitrarily nested operations are CRDT-native', () => {
    const doc = new CollabJSON("{}");
    doc.updateItem(['a'], { b: { c: [ { d: 1 }, { d: 2 } ] } });

    // Nested addItem
    doc.addItem(['a', 'b', 'c', 1], { d: 1.5 });
    assert.deepStrictEqual(doc.getData().a.b.c, [ { d: 1 }, { d: 1.5 }, { d: 2 } ]);
    
    // Nested deleteItem on an array
    doc.deleteItem(['a', 'b', 'c', 0]);
    assert.deepStrictEqual(doc.getData().a.b.c, [ { d: 1.5 }, { d: 2 } ]);

    // Nested updateItem
    doc.updateItem(['a', 'b', 'c', 1, 'd'], 2.5);
    assert.deepStrictEqual(doc.getData().a.b.c, [ { d: 1.5 }, { d: 2.5 } ]);

    // Add a new key to a nested object
    doc.updateItem(['a', 'b', 'newKey'], 'newValue');
    assert.strictEqual(doc.getData().a.b.newKey, 'newValue');

    // Nested deleteItem on an object
    doc.deleteItem(['a', 'b', 'newKey']);
    assert.strictEqual(doc.getData().a.b.newKey, undefined);
});

test('Garbage collection removes tombstones', () => {
    const doc = new CollabJSON('{"a": 1, "b": 2}');
    doc.deleteItem(['a']);
    
    // Verify tombstone exists internally
    const root = doc._traverse([]).node;
    assert.ok(root.metadata.a._deleted === true);
    
    doc.purgeTombstones();
    
    // Verify tombstone is gone
    assert.ok(root.metadata.a === undefined);
    assert.ok(root.a === undefined);
    assert.deepStrictEqual(doc.getData(), { b: 2 });
});


// --- Synchronization Tests ---

test('Concurrent top-level array adds converge', () => {
    const doc1 = new CollabJSON("[]", {clientId: 'c1'});
    doc1.addItem([0], { text: 'common' });
    const doc2 = new CollabJSON("[]", {id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds
    doc1.addItem([1], { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.addItem([1], { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(doc1.getData().length, 3);
});

test('Concurrent nested array adds converge', () => {
    const doc1 = new CollabJSON("{}", {clientId: 'c1'});
    doc1.updateItem(['list'], ['common']);
    const doc2 = new CollabJSON("{}", {id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds to nested list
    doc1.addItem(['list', 1], { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.addItem(['list', 1], { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(doc1.getData().list.length, 3);
});


test('Concurrent sets converge', () => {
    const doc1 = new CollabJSON("{}", {clientId: 'c1'});
    doc1.updateItem(['common'], { text: 'value' });
    const doc2 = new CollabJSON("{}", {id: doc1.id, clientId: 'c2'});
    doc2.applyOp(doc1.ops[0]);

    // Concurrent adds
    doc1.updateItem(['a'], { text: 'from 1' });
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.updateItem(['b'], { text: 'from 2' });
    const op2 = doc2.ops[doc2.ops.length - 1];

    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
    assert.strictEqual(Object.keys(doc1.getData()).length, 3);
});

test('Concurrent update (LWW)', () => {
    const doc1 = new CollabJSON('{"item1": "original"}', {clientId: 'c1'});
    const doc2 = new CollabJSON('{"item1": "original"}', {id: doc1.id, clientId: 'c2'});

    doc1.clock = 10;
    doc1.updateItem(['item1'], 'update from 1'); // This one is later
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
    doc2.updateItem(['item1'], 'update from 2'); // This one is earlier
    const op2 = doc2.ops[doc2.ops.length - 1];

    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), { item1: 'update from 1' });
    assert.deepStrictEqual(doc2.getData(), { item1: 'update from 1' });
});

test('Concurrent delete and update converge', () => {
    const doc1 = new CollabJSON('{"item1": "original"}', {clientId: 'c1'});
    const doc2 = new CollabJSON('{"item1": "original"}', {id: doc1.id, clientId: 'c2'});

    doc1.clock = 10;
    doc1.deleteItem(['item1']); // delete wins (later timestamp)
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
    doc2.updateItem(['item1'], 'update from 2');
    const op2 = doc2.ops[doc2.ops.length - 1];

    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), {});
    assert.deepStrictEqual(doc2.getData(), {});
});

// --- DVV Sync Tests ---

test('Full client-server-client sync cycle', () => {
    const docId = 'doc1';
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client1 = new CollabJSON("{}", { clientId: 'c1', id: docId });
    const client2 = new CollabJSON("{}", { clientId: 'c2', id: docId });

    client1.updateItem(['c1_item'], { text: 'from c1' });
    let req1 = client1.getSyncRequest();
    let res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    let req2 = client2.getSyncRequest();
    let res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);
    assert.deepStrictEqual(client2.getData(), { c1_item: { text: 'from c1' } });

    client2.updateItem(['c2_item'], { text: 'from c2' });
    req2 = client2.getSyncRequest();
    res2 = server.getSyncResponse(req2);
    client2.applySyncResponse(res2);

    req1 = client1.getSyncRequest();
    res1 = server.getSyncResponse(req1);
    client1.applySyncResponse(res1);

    assert.deepStrictEqual(client1.getData(), server.getData());
});


test('Client ops are pruned after successful sync', () => {
    const docId = 'prune-ops-doc';
    const server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client = new CollabJSON("{}", { clientId: 'c1', id: docId });

    client.updateItem(['op1'], { text: 'value1' });
    const req1 = client.getSyncRequest();
    const res1 = server.getSyncResponse(req1);
    client.applySyncResponse(res1);
    assert.strictEqual(client.ops.length, 0, 'Ops should be pruned after sync');

    client.updateItem(['op2'], { text: 'value2' });
    assert.strictEqual(client.ops.length, 1);
    const req2 = client.getSyncRequest();
    assert.strictEqual(req2.ops.length, 1, 'New sync request should contain only the new op');
    assert.deepStrictEqual(req2.ops[0].data, { text: 'value2' });
});


test('Sync with a pruned server sends snapshot', () => {
    const docId = 'prune-doc';
    let server = new CollabJSON("{}", { clientId: 'server', id: docId });
    const client1 = new CollabJSON("{}", { clientId: 'c1', id: docId });

    for (let i = 0; i < 101; i++) {
        client1.updateItem([`item${i}`], { val: i });
    }
    
    let req1 = client1.getSyncRequest();
    server.getSyncResponse(req1);

    server.prune(() => {});
    assert.strictEqual(server.history.length, 50);
    assert.ok(server.snapshot);

    const serverState = server.toJSON();
    server = CollabJSON.fromJSON(serverState, { clientId: 'server' });

    const client2 = new CollabJSON("{}", { clientId: 'c2', id: docId });
    const req2 = client2.getSyncRequest();
    const res2 = server.getSyncResponse(req2);

    assert.strictEqual(res2.reset, true);
    assert.ok(res2.snapshot);

    client2.applySyncResponse(res2);
    assert.deepStrictEqual(client2.getData(), server.getData());
});


// Run all tests
runTests();
