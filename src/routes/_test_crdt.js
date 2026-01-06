import { CollabJSON } from "./_crdt.js";
import assert from "assert";

let tests = [];
let failures = 0;

function test(description, fn) {
  tests.push({ description, fn });
}

function runTests() {
  console.log("Running CollabJSON tests...");
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

test("Initialization", () => {
  const doc = new CollabJSON("{}");
  assert.deepStrictEqual(doc.getData(), {});
  const arrDoc = new CollabJSON("[]");
  assert.deepStrictEqual(arrDoc.getData(), []);
  const indDoc = new CollabJSON();
  assert.deepStrictEqual(indDoc.getData(), {});
});

test("Constructor initializes with nested data", () => {
  const objDoc = new CollabJSON('{"a": 1, "b": {"c": [10, 20]}}');
  assert.deepStrictEqual(objDoc.getData(), { a: 1, b: { c: [10, 20] } });

  const arrDoc = new CollabJSON('[{"a": 1}, {"b": 2}]');
  assert.deepStrictEqual(arrDoc.getData(), [{ a: 1 }, { b: 2 }]);
});

test("Top-level Array: addItem at beginning, middle, and end", () => {
  const doc = new CollabJSON("[]");
  doc.addItem([0], { text: "a" });
  assert.deepStrictEqual(doc.getData(), [{ text: "a" }]);
  doc.addItem([1], { text: "c" });
  assert.deepStrictEqual(doc.getData(), [{ text: "a" }, { text: "c" }]);
  doc.addItem([1], { text: "b" });
  assert.deepStrictEqual(doc.getData(), [{ text: "a" }, { text: "b" }, { text: "c" }]);
});

test("Top-level Array: deleteItem", () => {
  const doc = new CollabJSON('[{ "text": "a" }, { "text": "b" }, { "text": "c" }]');
  doc.deleteItem([1]);
  assert.deepStrictEqual(doc.getData(), [{ text: "a" }, { text: "c" }]);
});

test("Top-level Array: moveItem", () => {
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

test("Object: updateItem can add and overwrite keys", () => {
  const doc = new CollabJSON("{}");
  doc.updateItem(["a"], { text: "value a" });
  assert.deepStrictEqual(doc.getData(), { a: { text: "value a" } });
  doc.updateItem(["b"], { text: "value b" });
  assert.deepStrictEqual(doc.getData(), { a: { text: "value a" }, b: { text: "value b" } });
  doc.updateItem(["a"], { text: "new value a" });
  assert.deepStrictEqual(doc.getData(), { a: { text: "new value a" }, b: { text: "value b" } });
});

test("Array: updateItem", () => {
  const doc = new CollabJSON('[{ "text": "a" }, { "text": "b" }]');
  doc.updateItem([0], { text: "A" });
  assert.deepStrictEqual(doc.getData(), [{ text: "A" }, { text: "b" }]);
});

test("Object: deleteItem", () => {
  const doc = new CollabJSON('{"a": 1, "b": 2, "c": 3}');
  doc.deleteItem(["b"]);
  assert.deepStrictEqual(doc.getData(), { a: 1, c: 3 });
});

test("addItem can add property to an object", () => {
  const doc = new CollabJSON('{"a": {"b": 1}}');
  doc.addItem(["a", "c"], 2);
  assert.deepStrictEqual(doc.getData(), { a: { b: 1, c: 2 } });
});

test("updateItem can create nested properties (upsert)", () => {
  const doc = new CollabJSON("{}");
  doc.updateItem(["a", "b", "c"], "deep value");
  assert.deepStrictEqual(doc.getData(), { a: { b: { c: "deep value" } } });
});

test("updateItem can add or update", () => {
  const doc = new CollabJSON('{"a": {"b": 1}}');
  doc.updateItem(["a", "b", "c"], 2);
  assert.deepStrictEqual(doc.getData(), { a: { b: { c: 2 } } });
  doc.updateItem(["a", "b", "c"], 3);
  assert.deepStrictEqual(doc.getData(), { a: { b: { c: 3 } } });
});

test("getData can retrieve a subtree by path", () => {
  const doc = new CollabJSON('{"a": {"b": [10, {"c": 20}]}, "d": 30}');

  // Get a nested object
  assert.deepStrictEqual(doc.getData(["a"]), { b: [10, { c: 20 }] });

  // Get a nested array
  assert.deepStrictEqual(doc.getData(["a", "b"]), [10, { c: 20 }]);

  // Get a nested value from within an array
  assert.deepStrictEqual(doc.getData(["a", "b", 1]), { c: 20 });
  assert.deepStrictEqual(doc.getData(["a", "b", 1, "c"]), 20);

  // Get a top-level value
  assert.strictEqual(doc.getData(["d"]), 30);

  // Get non-existent path
  assert.strictEqual(doc.getData(["a", "x"]), undefined);
  assert.strictEqual(doc.getData(["a", "b", 5]), undefined);

  // Get root with empty path or no path
  assert.deepStrictEqual(doc.getData([]), { a: { b: [10, { c: 20 }] }, d: 30 });
  assert.deepStrictEqual(doc.getData(), { a: { b: [10, { c: 20 }] }, d: 30 });
});

test("findPath locates items", () => {
  const doc = new CollabJSON('{"a": {"b": [{"id": "x", "val": 10}, {"id": "y", "val": 20}]}}');

  // We need to get the internal IDs to test findPath reliably on array items
  const root = doc._traverse([]).node;
  const arrayNode = root.a.b;
  const sorted = doc._getSortedItems(arrayNode);
  const id1 = sorted[0].id;
  const id2 = sorted[1].id;

  assert.deepStrictEqual(doc.findPath(id1), ["a", "b", 0]);
  assert.deepStrictEqual(doc.findPath(id2), ["a", "b", 1]);

  // Find by key
  assert.deepStrictEqual(doc.findPath("val"), ["a", "b", 0, "val"]); // Finds first occurrence
});

test("Successive updates to the same item are compressed", () => {
  const doc = new CollabJSON("{}");
  doc.updateItem(["item1"], { text: "initial" });
  const firstTimestamp = doc.ops[0].timestamp;
  doc.updateItem(["item1"], { text: "update 1" });
  assert.strictEqual(doc.ops.length, 1, "Should compress subsequent updates to the same path");
  assert.deepStrictEqual(doc.ops[0].data, { text: "update 1" });
  assert.ok(doc.ops[0].timestamp > firstTimestamp, "Timestamp should be updated on compression");
});

test("Arbitrarily nested operations are CRDT-native", () => {
  const doc = new CollabJSON("{}");
  doc.updateItem(["a"], { b: { c: [{ d: 1 }, { d: 2 }] } });

  // Nested addItem
  doc.addItem(["a", "b", "c", 1], { d: 1.5 });
  assert.deepStrictEqual(doc.getData().a.b.c, [{ d: 1 }, { d: 1.5 }, { d: 2 }]);

  // Nested deleteItem on an array
  doc.deleteItem(["a", "b", "c", 0]);
  assert.deepStrictEqual(doc.getData().a.b.c, [{ d: 1.5 }, { d: 2 }]);

  // Nested updateItem
  doc.updateItem(["a", "b", "c", 1, "d"], 2.5);
  assert.deepStrictEqual(doc.getData().a.b.c, [{ d: 1.5 }, { d: 2.5 }]);

  // Add a new key to a nested object
  doc.updateItem(["a", "b", "newKey"], "newValue");
  assert.strictEqual(doc.getData().a.b.newKey, "newValue");

  // Nested deleteItem on an object
  doc.deleteItem(["a", "b", "newKey"]);
  assert.strictEqual(doc.getData().a.b.newKey, undefined);
});

test("Garbage collection removes tombstones", () => {
  const doc = new CollabJSON('{"a": 1, "b": 2}');
  doc.deleteItem(["a"]);

  // Verify tombstone exists internally
  const root = doc._traverse([]).node;
  assert.ok(root.metadata.a._deleted === true);

  doc.purgeTombstones(undefined, Infinity);

  // Verify tombstone is gone
  assert.ok(root.metadata.a === undefined);
  assert.ok(root.a === undefined);
  assert.deepStrictEqual(doc.getData(), { b: 2 });
});

// --- Synchronization Tests ---

test("Concurrent top-level array adds converge", () => {
  const doc1 = new CollabJSON("[]", { clientId: "c1" });
  doc1.addItem([0], { text: "common" });
  const doc2 = new CollabJSON("[]", { id: doc1.id, clientId: "c2" });
  doc2.applyOp(doc1.ops[0]);

  // Concurrent adds
  doc1.addItem([1], { text: "from 1" });
  const op1 = doc1.ops[doc1.ops.length - 1];
  doc2.addItem([1], { text: "from 2" });
  const op2 = doc2.ops[doc2.ops.length - 1];

  doc2.applyOp(op1);
  doc1.applyOp(op2);

  assert.deepStrictEqual(doc1.getData(), doc2.getData());
  assert.strictEqual(doc1.getData().length, 3);
});

test("Concurrent nested array adds converge", () => {
  const doc1 = new CollabJSON("{}", { clientId: "c1" });
  doc1.updateItem(["list"], ["common"]);
  const doc2 = new CollabJSON("{}", { id: doc1.id, clientId: "c2" });
  doc2.applyOp(doc1.ops[0]);

  // Concurrent adds to nested list
  doc1.addItem(["list", 1], { text: "from 1" });
  const op1 = doc1.ops[doc1.ops.length - 1];
  doc2.addItem(["list", 1], { text: "from 2" });
  const op2 = doc2.ops[doc2.ops.length - 1];

  doc2.applyOp(op1);
  doc1.applyOp(op2);

  assert.deepStrictEqual(doc1.getData(), doc2.getData());
  assert.strictEqual(doc1.getData().list.length, 3);
});

test("Concurrent sets converge", () => {
  const doc1 = new CollabJSON("{}", { clientId: "c1" });
  doc1.updateItem(["common"], { text: "value" });
  const doc2 = new CollabJSON("{}", { id: doc1.id, clientId: "c2" });
  doc2.applyOp(doc1.ops[0]);

  // Concurrent adds
  doc1.updateItem(["a"], { text: "from 1" });
  const op1 = doc1.ops[doc1.ops.length - 1];
  doc2.updateItem(["b"], { text: "from 2" });
  const op2 = doc2.ops[doc2.ops.length - 1];

  doc2.applyOp(op1);
  doc1.applyOp(op2);

  assert.deepStrictEqual(doc1.getData(), doc2.getData());
  assert.strictEqual(Object.keys(doc1.getData()).length, 3);
});

test("Concurrent update (LWW)", () => {
  const doc1 = new CollabJSON('{"item1": "original"}', { clientId: "c1" });
  const doc2 = new CollabJSON('{"item1": "original"}', { id: doc1.id, clientId: "c2" });

  doc1.clock = 10;
  doc1.updateItem(["item1"], "update from 1"); // This one is later
  const op1 = doc1.ops[doc1.ops.length - 1];
  doc2.clock = 5;
  doc2.updateItem(["item1"], "update from 2"); // This one is earlier
  const op2 = doc2.ops[doc2.ops.length - 1];

  doc2.applyOp(op1);
  doc1.applyOp(op2);

  assert.deepStrictEqual(doc1.getData(), { item1: "update from 1" });
  assert.deepStrictEqual(doc2.getData(), { item1: "update from 1" });
});

test("Concurrent delete and update converge", () => {
  const doc1 = new CollabJSON('{"item1": "original"}', { clientId: "c1" });
  const doc2 = new CollabJSON('{"item1": "original"}', { id: doc1.id, clientId: "c2" });

  doc1.clock = 10;
  doc1.deleteItem(["item1"]); // delete wins (later timestamp)
  const op1 = doc1.ops[doc1.ops.length - 1];
  doc2.clock = 5;
  doc2.updateItem(["item1"], "update from 2");
  const op2 = doc2.ops[doc2.ops.length - 1];

  doc2.applyOp(op1);
  doc1.applyOp(op2);

  assert.deepStrictEqual(doc1.getData(), {});
  assert.deepStrictEqual(doc2.getData(), {});
});

// --- DVV Sync Tests ---

test("Full client-server-client sync cycle", () => {
  const docId = "doc1";
  const server = new CollabJSON("{}", { clientId: "server", id: docId });
  const client1 = new CollabJSON("{}", { clientId: "c1", id: docId });
  const client2 = new CollabJSON("{}", { clientId: "c2", id: docId });

  client1.updateItem(["c1_item"], { text: "from c1" });
  let req1 = client1.getSyncRequest();
  let res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  let req2 = client2.getSyncRequest();
  let res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);
  assert.deepStrictEqual(client2.getData(), { c1_item: { text: "from c1" } });

  client2.updateItem(["c2_item"], { text: "from c2" });
  req2 = client2.getSyncRequest();
  res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);

  req1 = client1.getSyncRequest();
  res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  assert.deepStrictEqual(client1.getData(), server.getData());
});

test("Client ops are pruned after successful sync", () => {
  const docId = "prune-ops-doc";
  const server = new CollabJSON("{}", { clientId: "server", id: docId });
  const client = new CollabJSON("{}", { clientId: "c1", id: docId });

  client.updateItem(["op1"], { text: "value1" });
  const req1 = client.getSyncRequest();
  const res1 = server.getSyncResponse(req1);
  client.applySyncResponse(res1);
  assert.strictEqual(client.ops.length, 0, "Ops should be pruned after sync");

  client.updateItem(["op2"], { text: "value2" });
  assert.strictEqual(client.ops.length, 1);
  const req2 = client.getSyncRequest();
  assert.strictEqual(req2.ops.length, 1, "New sync request should contain only the new op");
  assert.deepStrictEqual(req2.ops[0].data, { text: "value2" });
});

test("Sync with a pruned server sends snapshot", () => {
  const docId = "prune-doc";
  let server = new CollabJSON("{}", { clientId: "server", id: docId });
  const client1 = new CollabJSON("{}", { clientId: "c1", id: docId });

  for (let i = 0; i < 250; i++) {
    client1.updateItem([`item${i}`], { val: i });
  }

  let req1 = client1.getSyncRequest();
  server.getSyncResponse(req1);

  server.prune(() => { });
  assert.strictEqual(server.history.length, 100);
  assert.ok(server.snapshot);

  const serverState = server.toJSON();
  server = CollabJSON.fromJSON(serverState, { clientId: "server" });

  const client2 = new CollabJSON("{}", { clientId: "c2", id: docId });
  const req2 = client2.getSyncRequest();
  const res2 = server.getSyncResponse(req2);

  assert.strictEqual(res2.reset, true);
  assert.ok(res2.snapshot);

  client2.applySyncResponse(res2);
  assert.deepStrictEqual(client2.getData(), server.getData());
});

// --- Upload / Server Overwrite Tests ---

test("Upload: Server overwrite propagates to client", () => {
  const docId = "upload-doc-1";
  const server = new CollabJSON('{"list": ["a"]}', { clientId: "server", id: docId });
  const client = new CollabJSON('{"list": ["a"]}', { clientId: "c1", id: docId });

  // Simulate upload: Server replaces root content
  const newData = { list: ["b"] };
  server.updateItem([], newData);

  // Client syncs
  const req = client.getSyncRequest();
  const res = server.getSyncResponse(req);
  client.applySyncResponse(res);

  assert.deepStrictEqual(client.getData(), newData);
});

test("Upload: Client ops predating upload are overwritten (LWW)", () => {
  const docId = "upload-doc-2";
  const server = new CollabJSON('{"key": "initial"}', { clientId: "server", id: docId });
  const client = new CollabJSON('{"key": "initial"}', { clientId: "c1", id: docId });

  // Sync initial state
  client.applySyncResponse(server.getSyncResponse(client.getSyncRequest()));

  // Client makes a change (Timestamp T1)
  client.updateItem(["key"], "client");

  // Server receives upload (Timestamp T2 > T1)
  // We ensure server clock is ahead or we rely on tick() incrementing
  server.clock = client.clock + 10;
  server.updateItem([], { key: "server" });

  // Client syncs
  const req = client.getSyncRequest();
  const res = server.getSyncResponse(req);
  client.applySyncResponse(res);

  // Since server op (upload) is newer, it should win
  assert.deepStrictEqual(client.getData(), { key: "server" });
});

test("Upload: Client ops postdating upload persist", () => {
  const docId = "upload-doc-3";
  const server = new CollabJSON('{"key": "initial"}', { clientId: "server", id: docId });
  const client = new CollabJSON('{"key": "initial"}', { clientId: "c1", id: docId });

  // Server receives upload (Timestamp T1)
  server.updateItem([], { key: "server" });

  // Client syncs and gets the upload state
  let req = client.getSyncRequest();
  let res = server.getSyncResponse(req);
  client.applySyncResponse(res);
  assert.deepStrictEqual(client.getData(), { key: "server" });

  // Client makes a change (Timestamp T2 > T1)
  client.updateItem(["key"], "client");

  // Client syncs again
  req = client.getSyncRequest();
  res = server.getSyncResponse(req);
  client.applySyncResponse(res);

  // Server should accept client's newer change
  server.applyOp(req.ops[0]); // Simulate server processing request

  assert.deepStrictEqual(server.getData(), { key: "client" });
  assert.deepStrictEqual(client.getData(), { key: "client" });
});

// --- _plainToCrdt Logic Tests ---

test("_plainToCrdt: Array reordering preserves IDs", () => {
  const doc = new CollabJSON('[{ "id": "A", "val": 1 }, { "id": "B", "val": 2 }]');

  // Get original IDs
  const originalItems = doc._getSortedItems(doc.root);
  const idA = originalItems[0].id;
  const idB = originalItems[1].id;

  // Update with swapped order, including IDs to ensure matching
  doc.updateItem(
    [],
    [
      { id: "B", val: 2 },
      { id: "A", val: 1 },
    ],
  );

  const newItems = doc._getSortedItems(doc.root);

  // Check data is correct
  assert.deepStrictEqual(doc.getData(), [
    { id: "B", val: 2 },
    { id: "A", val: 1 },
  ]);

  // Check IDs are preserved (content matching)
  // The item with val:2 should have idB
  assert.strictEqual(newItems[0].id, idB);
  // The item with val:1 should have idA
  assert.strictEqual(newItems[1].id, idA);
});

test("_plainToCrdt: Array item deletion", () => {
  // We use explicit IDs because content-based matching was removed to avoid ambiguity.
  const doc = new CollabJSON('[{ "id": "A", "val": 1 }, { "id": "B", "val": 2 }]');

  // Update with one item removed
  doc.updateItem([], [{ id: "A", val: 1 }]);

  assert.deepStrictEqual(doc.getData(), [{ id: "A", val: 1 }]);

  // Verify internal deletion (tombstone)
  const root = doc._traverse([]).node;
  const items = Object.values(root.items);
  const deletedItem = items.find((i) => i._deleted);
  assert.ok(deletedItem, "Should have a deleted item tombstone");
  assert.deepStrictEqual(doc._crdtToPlain(deletedItem.data), { id: "B", val: 2 });
});

test("_plainToCrdt: Object key deletion", () => {
  const doc = new CollabJSON('{"a": 1, "b": 2}');

  // Update with key 'b' removed
  doc.updateItem([], { a: 1 });

  assert.deepStrictEqual(doc.getData(), { a: 1 });

  // Verify tombstone
  const root = doc._traverse([]).node;
  assert.ok(root.metadata.b._deleted, "Metadata for b should be marked deleted");
});

test("_plainToCrdt: Nested object updates", () => {
  const doc = new CollabJSON('{"a": {"x": 1, "y": 2}}');

  // Update nested object: change x, remove y, add z
  doc.updateItem([], { a: { x: 10, z: 3 } });

  assert.deepStrictEqual(doc.getData(), { a: { x: 10, z: 3 } });
});

test("_plainToCrdt: Type switching (Object to Array)", () => {
  const doc = new CollabJSON('{"a": 1}');

  // Overwrite object with array
  doc.updateItem([], [1, 2]);

  assert.deepStrictEqual(doc.getData(), [1, 2]);

  // Verify internal structure changed
  const root = doc._traverse([]).node;
  assert.ok(root["_crdt_array_"], "Root should be marked as CRDT array");
});

test("_plainToCrdt: Type switching (Array to Object)", () => {
  const doc = new CollabJSON("[1, 2]");

  // Overwrite array with object
  doc.updateItem([], { a: 1 });

  assert.deepStrictEqual(doc.getData(), { a: 1 });

  // Verify internal structure changed
  const root = doc._traverse([]).node;
  assert.ok(!root["_crdt_array_"], "Root should NOT be marked as CRDT array");
});

test("Sync: Server ops are filtered if client has seen them", () => {
  const docId = "filter-test";
  const server = new CollabJSON("{}", { clientId: "server", id: docId });
  const client = new CollabJSON("{}", { clientId: "c1", id: docId });

  // Server generates op
  server.updateItem(["key"], "value");

  // Client syncs 1
  let req = client.getSyncRequest();
  let res = server.getSyncResponse(req);
  client.applySyncResponse(res);

  assert.deepStrictEqual(client.getData(), { key: "value" });
  // Verify client has server in DVV
  assert.ok(client.dvv.has("server"));
  // Fix: Compare against server's DVV, not server's internal clock counter
  assert.strictEqual(client.dvv.get("server"), server.dvv.get("server"));

  // Client syncs 2
  req = client.getSyncRequest();
  // Verify request DVV has server
  assert.ok("server" in req.dvv);

  res = server.getSyncResponse(req);

  // Should receive NO ops
  assert.strictEqual(res.ops.length, 0, "Client should not receive already seen server ops");
});

test("Upload: Regression check - Client receives upload op but LWW preserves newer local change", () => {
  const docId = "upload-regression";
  const server = new CollabJSON('{"key": "initial"}', { clientId: "server", id: docId });
  const client = new CollabJSON('{"key": "initial"}', { clientId: "c1", id: docId });

  // 1. Client syncs to get initial state
  client.applySyncResponse(server.getSyncResponse(client.getSyncRequest()));

  // 2. Server receives upload (Timestamp T1)
  // We simulate upload by updating server directly
  server.updateItem([], { key: "server" });
  const uploadOp = server.history[server.history.length - 1];

  // 3. Client makes a change (Timestamp T2 > T1)
  // Ensure client clock is ahead
  client.clock = server.clock + 10;
  client.updateItem(["key"], "client");

  // 4. Client syncs
  // Client DVV does NOT contain T1 yet (because it hasn't synced since upload)
  const req = client.getSyncRequest();
  const res = server.getSyncResponse(req);

  // Server SHOULD send the upload op because client hasn't seen it
  assert.ok(
    res.ops.find((op) => op.timestamp === uploadOp.timestamp),
    "Server should send upload op",
  );

  // 5. Client applies sync response
  client.applySyncResponse(res);

  // 6. Verify LWW: Client change (T2) should win over Upload (T1)
  assert.deepStrictEqual(client.getData(), { key: "client" });
});

test("Upload: Clients can exchange array updates after upload", () => {
  const docId = "upload-array-exchange";
  const server = new CollabJSON("[]", { clientId: "server", id: docId });
  const client1 = new CollabJSON("[]", { clientId: "c1", id: docId });
  const client2 = new CollabJSON("[]", { clientId: "c2", id: docId });

  // 1. Upload happens (Server sets initial state)
  server.updateItem([], [{ id: "item1", val: "uploaded" }]);

  // 2. Clients sync to get upload
  // Client 1 sync
  let req1 = client1.getSyncRequest();
  let res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  // Client 2 sync
  let req2 = client2.getSyncRequest();
  let res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);

  assert.deepStrictEqual(client1.getData(), [{ id: "item1", val: "uploaded" }]);
  assert.deepStrictEqual(client2.getData(), [{ id: "item1", val: "uploaded" }]);

  // 3. Client 1 adds an item at the end
  client1.addItem([1], { id: "item2", val: "c1-add" });

  // 4. Client 2 deletes the uploaded item (index 0) and adds another at the beginning
  client2.deleteItem([0]);
  client2.addItem([0], { id: "item3", val: "c2-add" });

  // 5. Sync Client 1 -> Server
  req1 = client1.getSyncRequest();
  res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1); // C1 gets nothing new yet

  // 6. Sync Client 2 -> Server
  req2 = client2.getSyncRequest();
  res2 = server.getSyncResponse(req2); // Server gets C2 ops, sends C1 ops to C2
  client2.applySyncResponse(res2);

  // 7. Sync Client 1 -> Server (to get C2's ops)
  req1 = client1.getSyncRequest();
  res1 = server.getSyncResponse(req1); // Server sends C2 ops to C1
  client1.applySyncResponse(res1);

  // 8. Verify convergence
  const serverData = server.getData();
  const c1Data = client1.getData();
  const c2Data = client2.getData();

  assert.deepStrictEqual(c1Data, c2Data);
  assert.deepStrictEqual(c1Data, serverData);

  // Verify content
  assert.strictEqual(c1Data.length, 2);
  const item2 = c1Data.find((i) => i.id === "item2");
  const item3 = c1Data.find((i) => i.id === "item3");
  assert.ok(item2, "Item 2 should exist");
  assert.ok(item3, "Item 3 should exist");
  assert.strictEqual(item2.val, "c1-add");
  assert.strictEqual(item3.val, "c2-add");
  assert.ok(!c1Data.find((i) => i.id === "item1"), "Item 1 should be deleted");

  // Expected order: item3 (sortKey 0.5), item2 (sortKey 2.0)
  assert.deepStrictEqual(c1Data, [
    { id: "item3", val: "c2-add" },
    { id: "item2", val: "c1-add" },
  ]);
});

