/* simple CRDT-based class for a collaborative JSON document (nested arrays).
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

export class CollabJSON {
  constructor(options = {}) {
    this.items = new Map();
    this.id = options.id || uuidv4();
    this.root = options.root || this;

    if (this.root === this) {
      this.clientId = options.clientId || uuidv4();
      this.clock = 0;
      this.dvv = new Map();
      this.ops = []; // local ops for the whole document
      this.history = []; // all ops on server
      this.snapshot = null;
      this.snapshotDvv = new Map();
    }
  }

  // --- Private Helper Functions ---

  _tick() {
    this.root.clock = Math.round(this.root.clock) + 1.0 + Math.random();
    return this.root.clock;
  }

  _mergeClock(remoteTimestamp) {
    if (remoteTimestamp) {
      this.root.clock = Math.round(Math.max(this.root.clock, remoteTimestamp)) + 1.0 + Math.random();
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
    op.clientId = this.root.clientId;
    this.root.applyOp(op);
    this.root.ops.push(op);
  }

  _setRoot(root) {
    this.root = root;
    for (const item of this.items.values()) {
      if (item.data instanceof CollabJSON) {
        item.data._setRoot(root);
      }
    }
  }

  _findItem(itemId) {
    if (this.items.has(itemId)) return this.items.get(itemId);
    for (const i of this.items.values()) {
        if (i.data instanceof CollabJSON) {
            const found = i.data._findItem(itemId);
            if (found) return found;
        }
    }
    return null;
  }

  _findContainer(containerId) {
    if (this.id === containerId) return this;
    for (const i of this.items.values()) {
        if (i.data instanceof CollabJSON) {
            const found = i.data._findContainer(containerId);
            if (found) return found;
        }
    }
    return null;
  }

  _resolvePath(path) {
    let container = this;
    const containerPath = path.slice(0, -1);
    const finalIndex = path[path.length - 1];

    for (const index of containerPath) {
      if (!(container instanceof CollabJSON)) throw new Error('Invalid path: part of path is not a CollabJSON container.');
      const sortedItems = container._getSortedItems();
      const item = sortedItems[index];
      if (!item) throw new Error(`Invalid path: index ${index} out of bounds.`);
      container = item.data;
    }

    if (!(container instanceof CollabJSON)) throw new Error('Invalid path: target container is not a CollabJSON.');
    return { container, index: finalIndex };
  }

  // --- Public View Functions ---

  getData() {
    const sortedItems = this._getSortedItems();
    return sortedItems.map(item => {
      if (item.data instanceof CollabJSON) {
        return item.data.getData();
      }
      return item.data;
    });
  }

  getItem(path) {
    const { container, index } = this._resolvePath(path);
    const item = container._getSortedItems()[index];
    if (!item) throw new Error('Item not found for getItem');
    const itemData = item.data;

    if (itemData instanceof CollabJSON) {
        const newDoc = new CollabJSON({ id: itemData.id });
        const data = itemData.getData();

        function build(doc, data) {
            data.forEach((item, index) => {
                if (Array.isArray(item)) {
                    const nested = new CollabJSON();
                    doc.addItem([index], nested);
                    build(nested, item);
                } else {
                    doc.addItem([index], item);
                }
            });
        }
        build(newDoc, data);
        return newDoc;
    }
    return itemData;
  }
  
  // --- Operation Generators (Public API) ---

  addItem(path, data) {
    const { container, index } = this._resolvePath(path);

    if (data instanceof CollabJSON) {
      data._setRoot(this.root);
      this._mergeClock(data.root.clock);
      // When adding a doc, its ops become part of the history of this doc.
      data.ops.forEach(op => this.root.ops.push(op));
    }

    const sortedItems = container._getSortedItems();
    const { prevKey, nextKey } = container._findSortKeys(sortedItems, index);
    const newSortKey = this._generateSortKey(prevKey, nextKey);
    const newItemId = this._generateId();

    const op = {
      type: 'ADD_ITEM',
      itemId: newItemId,
      containerId: container.id,
      data: data,
      sortKey: newSortKey,
      timestamp: this._tick(),
    };
    container._applyAndStore(op);
  }

  updateItem(path, newData) {
    const { container, index } = this._resolvePath(path);
    const item = container._getSortedItems()[index];
    if (!item) throw new Error('Item not found for update');

    this._applyAndStore({
      type: 'UPDATE_ITEM',
      itemId: item.id,
      data: newData,
      timestamp: this._tick(),
    });
  }

  moveItem(fromPath, toPath) {
    const { container: fromContainer, index: fromIndex } = this._resolvePath(fromPath);
    const itemToMove = fromContainer._getSortedItems()[fromIndex];
    if (!itemToMove) throw new Error('Item to move not found');
    
    const { container: toContainer, index: toIndex } = this._resolvePath(toPath);

    if (fromContainer !== toContainer) {
        // Cross-container move is a delete then an add to preserve item identity.
        this._applyAndStore({
            type: 'DELETE_ITEM',
            itemId: itemToMove.id,
            timestamp: this._tick(),
        });

        const targetSortedItems = toContainer._getSortedItems();
        const { prevKey, nextKey } = toContainer._findSortKeys(targetSortedItems, toIndex);
        const newSortKey = this._generateSortKey(prevKey, nextKey);
        
        toContainer._applyAndStore({
            type: 'ADD_ITEM',
            itemId: itemToMove.id,
            containerId: toContainer.id,
            data: itemToMove.data,
            sortKey: newSortKey,
            timestamp: this._tick(),
        });
    } else {
        // Same-container move just needs a sortKey update.
        const targetSortedItems = toContainer._getSortedItems().filter(item => item.id !== itemToMove.id);
        const { prevKey, nextKey } = toContainer._findSortKeys(targetSortedItems, toIndex);
        const newSortKey = this._generateSortKey(prevKey, nextKey);

        this._applyAndStore({
            type: 'MOVE_ITEM',
            itemId: itemToMove.id,
            newSortKey: newSortKey,
            timestamp: this._tick(),
        });
    }
  }

  deleteItem(path) {
    const { container, index } = this._resolvePath(path);
    const item = container._getSortedItems()[index];
    if (!item) return;

    this._applyAndStore({
      type: 'DELETE_ITEM',
      itemId: item.id,
      timestamp: this._tick(),
    });
  }

  prune(pruneFn) {
    if (this.root !== this) throw new Error('Pruning can only be done on the root document.');

    pruneFn(this);

    this.snapshot = this.getData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = [];
  }
  
  // --- Sync Function ---

  /**
   * Applies a local or remote operation to the document state.
   * Assumes this is called on the correct CollabJSON instance for ADD_ITEM.
   * For other ops, it searches the entire tree for the item.
   */
  applyOp(op) {
    this._mergeClock(op.timestamp);

    let item;

    switch (op.type) {
      case 'ADD_ITEM':
        const container = this.root._findContainer(op.containerId);
        if (!container) {
            console.warn(`Container ${op.containerId} not found for ADD_ITEM.`);
            break;
        }

        if (op.data instanceof CollabJSON) {
          op.data._setRoot(this.root);
        }

        if (!container.items.has(op.itemId)) {
          container.items.set(op.itemId, {
            id: op.itemId,
            data: op.data,
            sortKey: op.sortKey,
            updated: op.timestamp,
            _deleted: false,
          });
        }
        item = container.items.get(op.itemId);
        if (op.timestamp >= item.updated) {
            if (op.data instanceof CollabJSON) {
              item.data = new CollabJSON({ root: this.root, id: op.data.id });
              op.data.ops.forEach(childOp => item.data.applyOp(childOp));
            } else {
              item.data = op.data;
            }
            item.sortKey = op.sortKey;
            item.updated = op.timestamp;
            item._deleted = false;
        }
        break;

      case 'MOVE_ITEM':
        item = this.root._findItem(op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.sortKey = op.newSortKey;
          item.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        item = this.root._findItem(op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.data = op.data;
          item.updated = op.timestamp;
          item._deleted = false;
        }
        break;

      case 'DELETE_ITEM':
        item = this.root._findItem(op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item._deleted = true;
          item.updated = op.timestamp;
        }
        break;
    }
  }

  // --- Persistence Methods ---

  toJSON() {
    if (this.root !== this) throw new Error('toJSON can only be called on the root document.');
    return {
      id: this.id,
      year: this.year,
      month: this.month,
      date: this.date,
      day: this.day,
      history: this.history,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
    };
  }

  static fromJSON(state, options = {}) {
    const doc = new CollabJSON({ ...options, id: state ? state.id : undefined });
    if (state) {
        doc.year = state.year;
        doc.month = state.month;
        doc.date = state.date;
        doc.day = state.day;
        if (state.snapshot) {
            const tempDoc = new CollabJSON({ clientId: doc.clientId });
            function build(d, data) {
                data.forEach((item, index) => {
                    if (Array.isArray(item)) {
                        const nested = new CollabJSON();
                        d.addItem([index], nested);
                        build(nested, item);
                    } else {
                        d.addItem([index], item);
                    }
                });
            }
            build(tempDoc, state.snapshot);
            doc.items = tempDoc.items;
            doc.snapshot = state.snapshot;
            doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));
        }
        
        doc.history = state.history || [];
        doc.dvv = new Map(Object.entries(state.dvv || {}));
        doc.history.forEach(op => doc.applyOp(op));
    }
    return doc;
  }

  // --- DVV Sync Methods ---

  getSyncRequest() {
    if (this.root !== this) throw new Error('Sync methods can only be called on the root document.');

    const lastSeenBySystem = this.dvv.get(this.clientId) || 0;
    const newOps = this.ops.filter(op => op.timestamp > lastSeenBySystem);
    
    return {
      dvv: Object.fromEntries(this.dvv),
      ops: newOps,
      clientId: this.clientId
    };
  }

  applySyncResponse({ ops, dvv, snapshot, snapshotDvv, reset }) {
    if (this.root !== this) throw new Error('Sync methods can only be called on the root document.');

    if (reset) {
        this.ops = []; // Discard local ops, client was too far behind.
        
        const tempDoc = new CollabJSON({ clientId: this.clientId });
        function build(doc, data) {
            data.forEach((item, index) => {
                if (Array.isArray(item)) {
                    const nested = new CollabJSON();
                    doc.addItem([index], nested);
                    build(nested, item);
                } else {
                    doc.addItem([index], item);
                }
            });
        }
        build(tempDoc, snapshot);
        
        this.items = tempDoc.items;
        this.items.forEach(item => {
            if (item.data instanceof CollabJSON) {
                item.data._setRoot(this);
            }
        });
        
        this.dvv = new Map(Object.entries(snapshotDvv));
        return;
    }

    ops.forEach(op => this.applyOp(op));
    this.dvv = new Map(Object.entries(dvv));

    // Prune local ops that have been acknowledged by the server
    this.ops = this.ops.filter(op => op.timestamp > (this.dvv.get(this.clientId) || 0));
  }

  getSyncResponse({ dvv: clientDvv, ops: clientOps, clientId }) {
    if (this.root !== this) throw new Error('Sync methods can only be called on the root document.');
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
