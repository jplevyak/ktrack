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


// --- Synchronization Tests ---

test('Basic sync: one-way propagation', () => {
    const doc1 = new CollabJSON();
    const doc2 = new CollabJSON();

    doc1.addItem([0], { text: 'a' });
    doc1.addItem([1], { text: 'b' });

    // Sync ops from 1 to 2
    doc1.ops.forEach(op => doc2.applyOp(op));

    assert.deepStrictEqual(doc1.getData(), doc2.getData());
});

test('Concurrent adds at same position converge', () => {
    const doc1 = new CollabJSON();
    doc1.addItem([0], { text: 'common' });
    const doc2 = new CollabJSON();
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
    const doc1 = new CollabJSON();
    doc1.addItem([0], { text: 'original' });
    const doc2 = new CollabJSON();
    doc2.applyOp(doc1.ops[0]);

    // Concurrent updates. Force clock to determine winner.
    doc1.clock = 10;
    doc1.updateItem([0], { text: 'update from 1' }); // This one is later
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
    doc2.updateItem([0], { text: 'update from 2' }); // This one is earlier
    const op2 = doc2.ops[doc2.ops.length - 1];

    // Sync
    doc2.applyOp(op1);
    doc1.applyOp(op2);

    assert.deepStrictEqual(doc1.getData(), [{ text: 'update from 1' }]);
    assert.deepStrictEqual(doc2.getData(), [{ text: 'update from 1' }]);
});

test('Concurrent delete and update converge', () => {
    const doc1 = new CollabJSON();
    doc1.addItem([0], { text: 'original' });
    const doc2 = new CollabJSON();
    doc2.applyOp(doc1.ops[0]);

    // Concurrent update and delete
    doc1.clock = 10;
    doc1.deleteItem([0]); // delete wins (later timestamp)
    const op1 = doc1.ops[doc1.ops.length - 1];
    doc2.clock = 5;
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

// Run all tests
runTests();