test("Upload: Deleted item from upload is not seen by new client", () => {
  const docId = "upload-delete-new-client";
  const server = new CollabJSON("[]", { clientId: "server", id: docId });
  const client1 = new CollabJSON("[]", { clientId: "c1", id: docId });

  // 1. Upload happens (Server sets initial state with 2 items)
  server.updateItem(
    [],
    [
      { id: "item1", val: "A" },
      { id: "item2", val: "B" },
    ],
  );

  // 2. Client 1 syncs to get upload
  let req1 = client1.getSyncRequest();
  let res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  assert.deepStrictEqual(client1.getData(), [
    { id: "item1", val: "A" },
    { id: "item2", val: "B" },
  ]);

  // 3. Client 1 deletes item1
  // item1 should be at index 0 because _plainToCrdt assigns sortKeys 1.0, 2.0
  client1.deleteItem([0]);

  // 4. Client 1 syncs deletion to server
  req1 = client1.getSyncRequest();
  res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1); // Ack

  // Verify server state
  assert.deepStrictEqual(server.getData(), [{ id: "item2", val: "B" }]);

  // Verify client 1 state
  assert.deepStrictEqual(client1.getData(), [{ id: "item2", val: "B" }]);

  // 5. Client 2 is created
  const client2 = new CollabJSON("[]", { clientId: "c2", id: docId });

  // 6. Client 2 syncs
  let req2 = client2.getSyncRequest();
  let res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);

  // 7. Verify Client 2 state
  assert.deepStrictEqual(client2.getData(), [{ id: "item2", val: "B" }]);
});

