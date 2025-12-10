# CollabJSON CRDT Implementation

## 1. Introduction

Conflict-free Replicated Data Types (CRDTs) are data structures that allow for concurrent modifications across multiple replicas (e.g., clients and servers) and can be merged without conflicts.

This repository contains a specific CRDT implementation named `CollabJSON`. It is designed to handle general JSON-like documents (objects and arrays). Its key features are:

*   **Unified Data Model**: Every array, no matter how deeply nested, is a CRDT-native array, allowing for conflict-free concurrent insertions.
*   **Operation-based CRDT**: It works by replicating operations between replicas rather than entire states.
*   **Lamport Timestamps**: Each operation is assigned a causally-ordered timestamp to ensure that effects are applied in a logical order.
*   **Last-Write-Wins (LWW)**: Conflicts on object properties (e.g., two clients updating the same field concurrently) are resolved by giving precedence to the operation with the higher timestamp.
*   **Fractional Indexing**: Items within CRDT-native arrays are ordered using fractional numbers (`sortKey`), which allows for inserting items between any two existing items without re-indexing.
*   **Client-Server Architecture**: The synchronization mechanism is designed for a star-schema topology where multiple clients communicate with a single central server and not directly with each other.
*   **Dotted Version Vectors (DVV)**: Synchronization is made efficient by using DVVs. Each replica tracks the latest timestamp it has seen from every other replica, allowing it to request only the operations it hasn't seen yet.
*   **Snapshotting and Compaction**: To prevent the operation history from growing indefinitely, the server can compact its history into a snapshot. Clients that are too far behind will receive this snapshot instead of a long list of operations.

## 2. API Reference

### `new CollabJSON(jsonString, options)`

Creates a new `CollabJSON` document.

*   `jsonString` (String, optional): A string of a JSON object or array to initialize the document with.
*   `options` (Object):
    *   `id` (String): A unique identifier for the document. If two instances share an `id`, they are considered replicas of the same document. Defaults to a new UUID.
    *   `clientId` (String): A unique identifier for the current replica (client or server). Defaults to a new UUID.

### `getData(path)`

Returns the current state of the document as a plain JavaScript object or array. This is useful for rendering the data in a UI.

*   `path` (Array, optional): A path array to retrieve a specific subtree or value. If omitted, returns the entire document.

### `addItem(path, data)`

Adds a new item to the document. This function is polymorphic:

*   If the last segment of the `path` is a **number**, it performs a CRDT-native insertion into the array specified by the preceding path segments.
*   If the last segment of the `path` is a **string**, it acts as an alias for `updateItem`, setting a property on an object.

*   `path` (Array of strings and numbers): The path to the location for the new item.
*   `data` (any): The data to insert. This must be JSON-serializable.

### `updateItem(path, newData)`

Updates or inserts a value at a specified path. This is an "upsert" operation:

*   If the path already exists, the value is updated.
*   If the path does not exist, any necessary nested objects are created automatically.

*   `path` (Array of strings and numbers): The path to the item to be updated or created.
*   `newData` (any): The new data for the item. This must be JSON-serializable.

### `deleteItem(path)`

Marks an item in an array or a property on an object as deleted.

*   `path` (Array of strings and numbers): The path to the item to be deleted.

### `moveItem(path, fromIndex, toIndex)`

Moves an item within a CRDT-native array.

*   `path` (Array): The path to the array containing the item.
*   `fromIndex` (Number): The current index of the item to move.
*   `toIndex` (Number): The new index for the item.

### `findPath(targetId)`

Finds the path to a node with a specific ID (for array items) or key.

*   `targetId` (String): The ID or key to search for.
*   Returns `Array` (the path) or `null` if not found.

### `findPathIn(subPath, targetId)`

Finds the path to a node with a specific ID within a sub-tree of the document. This is useful for resolving ambiguity when IDs are not globally unique.

*   `subPath` (Array): The path to the root of the sub-tree to search in.
*   `targetId` (String): The ID or key to search for.
*   Returns `Array` (the absolute path) or `null` if not found.

### `clear()`

Resets the document to an empty state. This clears the root data, history, vector clocks, and snapshots.

### `applyOp(op)`

Applies a single operation to the document. This is used during synchronization to apply remote operations.

*   `op` (Object): The operation object.

### `prune(pruneFn, clientRequestData)`

*(Server-side)* Compacts the document's history to save space. It creates a snapshot of the current state, stores the current DVV, and clears the historical operation log.

