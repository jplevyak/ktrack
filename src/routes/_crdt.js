/* Simple CRDT-based class for a collaborative JSON document.
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

const HISTORY_PRUNE_LIMIT = 100;
const HISTORY_PRUNE_WINDOW = 50;
const CRDT_ARRAY_MARKER = '_crdt_array_';

export class CollabJSON {
  constructor(jsonString, options = {}) {
    this.root = {}; // Unified data model

    this.id = options.id || uuidv4();
    this.checked = undefined;
    this.synced = undefined;

    this.clientId = options.clientId || uuidv4();
    this.clock = 0;
    this.dvv = new Map();
    this.ops = [];
    this.history = [];
    this.snapshot = null;
    this.snapshotDvv = new Map();

    if (jsonString) {
        this.root = this._plainToCrdt(JSON.parse(jsonString));
    }
  }

  // --- Private Helper Functions ---

  _tick() {
    // Hybrid logical clock: integer counter + client ID tie-breaker (simulated via random here for simplicity,
    // but ideally should use clientId for strict determinism).
    this.clock = Math.floor(this.clock) + 1;
    return this.clock + (Math.random() * 0.99);
  }

  _mergeClock(remoteTimestamp) {
    if (remoteTimestamp) {
      this.clock = Math.max(Math.floor(this.clock), Math.floor(remoteTimestamp)) + 1;
    }
  }

  _generateId() { return uuidv4(); }

  _generateSortKey(prevKey, nextKey) {
    if (prevKey === null && nextKey === null) return 0.5; // Start in middle of 0..1
    if (prevKey === null) return nextKey / 2.0;
    if (nextKey === null) return prevKey + 1.0;

    const mid = (prevKey + nextKey) / 2.0;
    // Basic precision guard
    if (mid === prevKey || mid === nextKey) {
        console.warn("CollabJSON: Fractional indexing precision limit reached. Re-sorting recommended.");
        return prevKey + 0.00000000001;
    }
    return mid;
  }

  _plainToCrdt(data, timestamp = 0, existingNode = null) {
    if (Array.isArray(data)) {
        const crdtArray = { [CRDT_ARRAY_MARKER]: true, items: {}, metadata: {} };
        
        // Get all existing items (including deleted) sorted by sortKey
        let existingItems = [];
        if (existingNode && existingNode[CRDT_ARRAY_MARKER]) {
            existingItems = Object.values(existingNode.items)
                .sort((a, b) => a.sortKey - b.sortKey || (a.id < b.id ? -1 : 1));
            Object.assign(crdtArray.metadata, existingNode.metadata);
        }

        let sortKey = 1.0;
        const usedIds = new Set();

        // Step 1: Process new items, trying to match with existing ones
        data.forEach(itemData => {
            let matchedItem = null;

            // Search for a content match in existing items that haven't been used yet
            for (const existingItem of existingItems) {
                if (usedIds.has(existingItem.id)) continue;

                const existingPlain = this._crdtToPlain(existingItem.data);
                if (JSON.stringify(existingPlain) === JSON.stringify(itemData)) {
                    matchedItem = existingItem;
                    break;
                }
            }

            if (matchedItem) {
                usedIds.add(matchedItem.id);
                
                if (matchedItem.updated > timestamp) {
                    // Local item is newer. Preserve its data and deleted status, but update sortKey to match new order.
                    crdtArray.items[matchedItem.id] = {
                        ...matchedItem,
                        sortKey: sortKey
                    };
                } else {
                    // Incoming update is newer. Overwrite (resurrect if deleted).
                    crdtArray.items[matchedItem.id] = {
                        id: matchedItem.id,
                        data: this._plainToCrdt(itemData, timestamp, matchedItem.data),
                        sortKey: sortKey,
                        updated: timestamp,
                        _deleted: false
                    };
                }
            } else {
                // No match found. Create new item.
                const itemId = this._generateId();
                crdtArray.items[itemId] = {
                    id: itemId,
                    data: this._plainToCrdt(itemData, timestamp),
                    sortKey: sortKey,
                    updated: timestamp,
                    _deleted: false
                };
            }
            sortKey += 1.0;
        });

        // Step 2: Process remaining existing items (deletions)
        for (const existingItem of existingItems) {
            if (usedIds.has(existingItem.id)) continue;

            if (existingItem.updated > timestamp) {
                // Local is newer, preserve.
                crdtArray.items[existingItem.id] = existingItem;
            } else {
                // Incoming is newer (implicit delete).
                crdtArray.items[existingItem.id] = {
                    ...existingItem,
                    updated: timestamp,
                    _deleted: true
                };
            }
        }

        return crdtArray;
    } else if (typeof data === 'object' && data !== null) {
        const newObj = { metadata: {} };
        const existingMeta = (existingNode && existingNode.metadata) ? existingNode.metadata : {};
        
        Object.assign(newObj.metadata, existingMeta);

        for (const key in data) {
            const existingChild = (existingNode && existingNode[key]) ? existingNode[key] : null;
            const meta = existingMeta[key];
            
            if (meta && meta.updated > timestamp) {
                // Local is newer. Keep local value.
                newObj[key] = existingChild;
                newObj.metadata[key] = meta;
            } else {
                // Incoming is newer.
                newObj[key] = this._plainToCrdt(data[key], timestamp, existingChild);
                newObj.metadata[key] = { updated: timestamp, _deleted: false };
            }
        }
        
        if (existingNode) {
            for (const key in existingNode) {
                if (key === 'metadata') continue;
                if (!(key in data)) {
                    const meta = existingNode.metadata ? existingNode.metadata[key] : undefined;
                    if (meta && meta.updated > timestamp) {
                        // Local is newer (and present). Keep it.
                        newObj[key] = existingNode[key];
                        newObj.metadata[key] = meta;
                    } else {
                        // Incoming (missing) is newer. Delete it.
                        newObj[key] = existingNode[key];
                        newObj.metadata[key] = { updated: timestamp, _deleted: true };
                    }
                }
            }
        }
        return newObj;
    }
    return data;
  }

  _crdtToPlain(data) {
    if (typeof data === 'object' && data !== null) {
      if (data[CRDT_ARRAY_MARKER]) {
        return this._getSortedItems(data).map(item => this._crdtToPlain(item.data));
      }
      const newObj = {};
      for (const key in data) {
        if (key === 'metadata') continue;
        if (data.metadata && data.metadata[key] && data.metadata[key]._deleted) continue;
        newObj[key] = this._crdtToPlain(data[key]);
      }
      return newObj;
    }
    return data;
  }

  _getSortedItems(crdtArray) {
    if (!crdtArray || !crdtArray[CRDT_ARRAY_MARKER]) return [];
    return Object.values(crdtArray.items)
      .filter(item => !item._deleted)
      .sort((a, b) => a.sortKey - b.sortKey || (a.id < b.id ? -1 : 1));
  }

  _traverse(path) {
    let parent = null;
    let current = this.root;
    let finalKey = null;

    for (const segment of path) {
      let container = current;
      if (container && container.hasOwnProperty('data') && container.hasOwnProperty('sortKey')) {
        container = container.data;
      }

      parent = container;
      finalKey = segment;
      if (container === null || typeof container !== 'object') return null;

      if (container[CRDT_ARRAY_MARKER]) {
        const sorted = this._getSortedItems(container);
        if (typeof segment !== 'number' || segment < 0 || segment >= sorted.length) return null;
        current = container.items[sorted[segment].id];
      } else {
        if (!Object.prototype.hasOwnProperty.call(container, segment)) return null;
        current = container[segment];
      }
    }
    return { parent, key: finalKey, node: current };
  }

  _applyAndStore(op) {
    op.clientId = this.clientId;
    // Compression: If updating the same item consecutively, merge ops
    if (op.type === 'UPDATE_ITEM') {
        const lastOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
        if (lastOp && lastOp.type === 'UPDATE_ITEM' && JSON.stringify(lastOp.path) === JSON.stringify(op.path)) {
            lastOp.data = op.data;
            lastOp.timestamp = op.timestamp;
            this.applyOp(op);
            return;
        }
    }
    this.applyOp(op);
    this.ops.push(op);
  }

  _getSnapshotData() { return this.root; }

  // --- Public View Functions ---

  getData(path) {
    if (!path || path.length === 0) {
        return this._crdtToPlain(this.root);
    }
    const result = this._traverse(path);
    if (!result) return undefined;

    let nodeToConvert = result.node;
    // If the traversed node is an item from a CRDT array, we want to convert its `data` property.
    if (nodeToConvert && nodeToConvert.hasOwnProperty('sortKey') && nodeToConvert.hasOwnProperty('data')) {
        nodeToConvert = nodeToConvert.data;
    }

    return this._crdtToPlain(nodeToConvert);
  }

  /**
   * Finds the path to a node with a specific ID (for array items) or key.
   * This is a DFS search.
   */
  findPath(targetId, currentPath = [], currentNode = this.root) {
    if (!currentNode) return null;

    // Unwrap array item wrapper
    let actualNode = currentNode;
    if (currentNode.hasOwnProperty('data') && currentNode.hasOwnProperty('sortKey')) {
        if (currentNode.id === targetId) return currentPath;
        actualNode = currentNode.data;
    }

    if (typeof actualNode !== 'object') return null;

    if (actualNode[CRDT_ARRAY_MARKER]) {
        const sorted = this._getSortedItems(actualNode);
        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            if (item.id === targetId) return [...currentPath, i];

            const res = this.findPath(targetId, [...currentPath, i], item);
            if (res) return res;
        }
    } else {
        for (const key in actualNode) {
            if (key === 'metadata') continue;
            if (actualNode.metadata && actualNode.metadata[key] && actualNode.metadata[key]._deleted) continue;

            if (key === targetId) return [...currentPath, key]; // Found by key name

            const res = this.findPath(targetId, [...currentPath, key], actualNode[key]);
            if (res) return res;
        }
    }
    return null;
  }

  // --- Operation Generators (Public API) ---

  addItem(path, data) {
    const parentPath = path.slice(0, -1);
    const keyOrIndex = path[path.length - 1];

    if (typeof keyOrIndex === 'string') {
        this.updateItem(path, data);
        return;
    }

    if (typeof keyOrIndex !== 'number') throw new Error("Final path segment for addItem must be an index or a key.");

    const index = keyOrIndex;

    if (Object.keys(this.root).length === 0 && parentPath.length === 0) {
        this.root = this._plainToCrdt([]);
    }

    const result = this._traverse(parentPath);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) throw new Error("Target for addItem is not an array.");

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (index > sortedItems.length) throw new Error("Index out of bounds.");

    const prevItem = sortedItems[index - 1] || null;
    const nextItem = sortedItems[index] || null;
    const prevKey = prevItem ? prevItem.sortKey : null;
    const nextKey = nextItem ? nextItem.sortKey : null;

    const newSortKey = this._generateSortKey(prevKey, nextKey);
    const newItemId = this._generateId();

    this._applyAndStore({ type: 'ADD_ITEM', path: parentPath, itemId: newItemId, data, sortKey: newSortKey, timestamp: this._tick() });
  }

  moveItem(path, fromIndex, toIndex) {
    const result = this._traverse(path);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) throw new Error("Target for moveItem is not an array.");

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (fromIndex < 0 || fromIndex >= sortedItems.length) throw new Error("fromIndex out of bounds");
    if (toIndex < 0 || toIndex > sortedItems.length) throw new Error("toIndex out of bounds");
    if (fromIndex === toIndex) return;

    const itemToMove = sortedItems[fromIndex];

    // Calculate new sort key
    let prevKey = null;
    let nextKey = null;

    /*
       Problem: We need to generate a fractional sortKey that places 'itemToMove'
       at 'toIndex'.

       When moving an item within a list, the indices of other items shift.
       For example, if we have [A, B, C, D] and move A (index 0) to index 2:
       1. Conceptually remove A: [B, C, D]
       2. Insert A at index 2: [B, C, A, D]

       To find the correct sortKey for A, we need to look at its new neighbors
       in the list *excluding* A itself. In this example, A is between C and D.
    */

    if (toIndex === 0) {
        // Case 1: Moving to the very start of the list.
        // The item will be placed before the current first item.
        // We don't need to check for null here because the list is guaranteed to be non-empty (contains itemToMove).
        nextKey = sortedItems[0].sortKey;
    } else if (toIndex === sortedItems.length) {
        // Case 2: Moving to the very end of the list.
        // The item will be placed after the current last item.
        // We don't need to check for null here because the list is guaranteed to be non-empty.
        prevKey = sortedItems[sortedItems.length - 1].sortKey;
    } else {
        // Case 3: Moving to the middle (or effectively the end of the reduced list).
        // We simulate the list without the moved item to find the correct neighbors.

        const listWithoutItem = sortedItems.filter(i => i.id !== itemToMove.id);

        // We want to insert at 'toIndex'. However, since we removed one item,
        // the target index might be at the end of the reduced list.
        const actualToIndex = Math.min(toIndex, listWithoutItem.length);

        // The previous item is guaranteed to exist because toIndex > 0 (handled by Case 1).
        // nItem might be undefined if actualToIndex equals listWithoutItem.length (appending to reduced list).
        prevKey = listWithoutItem[actualToIndex - 1].sortKey;
        const nItem = listWithoutItem[actualToIndex];
        nextKey = nItem ? nItem.sortKey : null;
    }

    const newSortKey = this._generateSortKey(prevKey, nextKey);

    this._applyAndStore({
        type: 'MOVE_ITEM',
        path: path,
        itemId: itemToMove.id,
        sortKey: newSortKey,
        timestamp: this._tick()
    });
  }

  deleteItem(path) {
    const result = this._traverse(path);
    if (!result) return; // Idempotent

    const { parent, key, node } = result;
    const op = { type: 'DELETE_ITEM', path, timestamp: this._tick() };

    if (parent[CRDT_ARRAY_MARKER]) {
        op.itemId = node.id;
    }
    this._applyAndStore(op);
  }

  updateItem(path, newData) {
    const p = path || [];
    this._applyAndStore({ type: 'UPDATE_ITEM', path: p, data: newData, timestamp: this._tick() });
  }

  prune(pruneFn, clientRequestData) {
    if (pruneFn) pruneFn(this, clientRequestData);
    if (this.history.length < HISTORY_PRUNE_LIMIT) return;

    // Tombstone TTL strategy:
    // We purge tombstones that are older than the history window we are keeping.
    // We approximate the timestamp threshold using the logical clock and the prune window size.
    const minTimestamp = this.clock - HISTORY_PRUNE_WINDOW;
    this.purgeTombstones(this.root, minTimestamp);

    this.snapshot = this._getSnapshotData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = this.history.slice(-HISTORY_PRUNE_WINDOW);
  }

  /**
   * Garbage Collection: Permanently remove items marked as deleted.
   * WARNING: This can cause desyncs if other clients still have pending ops
   * referencing these items. Only use when confident all clients are caught up,
   * or use a "tombstone TTL" strategy (not implemented here).
   */
  purgeTombstones(node = this.root, minTimestamp = 0) {
    if (typeof node !== 'object' || node === null) return;

    if (node[CRDT_ARRAY_MARKER]) {
        for (const id in node.items) {
            if (node.items[id]._deleted) {
                if (node.items[id].updated < minTimestamp) {
                    delete node.items[id];
                }
            } else {
                this.purgeTombstones(node.items[id].data, minTimestamp);
            }
        }
    } else {
        for (const key in node) {
            if (key === 'metadata') continue;

            // Check if this key is deleted in metadata
            if (node.metadata && node.metadata[key] && node.metadata[key]._deleted) {
                if (node.metadata[key].updated < minTimestamp) {
                    delete node[key];
                    delete node.metadata[key];
                }
            } else {
                this.purgeTombstones(node[key], minTimestamp);
            }
        }
    }
  }

  clear() {
    this.root = {};
    this.history = [];
    this.dvv.clear();
    this.snapshot = null;
    this.snapshotDvv.clear();
    this.ops = [];
  }

  commitOps() {
    if (this.ops.length > 0) {
      const maxTs = this.ops.reduce((max, op) => Math.max(max, op.timestamp), 0);
      this.ops.forEach(op => this.history.push(op));
      this.dvv.set(this.clientId, Math.max(this.dvv.get(this.clientId) || 0, maxTs));
      this.ops = [];
    }
  }

  // --- Sync Function ---

  applyOp(op) {
    this._mergeClock(op.timestamp);

    // Common traversal for most ops
    // Note: For MOVE_ITEM, path points to the array, not the item
    const traversePath = (op.type === 'MOVE_ITEM') ? op.path : op.path.slice(0, -1);
    const { parent, node } = this._traverse(traversePath) || {};

    switch (op.type) {
      case 'ADD_ITEM':
        const targetArray = this._traverse(op.path)?.node;
        if (!targetArray || !targetArray[CRDT_ARRAY_MARKER]) break;

        let item = targetArray.items[op.itemId];
        if (!item) {
            item = targetArray.items[op.itemId] = { id: op.itemId };
        }
        if (!item.updated || op.timestamp >= item.updated) {
            item.data = this._plainToCrdt(op.data, op.timestamp);
            item.sortKey = op.sortKey;
            item.updated = op.timestamp;
            item._deleted = false;
        }
        break;

      case 'MOVE_ITEM':
        const moveArray = this._traverse(op.path)?.node;
        if (!moveArray || !moveArray[CRDT_ARRAY_MARKER]) break;

        const itemToMove = moveArray.items[op.itemId];
        if (!itemToMove) break; // Item doesn't exist (maybe deleted or not synced yet)

        // LWW on the sortKey specifically.
        // We use the item's general 'updated' timestamp.
        // If a delete happened later, _deleted will be true, and we shouldn't un-delete it just by moving.
        if (op.timestamp > (itemToMove.updated || 0)) {
            itemToMove.sortKey = op.sortKey;
            itemToMove.updated = op.timestamp;
            // Note: We do NOT set _deleted = false here. If it was deleted, moving it shouldn't bring it back.
        }
        break;

      case 'DELETE_ITEM':
        // Improved delete logic: resolve parent container first
        const parentPath = op.path.slice(0, -1);
        const parentRes = this._traverse(parentPath);
        
        if (!parentRes || !parentRes.node) break;
        const container = parentRes.node;
        
        let targetMeta = null;

        if (container[CRDT_ARRAY_MARKER]) {
            // For arrays, use itemId to identify the item to delete
            if (op.itemId && container.items[op.itemId]) {
                targetMeta = container.items[op.itemId];
            }
        } else {
            // For objects, use the key from the path
            const key = op.path[op.path.length - 1];
            if (container.metadata && container.metadata[key]) {
                targetMeta = container.metadata[key];
            }
        }

        if (targetMeta && op.timestamp > (targetMeta.updated || 0)) {
            targetMeta._deleted = true;
            targetMeta.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        if (op.path.length === 0) {
            this.root = this._plainToCrdt(op.data, op.timestamp, this.root);
            break;
        }
        const updateRes = this._traverse(op.path);
        if (updateRes && updateRes.parent) {
            const { parent, key, node } = updateRes;
            const itemToUpdate = parent[CRDT_ARRAY_MARKER] ? node : parent.metadata[key];
            if (itemToUpdate && op.timestamp <= (itemToUpdate.updated || 0)) break;

            if (parent[CRDT_ARRAY_MARKER]) {
                node.data = this._plainToCrdt(op.data, op.timestamp, node.data);
                node.updated = op.timestamp;
                node._deleted = false;
            } else {
                parent[key] = this._plainToCrdt(op.data, op.timestamp, parent[key]);
                if (!parent.metadata) parent.metadata = {};
                parent.metadata[key] = { updated: op.timestamp, _deleted: false };
            }
        } else if (op.path.length > 0) { // Create path (upsert)
            let current = this.root;
            for (let i = 0; i < op.path.length - 1; i++) {
                const segment = op.path[i];
                let container = current;
                if (container && container.hasOwnProperty('data') && container.hasOwnProperty('sortKey')) {
                    container = container.data;
                }

                if (!Object.prototype.hasOwnProperty.call(container, segment) || typeof container[segment] !== 'object' || container[segment] === null) {
                    container[segment] = this._plainToCrdt({}, op.timestamp);
                    if (!container.metadata) container.metadata = {};
                    container.metadata[segment] = { updated: op.timestamp, _deleted: false };
                }
                current = container[segment];
            }

            const finalKey = op.path[op.path.length - 1];
            let parentContainer = current;
            if (parentContainer && parentContainer.hasOwnProperty('data') && parentContainer.hasOwnProperty('sortKey')) {
                parentContainer = parentContainer.data;
            }

            if (typeof parentContainer !== 'object' || parentContainer === null) break;

            parentContainer[finalKey] = this._plainToCrdt(op.data, op.timestamp, parentContainer[finalKey]);
            if (!parentContainer.metadata) parentContainer.metadata = {};
            parentContainer.metadata[finalKey] = { updated: op.timestamp, _deleted: false };
        }
        break;
    }
  }

  // --- Persistence Methods ---

  toJSON() {
    return {
      root: this.root,
      id: this.id,
      clientId: this.clientId,
      clock: this.clock,
      history: this.history,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
      checked: this.checked,
      synced: this.synced
    };
  }

  static fromJSON(state, options = {}) {
    const doc = new CollabJSON(undefined, {
        ...options,
        id: state ? state.id : undefined,
        clientId: (state && state.clientId) ? state.clientId : options.clientId
    });
    if (!state) return doc;

    doc.root = state.snapshot || state.root || {};
    doc.snapshot = state.snapshot;
    doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));

    if (state.clock !== undefined) {
        doc.clock = state.clock;
    }

    if (state.checked !== undefined) doc.checked = state.checked;
    if (state.synced !== undefined) doc.synced = state.synced;

    if (state.history) {
        doc.history = state.history || [];
        doc.dvv = new Map(Object.entries(state.dvv || {}));
        doc.history.forEach(op => doc.applyOp(op));
    }
    return doc;
  }

  static fromSnapshot(snapshot, snapshotDvv, docId, options = {}) {
    const doc = new CollabJSON(undefined, { ...options, id: docId });
    doc.root = snapshot || {};
    doc.snapshot = snapshot || {};
    doc.snapshotDvv = new Map(Object.entries(snapshotDvv || {}));
    doc.dvv = new Map(Object.entries(snapshotDvv || {}));

    // Initialize clock to the maximum timestamp seen in the snapshot
    let maxTs = 0;
    for (const ts of doc.dvv.values()) {
        if (ts > maxTs) maxTs = ts;
    }
    doc.clock = maxTs;

    return doc;
  }

  static loadOrInit(stateString, syncRequest, defaultJson, options = {}) {
    const opts = { ...options, clientId: 'server' };
    if (stateString) {
        return CollabJSON.fromJSON(JSON.parse(stateString), opts);
    }
    if (syncRequest && syncRequest.snapshot) {
        return CollabJSON.fromSnapshot(syncRequest.snapshot, syncRequest.snapshotDvv, syncRequest.docId, opts);
    }
    return new CollabJSON(defaultJson, { ...opts, id: syncRequest ? syncRequest.docId : undefined });
  }

  static fromOps(ops) {
    const doc = new CollabJSON("{}");
    if (Array.isArray(ops)) {
        ops.forEach(op => doc.applyOp(op));
    }
    return doc;
  }

  static fromSyncRequest(syncRequest) {
    if (!syncRequest || !syncRequest.ops || syncRequest.ops.length === 0) {
        return null;
    }
    return CollabJSON.fromOps(syncRequest.ops);
  }

  // --- DVV Sync Methods ---

  getSyncRequest() {
    const lastSeenBySystem = this.dvv.get(this.clientId) || 0;
    const newOps = this.ops.filter(op => op.timestamp > lastSeenBySystem);
    this.checked = Date.now();

    const req = { dvv: Object.fromEntries(this.dvv), ops: newOps, clientId: this.clientId, docId: this.id };

    if (!this.synced) {
        req.snapshot = this._getSnapshotData();
        req.snapshotDvv = Object.fromEntries(this.dvv);
    }

    return req;
  }

  requiresReset(syncRequest) {
    return !!(this.id && syncRequest && syncRequest.docId && this.id !== syncRequest.docId);
  }

  getResetResponse() {
    return {
      snapshot: this._getSnapshotData(),
      snapshotDvv: Object.fromEntries(this.dvv),
      reset: true,
      id: this.id
    };
  }

  applySyncResponse({ ops, dvv, snapshot, snapshotDvv, reset, id }) {
    if (reset) {
        this.ops = [];
        this.id = id;
        this.root = snapshot || {};
        this.snapshot = snapshot;
        this.snapshotDvv = new Map(Object.entries(snapshotDvv || {}));
        this.dvv = new Map(Object.entries(snapshotDvv || {}));

        // Update clock to the maximum timestamp seen in the snapshot
        let maxTs = 0;
        for (const ts of this.dvv.values()) {
            if (ts > maxTs) maxTs = ts;
        }
        this.clock = Math.max(this.clock, maxTs);

        this.synced = Date.now();
        return;
    }

    ops.forEach(op => this.applyOp(op));
    this.dvv = new Map(Object.entries(dvv));
    this.ops = this.ops.filter(op => op.timestamp > (this.dvv.get(this.clientId) || 0));
    this.synced = Date.now();
  }

  getSyncResponse({ dvv: clientDvv, ops: clientOps, clientId }) {
    const clientDvvMap = new Map(Object.entries(clientDvv));

    if (this.snapshot) {
        let needsReset = false;
        for (const [cId, ts] of this.snapshotDvv.entries()) {
            if ((clientDvvMap.get(cId) || 0) < ts) {
                needsReset = true;
                break;
            }
        }
        if (needsReset) {
            return { id: this.id, snapshot: this.snapshot, snapshotDvv: Object.fromEntries(this.snapshotDvv), reset: true };
        }
    }

    clientOps.forEach(op => {
        this.applyOp(op);
        this.history.push(op);
    });

    const maxTs = clientOps.reduce((max, op) => op.clientId === clientId ? Math.max(max, op.timestamp) : max, 0);
    if (maxTs > 0) {
      this.dvv.set(clientId, Math.max(this.dvv.get(clientId) || 0, maxTs));
    }

    const opsForClient = this.history.filter(op => {
        if (op.clientId === clientId) return false;
        return (clientDvvMap.get(op.clientId) || 0) < op.timestamp;
    });
    return { ops: opsForClient, dvv: Object.fromEntries(this.dvv) };
  }
}