test("Upload from client: seen by all clients", () => {
  const docId = "upload-delete-new-client";
  const server = new CollabJSON("[]", { clientId: "server", id: docId });
  const client1 = new CollabJSON("[]", { clientId: "c1", id: docId });
  const client2 = new CollabJSON("[]", { clientId: "c2", id: docId });

  // 1. Upload happens (Server sets initial state with 2 items)
  server.updateItem(
    [],
    [
      { id: "item1", val: "A" },
      { id: "item2", val: "B" },
    ],
  );

  // 2. Client 1 syncs to get upload
  let req1 = client1.getSyncRequest();
  let res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  assert.deepStrictEqual(client1.getData(), [
    { id: "item1", val: "A" },
    { id: "item2", val: "B" },
  ]);

  // 3. Client 2 syncs to get upload
  let req2 = client2.getSyncRequest();
  let res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);

  assert.deepStrictEqual(client2.getData(), [
    { id: "item1", val: "A" },
    { id: "item2", val: "B" },
  ]);

  // 4. Client 2 uploads and syncs to the server
  client2.updateItem(
    [],
    [
      { id: "item1", val: "B" },
      { id: "item2", val: "A" },
    ],
  );
  req2 = client2.getSyncRequest();
  res2 = server.getSyncResponse(req2);
  client2.applySyncResponse(res2);

  // 5. Client 1 syncs to get upload
  req1 = client1.getSyncRequest();
  res1 = server.getSyncResponse(req1);
  client1.applySyncResponse(res1);

  assert.deepStrictEqual(client1.getData(), [
    { id: "item1", val: "B" },
    { id: "item2", val: "A" },
  ]);

  // Verify server state
  assert.deepStrictEqual(server.getData(), [
    { id: "item1", val: "B" },
    { id: "item2", val: "A" },
  ]);
});