*   `pruneFn` (Function): A function that is given the `CollabJSON` instance and the client request data to perform any application-specific pruning on the data *before* the snapshot is created.
*   `clientRequestData` (Object): The data from the client request, passed to `pruneFn`.

### `toJSON()`

*(Server-side)* Serializes the entire state of the document (including history, DVV, and snapshot) into a plain JavaScript object suitable for storage (e.g., in a database).

### `static CollabJSON.fromJSON(state, options)`

*(Server-side)* A static method to reconstruct a `CollabJSON` document from its serialized state.

*   `state` (Object): The plain object retrieved from storage.
*   `options` (Object): Constructor options, primarily to set a `clientId`.

### `static CollabJSON.fromSnapshot(snapshot, snapshotDvv, docId, options)`

*(Server-side)* Creates a new `CollabJSON` instance initialized from a snapshot.

*   `snapshot` (Object): The data snapshot.
*   `snapshotDvv` (Object): The dotted version vector associated with the snapshot.
*   `docId` (String): The document ID.
*   `options` (Object): Constructor options.

### `static CollabJSON.loadOrInit(stateString, syncRequest, defaultJson, options)`

*(Server-side)* A convenience factory method to load a document from a database string, or initialize it from a client's sync request (if it contains a snapshot), or fall back to a default JSON structure. It automatically sets the `clientId` to 'server' unless overridden in options.

*   `stateString` (String|null): The serialized JSON string from the database.
*   `syncRequest` (Object): The incoming sync request from a client.
*   `defaultJson` (String): A JSON string representing the default state if no other state is available.
*   `options` (Object): Constructor options.

### `static CollabJSON.fromOps(ops)`

Creates a temporary `CollabJSON` instance by applying a list of operations. Useful for inspecting the state implied by a set of operations without affecting the main document.

*   `ops` (Array): An array of operation objects.

### `static CollabJSON.fromSyncRequest(syncRequest)`

Creates a temporary `CollabJSON` instance from the operations contained in a sync request. Returns `null` if the request contains no operations.

*   `syncRequest` (Object): The sync request object.

### `getSyncRequest()`

*(Client-side)* Gathers all local operations that have not yet been acknowledged by the server and prepares a sync request payload. This method is repeatable; it can be called multiple times without losing data if a network request fails.

### `replaceData(jsonString)`

*(Server-side)* Replaces the entire document data with new data from a JSON string. This is treated as a new state that supersedes all previous history. It resets the history and vector clocks, effectively making this replica the authority.

*   `jsonString` (String): The new JSON data.

### `getResetResponse()`

*(Server-side)* Generates a response payload that instructs the client to reset its state to match the server's current snapshot.

### `applySyncResponse(response)`

*(Client-side)* Applies a synchronization response from the server to the local document. This updates the client's state with changes from other clients and prunes local operations that the server has now acknowledged.

*   `response` (Object): The payload received from the server.

### `getSyncResponse(request)`

*(Server-side)* Processes a sync request from a client. It applies the client's new operations to the server's state, updates the server's DVV, and generates a response containing any operations the client needs to catch up.

*   `request` (Object): The payload received from a client's `getSyncRequest()`.

## 3. Examples

### Basic Document Manipulation

```javascript
import { CollabJSON } from './_crdt.js';

// Create a new document, initializing with an object
const doc = new CollabJSON('{}');

// Use updateItem to create a nested structure
doc.updateItem(['project', 'name'], 'CRDT Implementation');
doc.updateItem(['project', 'tasks'], []); // Create a nested array

console.log(doc.getData());
// Output: { project: { name: 'CRDT Implementation', tasks: [] } }

// Use addItem to insert into the nested array (CRDT-native)
doc.addItem(['project', 'tasks', 0], { text: 'Write docs', done: false });
doc.addItem(['project', 'tasks', 1], { text: 'Write tests', done: false });
console.log(doc.getData().project.tasks);
// Output: [ { text: 'Write docs', done: false }, { text: 'Write tests', done: false } ]

// Update a nested item
doc.updateItem(['project', 'tasks', 0, 'done'], true);
console.log(doc.getData().project.tasks[0]);
// Output: { text: 'Write docs', done: true }

// Use addItem with a string key (alias for updateItem) to add a property
doc.addItem(['project', 'status'], 'in-progress');
console.log(doc.getData().project.status);
// Output: 'in-progress'
```

