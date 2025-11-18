/* simple CRDT-based class for a collaborative JSON document (nested arrays).
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

const history_prune_limit = 100;
const history_prune_window = 50;

export class CollabJSON {
  constructor(jsonString, options = {}) {
    this.type = null;
    
    this.id = options.id || uuidv4();
    this.checked = undefined;
    this.synced = undefined;
    
    this.clientId = options.clientId || uuidv4();
    this.clock = 0;
    this.dvv = new Map();
    this.ops = []; // local ops for the whole document
    this.history = []; // all ops on server
    this.snapshot = null;
    this.snapshotDvv = new Map();

    if (jsonString) {
        const data = JSON.parse(jsonString);
        if (Array.isArray(data)) {
            this.type = 'array';
            this.items = new Map();
            let sortKey = 1.0;
            data.forEach(itemData => {
                const itemId = this._generateId();
                this.items.set(itemId, {
                    id: itemId,
                    data: itemData,
                    sortKey: sortKey,
                    updated: 0,
                    _deleted: false
                });
                sortKey += 1.0;
            });
        } else {
            this.type = 'object';
            this.data = data;
            this.metadata = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    this.metadata[key] = {
                        updated: 0,
                        _deleted: false
                    };
                }
            }
        }
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

  _generateId() {
    return uuidv4();
  }

  _generateSortKey(prevKey, nextKey) {
    if (prevKey === null && nextKey === null) return 1.0;
    if (prevKey === null) return nextKey - 1.0;
    if (nextKey === null) return prevKey + 1.0;
    return (prevKey + nextKey) / 2.0;
  }
  
  _getSortedItems() {
    if (this.type !== 'array') return [];
    return Array.from(this.items.values())
      .filter(item => !item._deleted)
      .sort((a, b) => {
        if (a.sortKey !== b.sortKey) {
          return a.sortKey - b.sortKey;
        }
        // Tie-break with item ID for deterministic ordering
        return a.id < b.id ? -1 : 1;
      });
  }

  _findSortKeys(list, index) {
    if (index > list.length) index = list.length;
    const prevItem = list[index - 1] || null;
    const nextItem = list[index] || null;

    const prevKey = prevItem ? prevItem.sortKey : null;
    const nextKey = nextItem ? nextItem.sortKey : null;

    return { prevKey, nextKey };
  }

  _applyAndStore(op) {
    op.clientId = this.clientId;

    if (op.type === 'UPDATE_ITEM') {
      const lastOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
      if (lastOp && lastOp.type === 'UPDATE_ITEM' && JSON.stringify(lastOp.path) === JSON.stringify(op.path)) {
        const opKey = op.key || op.itemId;
        const lastOpKey = lastOp.key || lastOp.itemId;
        if (opKey === lastOpKey) {
            // The new op shadows the previous one for the same path.
            lastOp.data = op.data;
            lastOp.timestamp = op.timestamp;
            this.applyOp(op);
            return;
        }
      }
    }

    this.applyOp(op);
    this.ops.push(op);
  }


  _getSnapshotData() {
    if (this.type === 'array') {
        const snapshotItems = [];
        for (const item of this._getSortedItems()) {
            const itemClone = { ...item };
            snapshotItems.push(itemClone);
        }
        return snapshotItems;
    } else {
        return {
            data: this.data,
            metadata: this.metadata
        };
    }
  }

  // --- Public View Functions ---

  getData() {
    if (this.type === 'array') {
        const sortedItems = this._getSortedItems();
        return sortedItems.map(item => item.data);
    } else if (this.type === 'object') {
        const result = {};
        for (const key in this.data) {
            if (!this.metadata[key] || !this.metadata[key]._deleted) {
                result[key] = this.data[key];
            }
        }
        return result;
    }
    return undefined;
  }

  findPath(key, basePath = null) {
    const getDeep = (obj, path) => {
        let current = obj;
        for (const segment of path) {
            if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
                return undefined;
            }
            current = current[segment];
        }
        return current;
    };

    const search = (current, path) => {
        if (current === null || typeof current !== 'object') {
            return null;
        }

        if (Object.prototype.hasOwnProperty.call(current, key)) {
            return path;
        }

        for (const prop of Object.keys(current)) {
            const newPath = [...path, Array.isArray(current) ? parseInt(prop, 10) : prop];
            const result = search(current[prop], newPath);
            if (result) {
                return result;
            }
        }
        return null;
    };

    if (basePath === null) {
        const topLevelData = this.getData();
        if (topLevelData === undefined) return null;
        if (Array.isArray(topLevelData)) {
            for (let i = 0; i < topLevelData.length; i++) {
                const result = search(topLevelData[i], [i]);
                if (result) {
                    return result;
                }
            }
        } else {
            for (const topKey in topLevelData) {
                const result = search(topLevelData[topKey], [topKey]);
                if (result) {
                    return result;
                }
            }
        }
        return null;
    }

    const topLevelData = this.getData();
    const topLevelItem = topLevelData[basePath[0]];
    if (topLevelItem === undefined) {
        return null;
    }
    const searchContext = getDeep(topLevelItem, basePath.slice(1));
    if (searchContext === undefined) {
        return null;
    }
    
    const relativePath = search(searchContext, []);
    return relativePath ? [...basePath, ...relativePath] : null;
  }
  
  // --- Operation Generators (Public API) ---

  // For array type
  addItem(index, data) {
    if (this.type === 'object') throw new Error('addItem can only be used on array-type CollabJSON.');
    if (this.type === null) {
        this.type = 'array';
        this.items = new Map();
    }
    const sortedItems = this._getSortedItems();
    const { prevKey, nextKey } = this._findSortKeys(sortedItems, index);
    const newSortKey = this._generateSortKey(prevKey, nextKey);
    const newItemId = this._generateId();

    this._applyAndStore({
      type: 'ADD_ITEM',
      itemId: newItemId,
      data: data,
      sortKey: newSortKey,
      timestamp: this._tick(),
    });
  }

  deleteItem(index) {
    if (this.type !== 'array') throw new Error('deleteItem can only be used on array-type CollabJSON.');
    const item = this._getSortedItems()[index];
    if (!item) return;

    this._applyAndStore({
      type: 'DELETE_ITEM',
      itemId: item.id,
      timestamp: this._tick(),
    });
  }

  moveItem(fromIndex, toIndex) {
    if (this.type !== 'array') throw new Error('moveItem can only be used on array-type CollabJSON.');
    const itemToMove = this._getSortedItems()[fromIndex];
    if (!itemToMove) throw new Error('Item to move not found');
    
    const targetSortedItems = this._getSortedItems().filter(item => item.id !== itemToMove.id);
    const { prevKey, nextKey } = this._findSortKeys(targetSortedItems, toIndex);
    const newSortKey = this._generateSortKey(prevKey, nextKey);

    this._applyAndStore({
        type: 'MOVE_ITEM',
        itemId: itemToMove.id,
        newSortKey: newSortKey,
        timestamp: this._tick(),
    });
  }

  // For object type
  setItem(key, value) {
    if (this.type === 'array') throw new Error('setItem can only be used on object-type CollabJSON.');
    if (this.type === null) {
        this.type = 'object';
        this.data = {};
        this.metadata = {};
    }
    this._applyAndStore({
      type: 'SET_ITEM',
      key: key,
      value: value,
      timestamp: this._tick(),
    });
  }

  removeItem(key) {
    if (this.type === null || this.type === 'array') throw new Error('removeItem can only be used on object-type CollabJSON.');
    if (!this.data || !this.data[key]) return;

    this._applyAndStore({
      type: 'REMOVE_ITEM',
      key: key,
      timestamp: this._tick(),
    });
  }

  // For both types
  updateItem(path, newData) {
    if (!path || path.length === 0) throw new Error('Invalid path for updateItem');
    
    if (this.type === 'array') {
        const itemIndex = path[0];
        const subPath = path.slice(1);
        const item = this._getSortedItems()[itemIndex];
        if (!item) throw new Error('Item not found for update');
        this._applyAndStore({
            type: 'UPDATE_ITEM',
            itemId: item.id,
            path: subPath,
            data: newData,
            timestamp: this._tick(),
        });
    } else {
        const key = path[0];
        const subPath = path.slice(1);
        if (this.type === null || !this.data || !this.data[key]) throw new Error('Item not found for update');
        this._applyAndStore({
            type: 'UPDATE_ITEM',
            key: key,
            path: subPath,
            data: newData,
            timestamp: this._tick(),
        });
    }
  }

  prune(pruneFn, clientRequestData) {
    // Allow custom logic to run, e.g. for comparing 'today' dates.
    if (pruneFn) {
        pruneFn(this, clientRequestData);
    }

    if (this.history.length < history_prune_limit) {
      return;
    }

    this.snapshot = this._getSnapshotData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = this.history.slice(-history_prune_window);
  }
  
  // --- Sync Function ---

  /**
   * Applies a local or remote operation to the document state.
   * Assumes this is called on the correct CollabJSON instance for ADD_ITEM.
   * For other ops, it searches the entire tree for the item.
   */
  applyOp(op) {
    this._mergeClock(op.timestamp);

    let meta, item;

    switch (op.type) {
      // Array operations
      case 'ADD_ITEM':
        if (this.type !== 'array') break;
        if (!this.items.has(op.itemId)) {
          this.items.set(op.itemId, {
            id: op.itemId,
            data: op.data,
            sortKey: op.sortKey,
            updated: op.timestamp,
            _deleted: false,
          });
        }
        item = this.items.get(op.itemId);
        if (op.timestamp >= item.updated) {
            item.data = op.data;
            item.sortKey = op.sortKey;
            item.updated = op.timestamp;
            item._deleted = false;
        }
        break;
      case 'DELETE_ITEM':
        if (this.type !== 'array') break;
        item = this.items.get(op.itemId);
        if (item && op.timestamp > item.updated) {
          item._deleted = true;
          item.updated = op.timestamp;
        }
        break;
      case 'MOVE_ITEM':
        if (this.type !== 'array') break;
        item = this.items.get(op.itemId);
        if (item && op.timestamp > item.updated) {
          item.sortKey = op.newSortKey;
          item.updated = op.timestamp;
        }
        break;

      // Object operations
      case 'SET_ITEM':
        if (this.type !== 'object') break;
        meta = this.metadata[op.key];
        if (!meta || op.timestamp >= meta.updated) {
            this.data[op.key] = op.value;
            this.metadata[op.key] = {
                updated: op.timestamp,
                _deleted: false,
            };
        }
        break;
      case 'REMOVE_ITEM':
        if (this.type !== 'object') break;
        meta = this.metadata[op.key];
        if (meta && op.timestamp > meta.updated) {
          meta._deleted = true;
          meta.updated = op.timestamp;
        }
        break;

      // Shared operation
      case 'UPDATE_ITEM':
        if (this.type === 'array') {
            item = this.items.get(op.itemId);
            if (!item || op.timestamp <= item.updated) break;
        } else {
            meta = this.metadata[op.key];
            if (!meta || op.timestamp <= meta.updated) break;
            item = { data: this.data[op.key] }; // create a compatible structure for logic below
        }
        
        if (op.path && op.path.length > 0) {
            const newData = structuredClone(item.data);
            let current = newData;
            for (let i = 0; i < op.path.length - 1; i++) {
                if (typeof current !== 'object' || current === null) return;
                current = current[op.path[i]];
            }
            if (typeof current !== 'object' || current === null) return;
            const finalKey = op.path[op.path.length - 1];
            current[finalKey] = op.data;
            item.data = newData;
        } else {
            item.data = op.data;
        }
        
        if (this.type === 'array') {
            item.updated = op.timestamp;
            item._deleted = false;
        } else {
            this.data[op.key] = item.data;
            meta.updated = op.timestamp;
            meta._deleted = false;
        }
        break;
    }
  }

  // --- Persistence Methods ---

  toJSON() {
    return {
      type: this.type,
      id: this.id,
      data: this.data || undefined,
      items: this.type === 'array' ? Array.from(this.items.entries()) : undefined,
      metadata: this.metadata || undefined,
      history: this.history,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
    };
  }

  static fromJSON(state, options = {}) {
    // Pass undefined for jsonString, as we are hydrating from a state object.
    const doc = new CollabJSON(undefined, { ...options, id: state ? state.id : undefined });
    if (state) {
        doc.type = state.type || 'object';
        if (state.snapshot) {
            if (doc.type === 'array') {
                doc.items = new Map();
                (state.snapshot || []).forEach(item => doc.items.set(item.id, item));
            } else {
                doc.data = state.snapshot.data || {};
                doc.metadata = state.snapshot.metadata || {};
            }
            doc.snapshot = state.snapshot;
            doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));
        } else {
            if (doc.type === 'array') {
                doc.items = new Map(state.items || []);
            } else {
                doc.data = state.data || {};
                doc.metadata = state.metadata || {};
            }
        }
        
        if (state.history) {
            doc.history = state.history || [];
            doc.dvv = new Map(Object.entries(state.dvv || {}));
            doc.history.forEach(op => doc.applyOp(op));
        }
    }
    return doc;
  }

  // --- DVV Sync Methods ---

  getSyncRequest() {
    const lastSeenBySystem = this.dvv.get(this.clientId) || 0;
    const newOps = this.ops.filter(op => op.timestamp > lastSeenBySystem);
    this.checked = Date.now();
    
    return {
      dvv: Object.fromEntries(this.dvv),
      ops: newOps,
      clientId: this.clientId,
      docId: this.id
    };
  }

  applySyncResponse({ ops, dvv, snapshot, snapshotDvv, reset, type, id }) {
    if (reset) {
        this.ops = []; // Discard local ops, client was too far behind or had a mismatched doc ID.
        
        // Re-initialize this object to match the server state.
        this.type = type;
        this.id = id;
        this.snapshot = snapshot;
        this.snapshotDvv = new Map(Object.entries(snapshotDvv || {}));
        this.dvv = new Map(Object.entries(snapshotDvv || {}));

        // Clear existing state and rebuild from snapshot
        if (type === 'array') {
            this.items = new Map();
            (snapshot || []).forEach(item => this.items.set(item.id, item));
            this.data = undefined;
            this.metadata = undefined;
        } else {
            this.data = snapshot ? snapshot.data || {} : {};
            this.metadata = snapshot ? snapshot.metadata || {} : {};
            this.items = undefined;
        }
        
        this.synced = Date.now();
        return;
    }

    ops.forEach(op => this.applyOp(op));
    this.dvv = new Map(Object.entries(dvv));

    // Prune local ops that have been acknowledged by the server
    this.ops = this.ops.filter(op => op.timestamp > (this.dvv.get(this.clientId) || 0));
    this.synced = Date.now();
  }

  getSyncResponse({ dvv: clientDvv, ops: clientOps, clientId }) {
    const clientDvvMap = new Map(Object.entries(clientDvv));

    // Check if client is too far behind and needs a snapshot
    if (this.snapshot) {
        let needsReset = false;
        // If client is missing knowledge from snapshot, it needs reset.
        for (const [cId, ts] of this.snapshotDvv.entries()) {
            if ((clientDvvMap.get(cId) || 0) < ts) {
                needsReset = true;
                break;
            }
        }

        if (needsReset) {
            return {
                id: this.id,
                type: this.type,
                snapshot: this.snapshot,
                snapshotDvv: Object.fromEntries(this.snapshotDvv),
                reset: true
            };
        }
    }

    clientOps.forEach(op => {
        this.applyOp(op);
        this.history.push(op);
    });

    const maxTs = clientOps.reduce((max, op) => op.clientId === clientId ? Math.max(max, op.timestamp) : max, 0);
    if (maxTs > 0) {
      const currentTs = this.dvv.get(clientId) || 0;
      this.dvv.set(clientId, Math.max(currentTs, maxTs));
    }

    const opsForClient = this.history.filter(op => {
        const lastSeenByClient = clientDvvMap.get(op.clientId) || 0;
        return op.timestamp > lastSeenByClient;
    });

    return {
        ops: opsForClient,
        dvv: Object.fromEntries(this.dvv)
    };
  }
}