test("replaceData: Resets server state and forces client reset", () => {
  const docId = "replace-data-doc";
  const server = new CollabJSON('{"key": "initial"}', { clientId: "server", id: docId });
  const client = new CollabJSON('{"key": "initial"}', { clientId: "c1", id: docId });

  // 1. Sync initial state
  client.applySyncResponse(server.getSyncResponse(client.getSyncRequest()));

  // 2. Client makes changes
  client.updateItem(["key"], "client-value");

  // 3. Server replaces data
  server.replaceData('{"key": "replaced", "new": "value"}');

  // 4. Client syncs
  const req = client.getSyncRequest();
  const res = server.getSyncResponse(req);

  // 5. Verify reset
  assert.strictEqual(res.reset, true, "Server should request reset");
  assert.ok(res.snapshot, "Server should send snapshot");

  client.applySyncResponse(res);

  // 6. Verify client state matches replaced data
  assert.deepStrictEqual(client.getData(), { key: "replaced", new: "value" });

  // 7. Verify client history/ops cleared (implicit in reset handling)
  assert.strictEqual(client.ops.length, 0);
});

// Run all tests

test("addItem uses data.id if present", () => {
  const doc = new CollabJSON("{}");
  doc.updateItem(["list"], []);

  // Add item with explicit ID in data
  doc.addItem(["list", 0], { id: "explicit-id", value: "foo" });

  const data = doc.getData();
  assert.equal(data.list.length, 1);
  assert.equal(data.list[0].value, "foo");

  // Verify internal ID usage (white-box test)
  // Traverse to list array
  const result = doc._traverse(["list"]);
  const listNode = result.node;

  // Check if the item is stored under 'explicit-id'
  assert.ok(listNode.items["explicit-id"]);
  assert.equal(listNode.items["explicit-id"].data.value, "foo");
});

