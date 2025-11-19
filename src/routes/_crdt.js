/* simple CRDT-based class for a collaborative JSON document (nested arrays).
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
    this.clock = Math.round(this.clock) + 1.0 + Math.random();
    return this.clock;
  }

  _mergeClock(remoteTimestamp) {
    if (remoteTimestamp) {
      this.clock = Math.round(Math.max(this.clock, remoteTimestamp)) + 1.0 + Math.random();
    }
  }

  _generateId() { return uuidv4(); }

  _generateSortKey(prevKey, nextKey) {
    if (prevKey === null && nextKey === null) return 1.0;
    if (prevKey === null) return nextKey - 1.0;
    if (nextKey === null) return prevKey + 1.0;
    return (prevKey + nextKey) / 2.0;
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
  
  findPath(key, basePath = null) { return null; /* TODO: Re-implement if needed */ }

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
    this.snapshot = this._getSnapshotData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = this.history.slice(-history_prune_window);
  }
  
  // --- Sync Function ---

  applyOp(op) {
    this._mergeClock(op.timestamp);
    const { parent, node } = this._traverse(op.path.slice(0, -1)) || {};
    const finalKey = op.path[op.path.length - 1];

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
    
    if (state.history) {
        doc.history = state.history || [];
        doc.dvv = new Map(Object.entries(state.dvv || {}));
        doc.history.forEach(op => doc.applyOp(op));
    }
    return doc;
  }

  // --- DVV Sync Methods ---

  getSyncRequest() {
    const lastSeenBySystem = this.dvv.get(this.clientId) || 0;
    const newOps = this.ops.filter(op => op.timestamp > lastSeenBySystem);
    this.checked = Date.now();
    
    return { dvv: Object.fromEntries(this.dvv), ops: newOps, clientId: this.clientId, docId: this.id };
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
