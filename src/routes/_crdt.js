/* Simple CRDT-based class for a collaborative JSON document.
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

const history_prune_limit = 100;
const history_prune_window = 50;
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

  _plainToCrdt(data) {
    if (Array.isArray(data)) {
        const crdtArray = { [CRDT_ARRAY_MARKER]: true, items: {}, metadata: {} };
        let sortKey = 1.0;
        data.forEach(itemData => {
            const itemId = this._generateId();
            crdtArray.items[itemId] = {
                id: itemId,
                data: this._plainToCrdt(itemData),
                sortKey: sortKey,
                updated: 0,
                _deleted: false
            };
            sortKey += 1.0;
        });
        return crdtArray;
    } else if (typeof data === 'object' && data !== null) {
        const newObj = { metadata: {} };
        for (const key in data) {
            newObj[key] = this._plainToCrdt(data[key]);
            newObj.metadata[key] = { updated: 0, _deleted: false };
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

    if (toIndex === 0) {
        // Moving to start
        nextKey = sortedItems[0].sortKey;
    } else if (toIndex === sortedItems.length) {
        // Moving to end
        prevKey = sortedItems[sortedItems.length - 1].sortKey;
    } else {
        // Moving between items
        // Adjust logic because the item being moved is currently IN the list
        let leftIndex = toIndex - 1;
        let rightIndex = toIndex;
        
        // If we are moving 'down' the list (0 -> 5), the indices shift after removal
        if (fromIndex < toIndex) {
            // The target slot is actually between toIndex and toIndex+1 in the original list?
            // No, standard splice logic: insert AT toIndex.
            // But since we are effectively removing fromIndex first, we need to be careful.
            // Simpler: imagine the list without the item.
        }
        
        const listWithoutItem = sortedItems.filter(i => i.id !== itemToMove.id);
        // Now we want to insert at toIndex (clamped to new length)
        const actualToIndex = Math.min(toIndex, listWithoutItem.length);
        
        const pItem = listWithoutItem[actualToIndex - 1];
        const nItem = listWithoutItem[actualToIndex];
        
        prevKey = pItem ? pItem.sortKey : null;
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
    if (!path || path.length === 0) {
        this.root = this._plainToCrdt(newData); // Overwrite root
        return;
    }
    
    this._applyAndStore({ type: 'UPDATE_ITEM', path, data: newData, timestamp: this._tick() });
  }

  prune(pruneFn, clientRequestData) {
    if (pruneFn) pruneFn(this, clientRequestData);
    if (this.history.length < history_prune_limit) return;

    // Tombstone TTL strategy:
    // We purge tombstones that are older than the history window we are keeping.
    // We approximate the timestamp threshold using the logical clock and the prune window size.
    const minTimestamp = this.clock - history_prune_window;
    this.purgeTombstones(this.root, minTimestamp);

    this.snapshot = this._getSnapshotData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = this.history.slice(-history_prune_window);
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
            item.data = this._plainToCrdt(op.data);
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
        const res = this._traverse(op.path);
        if (!res || !res.node) break;
        const itemToDelete = res.parent[CRDT_ARRAY_MARKER] ? res.node : res.parent.metadata[res.key];
        
        if (itemToDelete && op.timestamp > (itemToDelete.updated || 0)) {
            itemToDelete._deleted = true;
            itemToDelete.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        const updateRes = this._traverse(op.path);
        if (updateRes && updateRes.parent) {
            const { parent, key, node } = updateRes;
            const itemToUpdate = parent[CRDT_ARRAY_MARKER] ? node : parent.metadata[key];
            if (itemToUpdate && op.timestamp <= (itemToUpdate.updated || 0)) break;
            
            if (parent[CRDT_ARRAY_MARKER]) {
                node.data = this._plainToCrdt(op.data);
                node.updated = op.timestamp;
                node._deleted = false;
            } else {
                parent[key] = this._plainToCrdt(op.data);
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
                    container[segment] = this._plainToCrdt({});
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

            parentContainer[finalKey] = this._plainToCrdt(op.data);
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
      clock: this.clock,
      history: this.history,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
    };
  }

  static fromJSON(state, options = {}) {
    const doc = new CollabJSON(undefined, { ...options, id: state ? state.id : undefined });
    if (!state) return doc;
    
    doc.root = state.snapshot || state.root || {};
    doc.snapshot = state.snapshot;
    doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));
    
    if (state.clock !== undefined) {
        doc.clock = state.clock;
    }

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

    const opsForClient = this.history.filter(op => (clientDvvMap.get(op.clientId) || 0) < op.timestamp);
    return { ops: opsForClient, dvv: Object.fromEntries(this.dvv) };
  }
}