test("findPathIn supports scoped search", () => {
  const doc = new CollabJSON("{}");
  // Create two lists
  doc.updateItem(["listA"], []);
  doc.updateItem(["listB"], []);

  // Add item with same ID 'item1' to both lists
  doc.addItem(["listA", 0], { id: "item1", value: "A" });
  doc.addItem(["listB", 0], { id: "item1", value: "B" });

  // Global findPath should find the first one (DFS order)
  const globalPath = doc.findPath("item1");
  assert.deepStrictEqual(globalPath, ["listA", 0]);

  // Scoped search in listA
  const pathA = doc.findPathIn(["listA"], "item1");
  assert.deepStrictEqual(pathA, ["listA", 0]);

  // Scoped search in listB
  const pathB = doc.findPathIn(["listB"], "item1");
  assert.deepStrictEqual(pathB, ["listB", 0]); // Should find the one in listB

  // Search in non-existent path
  const pathFail = doc.findPathIn(["nonexistent"], "item1");
  assert.strictEqual(pathFail, null);
});

// --- Optimization Tests ---

test("Redundant Update Check", () => {
  const doc = new CollabJSON();
  doc.addItem([0], { id: "item1", name: "original" });

  // Initial ops: ADD_ITEM
  const initialOpsCount = doc.ops.length;
  assert.strictEqual(initialOpsCount, 1, "Initial add should create 1 op");

  const path = doc.findPath("item1");
  const propPath = [...path, 'name'];

  // Redundant update
  doc.updateItem(propPath, "original");

  assert.strictEqual(doc.ops.length, initialOpsCount, "Redundant update should not add op");

  // Non-redundant update
  doc.updateItem(propPath, "changed");
  assert.strictEqual(doc.ops.length, initialOpsCount + 1, "Non-redundant update should add op");
});