### Client-Server Synchronization

```javascript
import { CollabJSON } from './_crdt.js';

// --- Setup ---
const docId = 'shared-document-1';
const server = new CollabJSON('[]', { clientId: 'server', id: docId });
const client1 = new CollabJSON('[]', { clientId: 'client1', id: docId });
const client2 = new CollabJSON('[]', { clientId: 'client2', id: docId });

// --- Client 1 works offline ---
client1.addItem([0], { text: 'Hello from client 1' });

// --- Client 1 syncs with server ---
const req1 = client1.getSyncRequest();
const res1 = server.getSyncResponse(req1);
client1.applySyncResponse(res1);

console.log('Server state:', server.getData());
// Output: Server state: [ { text: 'Hello from client 1' } ]

// --- Client 2 syncs with server (gets Client 1's changes) ---
const req2 = client2.getSyncRequest(); // Has no local ops
const res2 = server.getSyncResponse(req2);
client2.applySyncResponse(res2);

console.log('Client 2 state:', client2.getData());
// Output: Client 2 state: [ { text: 'Hello from client 1' } ]
```

## 4. Sample Server Implementation

This is a minimal example of how to use `CollabJSON` in a Node.js server endpoint (e.g., using Express or SvelteKit).

```javascript
import { CollabJSON } from './_crdt.js';
import { db } from './_database.js'; // Your database client

async function handleSyncRequest(req, res) {
  const { username, ...syncRequest } = req.body;
  const defaultJson = '{}';

  // 1. Authenticate user (omitted for brevity)

  // 2. Load the document state from the database
  const docStateString = await db.get(username).catch(() => undefined);

  // 3. Load or initialize the server's copy of the document
  const serverDoc = CollabJSON.loadOrInit(docStateString, syncRequest, defaultJson);

  // 4. Process the client's request and generate a response
  const syncResponse = serverDoc.getSyncResponse(syncRequest);

  // 5. Save the updated document state back to the database
  await db.put(username, JSON.stringify(serverDoc.toJSON()));

  // 6. Send the response back to the client
  res.json(syncResponse);
}
```

## 5. Best Practices: ID Selection & Management

### Deterministic IDs (Natural Keys) vs. Random UUIDs

When adding items to a collection, you have a choice on how to identify them:

1.  **Random UUIDs** (Default): If you don't provide an ID, `CollabJSON` generates a UUID.
    *   *Pros*: Guaranteed uniqueness.
    *   *Cons*: If two clients add the "same" item (conceptually) at the same time, they will result in **duplicates**.
2.  **Deterministic IDs** (Recommended): Using a "Natural Key" (e.g., a username, date/time string, or item name) as the ID.
    *   *Pros*: Enables **Upsert** (Update-or-Insert) behavior. If two clients add an item with `id: 'apple'` concurrently, the CRDT will merge them into a single 'apple' item, applying Last-Write-Wins to any conflicting properties.
    *   *Cons*: Requires care to ensure the ID is truly unique within its scope.

**Example**:
```javascript
// BAD: Risk of duplicates if multiple clients add "Apple" simultaneously
doc.addItem(['food'], { name: 'Apple', calories: 95 });

// GOOD: Deterministic ID ensures merging
doc.addItem(['food'], { id: 'Apple', name: 'Apple', calories: 95 });
```

### Scope and Ambiguity

In `CollabJSON`, IDs are used as internal keys for nodes in the tree.
*   **Unique Scope**: IDs must be unique within their immediate parent container (e.g., items in a list).
*   **Global ambiguity**: If you reuse the same ID (e.g., 'Apple') in different lists (e.g., `History['day1']` and `History['day2']`), `findPath('Apple')` will be ambiguous because it searches the entire tree and returns the **first** match it finds.

**Recommendation**:
*   Use `findPath(id)` only for globally unique IDs (like User IDs or Day Timestamps).
*   Use `findPathIn(subPath, id)` for locally unique IDs (like Items within a Day).

### Schema Enforcement

Since `CollabJSON` is schema-flexible, it is best practice to enforce your ID strategy at the **input boundary** (e.g., when uploading files or processing user input).

```javascript
// Example: Pre-processing data before adding to CRDT
function addFoodItem(doc, dayPath, item) {
    // Enforce: Item ID must match its Name
    const cleanItem = { ...item, id: item.name };
    doc.addItem(dayPath, cleanItem);
}
```
