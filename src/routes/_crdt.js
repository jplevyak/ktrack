/* Simple CRDT-based class for a collaborative JSON document.
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import {v4 as uuidv4} from 'uuid';

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

  _idToFloat(id) {
    // Use djb2 hash
    let hash = 5381; // "Magic" starting constant
    for (let i = 0; i < id.length; i++) {
      // Hash * 33 + c
      // We use ((hash << 5) + hash) as a fast way to do hash * 33
      // The bitwise operators in JS automatically handle 32-bit wrapping
      hash = ((hash << 5) + hash) + id.charCodeAt(i);
    }
    const unsignedHash = hash >>> 0; // Force to unsigned using right shift.
    return unsignedHash / 4294967296;
  }

  _tick() {
    // Hybrid logical clock: integer counter + client ID tie-breaker
    this.clock = Math.floor(this.clock) + 1;
    return this.clock + this._idToFloat(this.id);
  }

  _mergeClock(remoteTimestamp) {
    if (remoteTimestamp) {
      this.clock = Math.max(Math.floor(this.clock), Math.floor(remoteTimestamp)) + 1;
    }
  }

  _generateId() {
    return uuidv4();
  }

  _generateSortKey(previousKey, nextKey) {
    if (previousKey === null && nextKey === null) {
      return 0.5;
    } // Start in middle of 0..1

    if (previousKey === null) {
      return nextKey / 2;
    }

    if (nextKey === null) {
      return previousKey + 1;
    }

    const mid = (previousKey + nextKey) / 2;
    // Basic precision guard
    if (mid === previousKey || mid === nextKey) {
      console.warn('CollabJSON: Fractional indexing precision limit reached. Re-sorting recommended.');
      return previousKey + 0.000_000_000_01;
    }

    return mid;
  }

  _plainToCrdt(data, timestamp = 0, existingNode = null) {
    // Check for type mismatch between data and existingNode
    if (existingNode) {
      const isExistingArray = Boolean(existingNode[CRDT_ARRAY_MARKER]);
      const isDataArray = Array.isArray(data);
      // If types differ, treat existingNode as null (replacement)
      if (isExistingArray !== isDataArray) {
        existingNode = null;
      }
    }

    if (Array.isArray(data)) {
      const crdtArray = {[CRDT_ARRAY_MARKER]: true, items: {}, metadata: {}};

      // Get all existing items (including deleted) sorted by sortKey
      let existingItems = [];
      if (existingNode && existingNode[CRDT_ARRAY_MARKER]) {
        existingItems = Object.values(existingNode.items)
          .sort((a, b) => a.sortKey - b.sortKey || (a.id < b.id ? -1 : 1));
        Object.assign(crdtArray.metadata, existingNode.metadata);
      }

      let sortKey = 1;
      const usedIds = new Set();

      // Step 1: Process new items, trying to match with existing ones
      for (const itemData of data) {
        let matchedItem = null;

        // Strategy A: Match by ID (if provided in data)
        if (itemData && typeof itemData === 'object' && itemData.id !== undefined) {
          const targetId = String(itemData.id);
          matchedItem = existingItems.find(i => i.id === targetId);
        }

        if (matchedItem) {
          usedIds.add(matchedItem.id);

          if (matchedItem.updated > timestamp) {
            // Local item is newer. Preserve its data and deleted status, but update sortKey to match new order.
            crdtArray.items[matchedItem.id] = {
              ...matchedItem,
              sortKey,
            };
          } else {
            // Incoming update is newer. Overwrite (resurrect if deleted).
            crdtArray.items[matchedItem.id] = {
              id: matchedItem.id,
              data: this._plainToCrdt(itemData, timestamp, matchedItem.data),
              sortKey,
              updated: timestamp,
              _deleted: false,
            };
          }
        } else {
          // No match found. Create new item.
          // Use itemData.id as internal ID if available, otherwise generate one.
          let itemId;
          itemId = itemData && typeof itemData === 'object' && itemData.id !== undefined ? String(itemData.id) : this._generateId();

          crdtArray.items[itemId] = {
            id: itemId,
            data: this._plainToCrdt(itemData, timestamp),
            sortKey,
            updated: timestamp,
            _deleted: false,
          };
        }

        sortKey += 1;
      }

      // Step 2: Process remaining existing items (deletions)
      for (const existingItem of existingItems) {
        if (usedIds.has(existingItem.id)) {
          continue;
        }

        if (existingItem.updated > timestamp) {
          // Local is newer, preserve.
          crdtArray.items[existingItem.id] = existingItem;
        } else {
          // Incoming is newer (implicit delete).
          crdtArray.items[existingItem.id] = {
            ...existingItem,
            updated: timestamp,
            _deleted: true,
          };
        }
      }

      return crdtArray;
    }

    if (typeof data === 'object' && data !== null) {
      // Optimization: Store default timestamp for the object to avoid redundant metadata
      const newObject = {metadata: {_ts: timestamp}};
      const existingMeta = (existingNode && existingNode.metadata) ? existingNode.metadata : {};

      Object.assign(newObject.metadata, existingMeta);
      // Ensure _ts is updated to current timestamp if we are refreshing the object
      newObject.metadata._ts = timestamp;

      for (const key in data) {
        const existingChild = (existingNode && existingNode[key]) ? existingNode[key] : null;

        // Resolve existing metadata, handling default _ts
        let meta = existingMeta[key];
        if (!meta && existingChild && existingMeta._ts) {
          meta = {updated: existingMeta._ts, _deleted: false};
        }

        if (meta && meta.updated > timestamp) {
          // Local is newer. Keep local value.
          newObject[key] = existingChild;
          newObject.metadata[key] = meta;
        } else {
          // Incoming is newer.
          newObject[key] = this._plainToCrdt(data[key], timestamp, existingChild);
          // Optimization: Don't set metadata[key] if it matches the default { updated: timestamp, _deleted: false }
        }
      }

      if (existingNode) {
        for (const key in existingNode) {
          if (key === 'metadata') {
            continue;
          }

          if (!(key in data)) {
            let meta = existingMeta[key];
            if (!meta && existingMeta._ts) {
              meta = {updated: existingMeta._ts, _deleted: false};
            }

            if (meta && meta.updated > timestamp) {
              // Local is newer (and present). Keep it.
              newObject[key] = existingNode[key];
              newObject.metadata[key] = meta;
            } else {
              // Incoming (missing) is newer. Delete it.
              newObject[key] = existingNode[key];
              newObject.metadata[key] = {updated: timestamp, _deleted: true};
            }
          }
        }
      }

      return newObject;
    }

    return data;
  }

  _crdtToPlain(data) {
    if (typeof data === 'object' && data !== null) {
      if (data[CRDT_ARRAY_MARKER]) {
        return this._getSortedItems(data).map(item => this._crdtToPlain(item.data));
      }

      const newObject = {};
      for (const key in data) {
        if (key === 'metadata') {
          continue;
        }

        if (data.metadata && data.metadata[key] && data.metadata[key]._deleted) {
          continue;
        }

        newObject[key] = this._crdtToPlain(data[key]);
      }

      return newObject;
    }

    return data;
  }

  _getSortedItems(crdtArray) {
    if (!crdtArray || !crdtArray[CRDT_ARRAY_MARKER]) {
      return [];
    }

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
      if (container === null || typeof container !== 'object') {
        return null;
      }

      if (container[CRDT_ARRAY_MARKER]) {
        const sorted = this._getSortedItems(container);
        if (typeof segment !== 'number' || segment < 0 || segment >= sorted.length) {
          return null;
        }

        current = container.items[sorted[segment].id];
      } else {
        if (!Object.hasOwn(container, segment)) {
          return null;
        }

        current = container[segment];
      }
    }

    return {parent, key: finalKey, node: current};
  }

  _applyAndStore(op) {
    op.clientId = this.clientId;
    // Compression: If updating the same item consecutively, merge ops
    if (op.type === 'UPDATE_ITEM') {
      const lastOp = this.ops.length > 0 ? this.ops.at(-1) : null;
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

  _getSnapshotData() {
    return this.root;
  }

  // --- Public View Functions ---

  getData(path) {
    if (!path || path.length === 0) {
      return this._crdtToPlain(this.root);
    }

    const result = this._traverse(path);
    if (!result) {
      return undefined;
    }

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
    if (!currentNode) {
      return null;
    }

    // Unwrap array item wrapper
    let actualNode = currentNode;
    if (currentNode.hasOwnProperty('data') && currentNode.hasOwnProperty('sortKey')) {
      if (currentNode.id === targetId) {
        return currentPath;
      }

      actualNode = currentNode.data;
    }

    if (typeof actualNode !== 'object') {
      return null;
    }

    if (actualNode[CRDT_ARRAY_MARKER]) {
      const sorted = this._getSortedItems(actualNode);
      for (const [i, item] of sorted.entries()) {
        if (item.id === targetId) {
          return [...currentPath, i];
        }

        const res = this.findPath(targetId, [...currentPath, i], item);
        if (res) {
          return res;
        }
      }
    } else {
      for (const key in actualNode) {
        if (key === 'metadata') {
          continue;
        }

        if (actualNode.metadata && actualNode.metadata[key] && actualNode.metadata[key]._deleted) {
          continue;
        }

        if (key === targetId) {
          return [...currentPath, key];
        } // Found by key name

        const res = this.findPath(targetId, [...currentPath, key], actualNode[key]);
        if (res) {
          return res;
        }
      }
    }

    return null;
  }

  // --- Operation Generators (Public API) ---

  addItem(path, data) {
    const parentPath = path.slice(0, -1);
    const keyOrIndex = path.at(-1);

    if (typeof keyOrIndex === 'string') {
      this.updateItem(path, data);
      return;
    }

    if (typeof keyOrIndex !== 'number') {
      throw new TypeError('Final path segment for addItem must be an index or a key.');
    }

    const index = keyOrIndex;

    if (Object.keys(this.root).length === 0 && parentPath.length === 0) {
      this.root = this._plainToCrdt([]);
    }

    const result = this._traverse(parentPath);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) {
      throw new Error('Target for addItem is not an array.');
    }

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (index > sortedItems.length) {
      throw new Error('Index out of bounds.');
    }

    const previousItem = sortedItems[index - 1] || null;
    const nextItem = sortedItems[index] || null;
    const previousKey = previousItem ? previousItem.sortKey : null;
    const nextKey = nextItem ? nextItem.sortKey : null;

    const newSortKey = this._generateSortKey(previousKey, nextKey);
    const newItemId = this._generateId();

    this._applyAndStore({
      type: 'ADD_ITEM', path: parentPath, itemId: newItemId, data, sortKey: newSortKey, timestamp: this._tick(),
    });
  }

  moveItem(path, fromIndex, toIndex) {
    const result = this._traverse(path);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) {
      throw new Error('Target for moveItem is not an array.');
    }

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (fromIndex < 0 || fromIndex >= sortedItems.length) {
      throw new Error('fromIndex out of bounds');
    }

    if (toIndex < 0 || toIndex > sortedItems.length) {
      throw new Error('toIndex out of bounds');
    }

    if (fromIndex === toIndex) {
      return;
    }

    const itemToMove = sortedItems[fromIndex];

    // Calculate new sort key
    let previousKey = null;
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
      previousKey = sortedItems.at(-1).sortKey;
    } else {
      // Case 3: Moving to the middle (or effectively the end of the reduced list).
      // We simulate the list without the moved item to find the correct neighbors.

      const listWithoutItem = sortedItems.filter(i => i.id !== itemToMove.id);

      // We want to insert at 'toIndex'. However, since we removed one item,
      // the target index might be at the end of the reduced list.
      const actualToIndex = Math.min(toIndex, listWithoutItem.length);

      // The previous item is guaranteed to exist because toIndex > 0 (handled by Case 1).
      // nItem might be undefined if actualToIndex equals listWithoutItem.length (appending to reduced list).
      previousKey = listWithoutItem[actualToIndex - 1].sortKey;
      const nItem = listWithoutItem[actualToIndex];
      nextKey = nItem ? nItem.sortKey : null;
    }

    const newSortKey = this._generateSortKey(previousKey, nextKey);

    this._applyAndStore({
      type: 'MOVE_ITEM',
      path,
      itemId: itemToMove.id,
      sortKey: newSortKey,
      timestamp: this._tick(),
    });
  }

  deleteItem(path) {
    const result = this._traverse(path);
    if (!result) {
      return;
    } // Idempotent

    const {parent, key, node} = result;
    const op = {type: 'DELETE_ITEM', path, timestamp: this._tick()};

    if (parent[CRDT_ARRAY_MARKER]) {
      op.itemId = node.id;
    }

    this._applyAndStore(op);
  }

  updateItem(path, newData) {
    const p = path || [];
    this._applyAndStore({
      type: 'UPDATE_ITEM', path: p, data: newData, timestamp: this._tick(),
    });
  }

  prune(pruneFn, clientRequestData) {
    if (pruneFn) {
      pruneFn(this, clientRequestData);
    }

    if (this.history.length < HISTORY_PRUNE_LIMIT) {
      return;
    }

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
    if (typeof node !== 'object' || node === null) {
      return;
    }

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
        if (key === 'metadata') {
          continue;
        }

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
      for (const op of this.ops) {
        this.history.push(op);
      }

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
    const {parent, node} = this._traverse(traversePath) || {};

    switch (op.type) {
      case 'ADD_ITEM': {
        const targetArray = this._traverse(op.path)?.node;
        if (!targetArray || !targetArray[CRDT_ARRAY_MARKER]) {
          break;
        }

        let item = targetArray.items[op.itemId];
        item ||= targetArray.items[op.itemId] = {id: op.itemId};

        if (!item.updated || op.timestamp >= item.updated) {
          item.data = this._plainToCrdt(op.data, op.timestamp);
          item.sortKey = op.sortKey;
          item.updated = op.timestamp;
          item._deleted = false;
        }

        break;
      }

      case 'MOVE_ITEM': {
        const moveArray = this._traverse(op.path)?.node;
        if (!moveArray || !moveArray[CRDT_ARRAY_MARKER]) {
          break;
        }

        const itemToMove = moveArray.items[op.itemId];
        if (!itemToMove) {
          break;
        } // Item doesn't exist (maybe deleted or not synced yet)

        // LWW on the sortKey specifically.
        // We use the item's general 'updated' timestamp.
        // If a delete happened later, _deleted will be true, and we shouldn't un-delete it just by moving.
        if (op.timestamp > (itemToMove.updated || 0)) {
          itemToMove.sortKey = op.sortKey;
          itemToMove.updated = op.timestamp;
          // Note: We do NOT set _deleted = false here. If it was deleted, moving it shouldn't bring it back.
        }

        break;
      }

      case 'DELETE_ITEM': {
        // Improved delete logic: resolve parent container first
        const parentPath = op.path.slice(0, -1);
        const parentRes = this._traverse(parentPath);

        if (!parentRes || !parentRes.node) {
          break;
        }

        const container = parentRes.node;

        let targetMeta = null;

        if (container[CRDT_ARRAY_MARKER]) {
          // For arrays, use itemId to identify the item to delete
          if (op.itemId && container.items[op.itemId]) {
            targetMeta = container.items[op.itemId];
          }
        } else {
          // For objects, use the key from the path
          const key = op.path.at(-1);

          // Resolve metadata (explicit or default)
          let targetUpdated = 0;
          if (container.metadata) {
            if (container.metadata[key]) {
              targetUpdated = container.metadata[key].updated;
            } else if (container.metadata._ts && container[key]) {
              targetUpdated = container.metadata._ts;
            }
          }

          if (op.timestamp > targetUpdated) {
            container.metadata ||= {};
            // Materialize metadata if it was implicit
            if (!container.metadata[key]) {
              container.metadata[key] = {updated: targetUpdated, _deleted: false};
            }

            targetMeta = container.metadata[key];
          }
        }

        if (targetMeta) {
          targetMeta._deleted = true;
          targetMeta.updated = op.timestamp;
        }

        break;
      }

      case 'UPDATE_ITEM': {
        if (op.path.length === 0) {
          this.root = this._plainToCrdt(op.data, op.timestamp, this.root);
          break;
        }

        const updateRes = this._traverse(op.path);
        if (updateRes && updateRes.parent) {
          const {parent, key, node} = updateRes;

          let itemUpdated = 0;
          if (parent[CRDT_ARRAY_MARKER]) {
            itemUpdated = node ? node.updated : 0;
          } else {
            // Resolve metadata for object property
            if (parent.metadata && parent.metadata[key]) {
              itemUpdated = parent.metadata[key].updated;
            } else if (parent.metadata && parent.metadata._ts && parent[key]) {
              itemUpdated = parent.metadata._ts;
            }
          }

          if (itemUpdated && op.timestamp <= itemUpdated) {
            break;
          }

          if (parent[CRDT_ARRAY_MARKER]) {
            node.data = this._plainToCrdt(op.data, op.timestamp, node.data);
            node.updated = op.timestamp;
            node._deleted = false;
          } else {
            parent[key] = this._plainToCrdt(op.data, op.timestamp, parent[key]);
            parent.metadata ||= {};
            parent.metadata[key] = {updated: op.timestamp, _deleted: false};
          }
        } else if (op.path.length > 0) { // Create path (upsert)
          let current = this.root;
          for (let i = 0; i < op.path.length - 1; i++) {
            const segment = op.path[i];
            let container = current;
            if (container && container.hasOwnProperty('data') && container.hasOwnProperty('sortKey')) {
              container = container.data;
            }

            if (!Object.hasOwn(container, segment) || typeof container[segment] !== 'object' || container[segment] === null) {
              container[segment] = this._plainToCrdt({}, op.timestamp);
              container.metadata ||= {};
              container.metadata[segment] = {updated: op.timestamp, _deleted: false};
            }

            current = container[segment];
          }

          const finalKey = op.path.at(-1);
          let parentContainer = current;
          if (parentContainer && parentContainer.hasOwnProperty('data') && parentContainer.hasOwnProperty('sortKey')) {
            parentContainer = parentContainer.data;
          }

          if (typeof parentContainer !== 'object' || parentContainer === null) {
            break;
          }

          parentContainer[finalKey] = this._plainToCrdt(op.data, op.timestamp, parentContainer[finalKey]);
          parentContainer.metadata ||= {};
          parentContainer.metadata[finalKey] = {updated: op.timestamp, _deleted: false};
        }

        break;
      }
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
      ops: this.ops,
      dvv: Object.fromEntries(this.dvv),
      snapshot: this.snapshot,
      snapshotDvv: Object.fromEntries(this.snapshotDvv),
      checked: this.checked,
      synced: this.synced,
    };
  }

  static fromJSON(state, options = {}) {
    const doc = new CollabJSON(undefined, {
      ...options,
      id: state ? state.id : undefined,
      // Prioritize options.clientId if provided (e.g. global device ID), otherwise fallback to state or generate new
      clientId: options.clientId || ((state && state.clientId) ? state.clientId : undefined),
    });
    if (!state) {
      return doc;
    }

    doc.root = state.snapshot || state.root || {};
    doc.snapshot = state.snapshot;
    doc.snapshotDvv = new Map(Object.entries(state.snapshotDvv || {}));

    if (state.clock !== undefined) {
      doc.clock = state.clock;
    }

    if (state.checked !== undefined) {
      doc.checked = state.checked;
    }

    if (state.synced !== undefined) {
      doc.synced = state.synced;
    }

    if (state.ops) {
      doc.ops = state.ops;
    }

    if (state.history) {
      doc.history = state.history || [];
      doc.dvv = new Map(Object.entries(state.dvv || {}));
      // Do not re-apply history ops here. The 'root' (snapshot) is assumed to be the result of applying these ops.
      // Re-applying them can be destructive if the ops contain plain data (without IDs) and overwrite existing items.
    }

    return doc;
  }

  static fromSnapshot(snapshot, snapshotDvv, docId, options = {}) {
    const doc = new CollabJSON(undefined, {...options, id: docId});
    doc.root = snapshot || {};
    doc.snapshot = snapshot || {};
    doc.snapshotDvv = new Map(Object.entries(snapshotDvv || {}));
    doc.dvv = new Map(Object.entries(snapshotDvv || {}));

    // Initialize clock to the maximum timestamp seen in the snapshot
    let maxTs = 0;
    for (const ts of doc.dvv.values()) {
      if (ts > maxTs) {
        maxTs = ts;
      }
    }

    doc.clock = maxTs;

    return doc;
  }

  static loadOrInit(stateString, syncRequest, defaultJson, options = {}) {
    const options_ = {...options, clientId: 'server'};
    if (stateString) {
      return CollabJSON.fromJSON(JSON.parse(stateString), options_);
    }

    if (syncRequest && syncRequest.snapshot) {
      return CollabJSON.fromSnapshot(syncRequest.snapshot, syncRequest.snapshotDvv, syncRequest.docId, options_);
    }

    return new CollabJSON(defaultJson, {...options_, id: syncRequest ? syncRequest.docId : undefined});
  }

  static fromOps(ops) {
    const doc = new CollabJSON('{}');
    if (Array.isArray(ops)) {
      for (const op of ops) {
        doc.applyOp(op);
      }
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

    const request = {
      dvv: Object.fromEntries(this.dvv), ops: newOps, clientId: this.clientId, docId: this.id,
    };

    if (!this.synced) {
      request.snapshot = this._getSnapshotData();
      request.snapshotDvv = Object.fromEntries(this.dvv);
    }

    return request;
  }

  getResetResponse() {
    return {
      snapshot: this._getSnapshotData(),
      snapshotDvv: Object.fromEntries(this.dvv),
      reset: true,
      id: this.id,
    };
  }

  applySyncResponse({ops, dvv, snapshot, snapshotDvv, reset, id}) {
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
        if (ts > maxTs) {
          maxTs = ts;
        }
      }

      this.clock = Math.max(this.clock, maxTs);

      this.synced = Date.now();
      return;
    }

    for (const op of ops) {
      this.applyOp(op);
    }

    this.dvv = new Map(Object.entries(dvv));
    this.ops = this.ops.filter(op => op.timestamp > (this.dvv.get(this.clientId) || 0));
    this.synced = Date.now();
  }

  replaceData(jsonString) {
    const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

    // Advance clock to ensure this state is newer than any previous state
    this._tick();

    // Re-initialize root with new data at the current timestamp
    this.root = this._plainToCrdt(data, this.clock);

    // Purge history
    this.history = [];
    this.ops = [];

    // Reset DVV: We are the authority now.
    // We keep our own clock, but discard knowledge of others since we wiped their history.
    this.dvv.clear();
    this.dvv.set(this.clientId, this.clock);

    // Set snapshot
    this.snapshot = this.root;
    this.snapshotDvv = new Map(this.dvv);

    this.checked = Date.now();
    this.synced = Date.now();
  }

  getSyncResponse(syncRequest) {
    const {dvv: clientDvv, ops: clientOps, clientId, docId} = syncRequest;

    // 1. Check for Document ID mismatch
    if (this.id && docId && this.id !== docId) {
      return this.getResetResponse();
    }

    const clientDvvMap = new Map(Object.entries(clientDvv));

    // 2. Check for History Gap (Pruning)
    if (this.snapshot) {
      let needsReset = false;
      for (const [cId, ts] of this.snapshotDvv.entries()) {
        if ((clientDvvMap.get(cId) || 0) < ts) {
          needsReset = true;
          break;
        }
      }

      if (needsReset) {
        // Send current state as reset
        return this.getResetResponse();
      }
    }

    // 3. Normal Sync
    for (const op of clientOps) {
      this.applyOp(op);
      this.history.push(op);
    }

    const maxTs = clientOps.reduce((max, op) => op.clientId === clientId ? Math.max(max, op.timestamp) : max, 0);
    if (maxTs > 0) {
      this.dvv.set(clientId, Math.max(this.dvv.get(clientId) || 0, maxTs));
    }

    const opsForClient = this.history.filter(op => {
      if (op.clientId === clientId) {
        return false;
      }

      return (clientDvvMap.get(op.clientId) || 0) < op.timestamp;
    });
    return {ops: opsForClient, dvv: Object.fromEntries(this.dvv)};
  }
}