test("Delete Pruning (Updates)", () => {
  const doc = new CollabJSON();
  doc.addItem([0], { id: "item2", name: "to-be-updated" });

  // Commit ops so we have a baseline (simulating synced state for the ADD)
  doc.commitOps();
  assert.strictEqual(doc.ops.length, 0, "Ops cleared after commit");

  const path = doc.findPath("item2");
  doc.updateItem([...path, "name"], "updated");

  assert.strictEqual(doc.ops.length, 1, "Update op added");
  assert.strictEqual(doc.ops[0].type, "UPDATE_ITEM", "Op is UPDATE_ITEM");

  // Now delete
  doc.deleteItem(path);

  // Expectation: The UPDATE_ITEM should be gone. The DELETE_ITEM should be present.
  const ops = doc.ops;
  const hasUpdate = ops.some(op => op.type === "UPDATE_ITEM");
  const hasDelete = ops.some(op => op.type === "DELETE_ITEM");

  assert.strictEqual(hasUpdate, false, "Pending update should be pruned");
  assert.strictEqual(hasDelete, true, "Delete op should be present (since item existed on server)");
});

test("Delete Pruning (Add + Delete)", () => {
  const doc = new CollabJSON();

  doc.addItem([0], { id: "item3", name: "temporary" });
  assert.strictEqual(doc.ops.length, 1, "Add op created");

  const path = doc.findPath("item3");

  doc.deleteItem(path);

  // Expectation: Both ADD and DELETE should be gone.
  assert.strictEqual(doc.ops.length, 0, "Both Add and Delete ops should be removed");
});

