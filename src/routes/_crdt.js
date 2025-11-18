/* simple CRDT-based class for a collaborative JSON document (nested arrays).
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

const history_prune_limit = 100;
const history_prune_window = 50;

export class CollabJSON {
  constructor(options = {}) {
    this.items = new Map();
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
    this.applyOp(op);
    this.ops.push(op);
  }

  _findItem(itemId) {
    return this.items.get(itemId) || null;
  }

  _findContainer(containerId) {
    if (this.id === containerId) return this;
    return null;
  }

  _resolvePath(path) {
    if (path.length > 1) {
        throw new Error('Nested paths are not supported.');
    }
    const finalIndex = path[path.length - 1];
    return { container: this, index: finalIndex };
  }

  _getSnapshotData() {
    // Get a serializable array of the full item objects, not just their data.
    const snapshotItems = [];
    for (const item of this._getSortedItems()) {
        const itemClone = { ...item };
        snapshotItems.push(itemClone);
    }
    return snapshotItems;
  }

  // --- Public View Functions ---

  getData() {
    const sortedItems = this._getSortedItems();
    return sortedItems.map(item => item.data);
  }

  getItem(path) {
    const { container, index } = this._resolvePath(path);
    const item = container._getSortedItems()[index];
    if (!item) throw new Error('Item not found for getItem');
    return item.data;
  }
  
  // --- Operation Generators (Public API) ---

  addItem(path, data) {
    const { container, index } = this._resolvePath(path);

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

    let item;

    switch (op.type) {
      case 'ADD_ITEM':
        const container = this._findContainer(op.containerId);
        if (!container) {
            console.warn(`Container ${op.containerId} not found for ADD_ITEM.`);
            break;
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
            item.data = op.data;
            item.sortKey = op.sortKey;
            item.updated = op.timestamp;
            item._deleted = false;
        }
        break;

      case 'MOVE_ITEM':
        item = this._findItem(op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.sortKey = op.newSortKey;
          item.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        item = this._findItem(op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.data = op.data;
          item.updated = op.timestamp;
          item._deleted = false;
        }
        break;

      case 'DELETE_ITEM':
        item = this._findItem(op.itemId);
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
    // This is a root document. Return the full state for persistence.
    return {
      id: this.id,
      history: this.history,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
    };
  }

  static fromJSON(state, options = {}) {
    const doc = new CollabJSON({ ...options, id: state ? state.id : undefined });
    if (state) {
        if (state.snapshot) {
            // Reconstruct the items map directly from the snapshot data.
            state.snapshot.forEach(item => {
                const newItem = { ...item };
                doc.items.set(newItem.id, newItem);
            });

            doc.snapshot = state.snapshot;
            doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));
        }
        
        // Only replay history if it exists (i.e., for root documents)
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

  applySyncResponse({ ops, dvv, snapshot, snapshotDvv, reset }) {
    if (reset) {
        this.ops = []; // Discard local ops, client was too far behind or had a mismatched doc ID.
        
        // Reconstruct the entire document from the server's snapshot.
        const newDoc = CollabJSON.fromJSON({ snapshot: snapshot, snapshotDvv: snapshotDvv });

        // Transplant the state from the reconstructed document.
        this.items = newDoc.items;
        this.snapshot = newDoc.snapshot;
        this.snapshotDvv = newDoc.snapshotDvv;
        this.id = newDoc.id; // This is crucial for subsequent syncs to have the right ID.
        
        this.dvv = new Map(Object.entries(snapshotDvv || {}));
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
