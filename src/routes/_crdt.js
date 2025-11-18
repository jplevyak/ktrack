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
    this.data = {};
    this.metadata = {};
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


  _applyAndStore(op) {
    op.clientId = this.clientId;

    if (op.type === 'UPDATE_ITEM') {
      const lastOp = this.ops.length > 0 ? this.ops[this.ops.length - 1] : null;
      if (lastOp && lastOp.type === 'UPDATE_ITEM' && lastOp.key === op.key && JSON.stringify(lastOp.path) === JSON.stringify(op.path)) {
        // The new op shadows the previous one for the same path.
        lastOp.data = op.data;
        lastOp.timestamp = op.timestamp;
        this.applyOp(op);
        return;
      }
    }

    this.applyOp(op);
    this.ops.push(op);
  }


  _getSnapshotData() {
    return {
        data: this.data,
        metadata: this.metadata
    };
  }

  // --- Public View Functions ---

  getData() {
    const result = {};
    for (const key in this.data) {
        if (!this.metadata[key] || !this.metadata[key]._deleted) {
            result[key] = this.data[key];
        }
    }
    return result;
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
        const topLevelObject = this.getData();
        for (const topKey in topLevelObject) {
            const result = search(topLevelObject[topKey], [topKey]);
            if (result) {
                return result;
            }
        }
        return null;
    }

    const topLevelItem = this.getData()[basePath[0]];
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

  setItem(key, value) {
    this._applyAndStore({
      type: 'SET_ITEM',
      key: key,
      value: value,
      timestamp: this._tick(),
    });
  }

  updateItem(path, newData) {
    if (!path || path.length === 0) throw new Error('Invalid path for updateItem');
    const key = path[0];
    const subPath = path.slice(1);

    if (!this.data[key]) throw new Error('Item not found for update');

    this._applyAndStore({
      type: 'UPDATE_ITEM',
      key: key,
      path: subPath,
      data: newData,
      timestamp: this._tick(),
    });
  }

  removeItem(key) {
    if (!this.data[key]) return;

    this._applyAndStore({
      type: 'REMOVE_ITEM',
      key: key,
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

    let meta;

    switch (op.type) {
      case 'SET_ITEM':
        meta = this.metadata[op.key];
        if (!meta || op.timestamp >= meta.updated) {
            this.data[op.key] = op.value;
            this.metadata[op.key] = {
                updated: op.timestamp,
                _deleted: false,
            };
        }
        break;

      case 'UPDATE_ITEM':
        meta = this.metadata[op.key];
        if (!meta || op.timestamp <= meta.updated) break;

        if (op.path && op.path.length > 0) {
          const newData = structuredClone(this.data[op.key]);
          let current = newData;
          for (let i = 0; i < op.path.length - 1; i++) {
              if (typeof current !== 'object' || current === null) return; // Path is invalid, ignore op.
              current = current[op.path[i]];
          }
          if (typeof current !== 'object' || current === null) return; // Path is invalid, ignore op.
          const finalKey = op.path[op.path.length - 1];
          current[finalKey] = op.data;
          this.data[op.key] = newData;
        } else {
          this.data[op.key] = op.data;
        }
        meta.updated = op.timestamp;
        meta._deleted = false;
        break;

      case 'REMOVE_ITEM':
        meta = this.metadata[op.key];
        if (meta && op.timestamp > meta.updated) {
          meta._deleted = true;
          meta.updated = op.timestamp;
        }
        break;
    }
  }

  // --- Persistence Methods ---

  toJSON() {
    return {
      id: this.id,
      data: this.data,
      metadata: this.metadata,
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
            // Reconstruct the state directly from the snapshot data.
            doc.data = state.snapshot.data || {};
            doc.metadata = state.snapshot.metadata || {};
            doc.snapshot = state.snapshot;
            doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));
        } else {
            doc.data = state.data || {};
            doc.metadata = state.metadata || {};
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