test("diffUpdate: Granular Object Updates", () => {
  const doc = new CollabJSON('{"a": 1, "b": {"x": 10, "y": 20}}');
  const initialOps = doc.ops.length;

  // Update only b.x, leave b.y alone
  doc.diffUpdate([], { a: 1, b: { x: 100, y: 20 } });

  // Should generate 1 op: update b.x
  // (a is same, b.y is same)
  const newOps = doc.ops.slice(initialOps);

  assert.strictEqual(newOps.length, 1);
  assert.strictEqual(newOps[0].type, "UPDATE_ITEM");
  assert.deepStrictEqual(newOps[0].path, ["b", "x"]);
  assert.strictEqual(newOps[0].data, 100);

  assert.deepStrictEqual(doc.getData(), { a: 1, b: { x: 100, y: 20 } });
});

test("diffUpdate: Implicit Deletions", () => {
  const doc = new CollabJSON('{"a": 1, "b": 2}');

  // Implicitly delete b by omitted it
  doc.diffUpdate([], { a: 1 });

  const ops = doc.ops;
  const deleteOp = ops.find(op => op.type === "DELETE_ITEM");

  assert.ok(deleteOp, "Should generate delete op");
  assert.deepStrictEqual(deleteOp.path, ["b"]);
  assert.deepStrictEqual(doc.getData(), { a: 1 });
});

