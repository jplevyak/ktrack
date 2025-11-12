# CollabJSON CRDT Implementation

## 1. Introduction

Conflict-free Replicated Data Types (CRDTs) are data structures that allow for concurrent modifications across multiple replicas (e.g., clients and servers) and can be merged without conflicts.

This repository contains a specific CRDT implementation named `CollabJSON`. It is designed to handle JSON-like documents, specifically nested arrays of objects. Its key features are:

*   **Operation-based CRDT**: It works by replicating operations between replicas rather than entire states.
*   **Lamport Timestamps**: Each operation is assigned a causally-ordered timestamp to ensure that effects are applied in a logical order.
*   **Last-Write-Wins (LWW)**: Conflicts (e.g., two clients updating the same item concurrently) are resolved by giving precedence to the operation with the higher timestamp.
*   **Fractional Indexing**: List items are ordered using fractional numbers (`sortKey`), which allows for inserting items between any two existing items without re-indexing.
*   **Client-Server Architecture**: The synchronization mechanism is designed for a star-schema topology where multiple clients communicate with a single central server and not directly with each other.
*   **Dotted Version Vectors (DVV)**: Synchronization is made efficient by using DVVs. Each replica tracks the latest timestamp it has seen from every other replica, allowing it to request only the operations it hasn't seen yet.
*   **Snapshotting and Compaction**: To prevent the operation history from growing indefinitely, the server can compact its history into a snapshot. Clients that are too far behind will receive this snapshot instead of a long list of operations.

## 2. API Reference

### `new CollabJSON(options)`

Creates a new `CollabJSON` document.

*   `options` (Object):
    *   `id` (String): A unique identifier for the document. If two instances share an `id`, they are considered replicas of the same document. Defaults to a new UUID.
    *   `clientId` (String): A unique identifier for the current replica (client or server). Defaults to a new UUID.

### `getData()`

Returns the current state of the document as a plain, nested JavaScript array. This is useful for rendering the data in a UI.

### `getItem(path)`

Retrieves an item from the document at a specified path. If the item is a nested `CollabJSON` document, it returns a *new, independent copy* of that document.

*   `path` (Array of numbers): An array of indices specifying the location of the item.

### `addItem(path, data)`

Adds a new item to the document at a specified path.

*   `path` (Array of numbers): The path to the container array and the index at which to insert the new item.
*   `data` (Object | CollabJSON): The data to insert. This can be a plain object or another `CollabJSON` instance to create a nested structure.

### `updateItem(path, newData)`

Updates an existing item with new data.

*   `path` (Array of numbers): The path to the item to be updated.
*   `newData` (Object | CollabJSON): The new data for the item.

### `moveItem(fromPath, toPath)`

Moves an item from one location to another, potentially between different nested arrays.

*   `fromPath` (Array of numbers): The current path of the item to move.
*   `toPath` (Array of numbers): The target path for the item.

### `deleteItem(path)`

Marks an item as deleted.

*   `path` (Array of numbers): The path to the item to be deleted.

### `prune(pruneFn)`

*(Server-side)* Compacts the document's history to save space. It creates a snapshot of the current state, stores the current DVV, and clears the historical operation log.

*   `pruneFn` (Function): A function that is given the `CollabJSON` instance to perform any application-specific pruning on the data *before* the snapshot is created.

### `toJSON()`

*(Server-side)* Serializes the entire state of the document (including history, DVV, and snapshot) into a plain JavaScript object suitable for storage (e.g., in a database).

### `static CollabJSON.fromJSON(state, options)`

*(Server-side)* A static method to reconstruct a `CollabJSON` document from its serialized state.

*   `state` (Object): The plain object retrieved from storage.
*   `options` (Object): Constructor options, primarily to set a `clientId`.

### `getSyncRequest()`

*(Client-side)* Gathers all local operations that have not yet been acknowledged by the server and prepares a sync request payload. This method is repeatable; it can be called multiple times without losing data if a network request fails.

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

// Create a new document
const doc = new CollabJSON();

// Add items
doc.addItem([0], { task: 'Buy milk', done: false });
doc.addItem([1], { task: 'Read book', done: false });
console.log(doc.getData());
// Output: [{ task: 'Buy milk', done: false }, { task: 'Read book', done: false }]

// Update an item
doc.updateItem([0], { task: 'Buy milk', done: true });
console.log(doc.getData());
// Output: [{ task: 'Buy milk', done: true }, { task: 'Read book', false }]

// Create and add a nested list
const nestedList = new CollabJSON();
nestedList.addItem([0], { subtask: 'Chapter 1' });
doc.addItem([2], nestedList);
console.log(doc.getData());
// Output:
// [
//   { task: 'Buy milk', done: true },
//   { task: 'Read book', done: false },
//   [ { subtask: 'Chapter 1' } ]
// ]
```

### Client-Server Synchronization

```javascript
import { CollabJSON } from './_crdt.js';

// --- Setup ---
const docId = 'shared-document-1';
const server = new CollabJSON({ clientId: 'server', id: docId });
const client1 = new CollabJSON({ clientId: 'client1', id: docId });
const client2 = new CollabJSON({ clientId: 'client2', id: docId });

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

  // 1. Authenticate user (omitted for brevity)

  // 2. Load the document state from the database
  const docStateJSON = await db.get(username);
  const docState = docStateJSON ? JSON.parse(docStateJSON) : null;

  // 3. Reconstruct the server's copy of the document
  const serverDoc = CollabJSON.fromJSON(docState, { clientId: 'server' });

  // 4. Process the client's request and generate a response
  const syncResponse = serverDoc.getSyncResponse(syncRequest);

  // 5. Save the updated document state back to the database
  await db.put(username, JSON.stringify(serverDoc.toJSON()));

  // 6. Send the response back to the client
  res.json(syncResponse);
}
```