test("diffUpdate: Nested Additions", () => {
  const doc = new CollabJSON('{"a": 1}');

  doc.diffUpdate([], { a: 1, b: { c: 3 } });

  const ops = doc.ops;
  const addOp = ops.find(op => op.type === "UPDATE_ITEM" && op.path.includes("b"));

  assert.ok(addOp);
  assert.deepStrictEqual(addOp.path, ["b"]);
  assert.deepStrictEqual(doc.getData(), { a: 1, b: { c: 3 } });
});

test("save_history behavior: diffUpdate compresses repeated serving updates", () => {
  // 1. Setup 'History' doc (Root Array, mirroring make_history)
  const history = new CollabJSON('[]', {
    idGenerator: (item) => item.timestamp,
    sortKeyGenerator: (item) => item.timestamp ? -parseInt(item.timestamp.replace(/-/g, "").slice(0, 8)) : null
  });

  // 2. Setup 'Today' data
  const todayData = {
    timestamp: "2023-01-01",
    items: [
      { id: "food1", name: "Apple", servings: 1.0 }
    ]
  };

  // 3. Simulate first save_history (Upsert)
  // Logic from save_history: not found -> upsert
  // We assume history is empty first, so not found.
  history.upsertItemWithSortKey(
    ["items"],
    { ...todayData, id: todayData.timestamp },
    -20230101
  );

  const initialOps = history.ops.length;
  assert.strictEqual(initialOps, 1, "Initial save should be 1 op (ADD_ITEM)");

  // 4. Update 'Today' (servings changed)
  todayData.items[0].servings = 1.5;

  // 5. Simulate second save_history (Diff Update)
  // Logic: found -> diffUpdate
  const existingPath = history.findPath(todayData.timestamp);
  assert.ok(existingPath, "History should have the day");

  // save_history now includes id in diffUpdate to prevent deletion
  history.diffUpdate(existingPath, { ...todayData, id: todayData.timestamp });

  // Check ops after first update
  // Should be 2 ops: 1 Add + 1 Update Items
  assert.strictEqual(history.ops.length, 2, "First update should result in 2 ops total");

  // 6. Third Update (Repeated)
  todayData.items[0].servings = 2.0;
  history.diffUpdate(existingPath, { ...todayData, id: todayData.timestamp });

  // Should still be 2 ops (compressed)
  assert.strictEqual(history.ops.length, 2, "Second update should be compressed");

  // 7. Fourth Update (Repeated)
  todayData.items[0].servings = 2.5;
  history.diffUpdate(existingPath, { ...todayData, id: todayData.timestamp });

  // Should still be 2 ops (compressed)
  assert.strictEqual(history.ops.length, 2, "Third update should be compressed");

  // Verify final data
  // First day in history list (Root array has only 1 item)
  // getData() returns array [ { ... } ]
  const historyList = history.getData();
  const dayEntry = historyList[0];

  assert.strictEqual(dayEntry.timestamp, "2023-01-01");
  // items is the array [ { food1, servings: 2.5 } ]
  assert.strictEqual(dayEntry.items[0].servings, 2.5);
});

runTests();
