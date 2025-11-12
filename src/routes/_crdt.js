/* simple CRDT-based class for a collaborative JSON document (nested arrays).
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

export class CollabJSON {
  constructor() {
    this.items = new Map();
    this.clock = 0;
    this.ops = [];
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
      .sort((a, b) => a.sortKey - b.sortKey);
  }

  _findSortKeys(list, index) {
    const prevItem = list[index - 1] || null;
    const nextItem = list[index] || null;

    const prevKey = prevItem ? prevItem.sortKey : null;
    const nextKey = nextItem ? nextKey.sortKey : null;

    return { prevKey, nextKey };
  }

  _applyAndStore(op) {
    this.applyOp(op);
    this.ops.push(op);
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
        const newDoc = new CollabJSON();
        // Deep copy of items and ops
        newDoc.items = new Map(JSON.parse(JSON.stringify(Array.from(itemData.items))));
        newDoc.ops = JSON.parse(JSON.stringify(itemData.ops));
        newDoc.clock = itemData.clock;
        return newDoc;
    }
    return itemData;
  }
  
  // --- Operation Generators (Public API) ---

  addItem(path, data) {
    const { container, index } = this._resolvePath(path);

    if (data instanceof CollabJSON) {
      container._mergeClock(data.clock);
      data.ops.forEach(op => container._mergeClock(op.timestamp));
    }

    const sortedItems = container._getSortedItems();
    const { prevKey, nextKey } = container._findSortKeys(sortedItems, index);
    const newSortKey = this._generateSortKey(prevKey, nextKey);
    const newItemId = this._generateId();

    const op = {
      type: 'ADD_ITEM',
      itemId: newItemId,
      data: data,
      sortKey: newSortKey,
      timestamp: container._tick(),
    };
    container._applyAndStore(op);

    if (data instanceof CollabJSON) {
        data.ops.forEach(childOp => {
            // Simply append ops. Assumes item IDs are universally unique.
            container.ops.push(childOp);
        });
    }
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
    const targetSortedItems = toContainer._getSortedItems().filter(item => item.id !== itemToMove.id);
    const { prevKey, nextKey } = toContainer._findSortKeys(targetSortedItems, toIndex);
    const newSortKey = this._generateSortKey(prevKey, nextKey);

    // This op affects an item, which could be in any container.
    // The top-level applyOp will find it.
    this._applyAndStore({
      type: 'MOVE_ITEM',
      itemId: itemToMove.id,
      newSortKey: newSortKey,
      timestamp: this._tick(),
    });
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
  
  // --- Sync Function ---

  /**
   * Applies a local or remote operation to the document state.
   * Assumes this is called on the correct CollabJSON instance for ADD_ITEM.
   * For other ops, it searches the entire tree for the item.
   */
  applyOp(op) {
    this._mergeClock(op.timestamp);

    let item;

    // Helper to find an item anywhere in the nested structure.
    const findItem = (doc, itemId) => {
        if (doc.items.has(itemId)) return doc.items.get(itemId);
        for (const i of doc.items.values()) {
            if (i.data instanceof CollabJSON) {
                const found = findItem(i.data, itemId);
                if (found) return found;
            }
        }
        return null;
    };

    switch (op.type) {
      case 'ADD_ITEM':
        // ADD must be applied to the correct container.
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

      case 'MOVE_ITEM':
        item = findItem(this, op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.sortKey = op.newSortKey;
          item.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        item = findItem(this, op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item.data = op.data;
          item.updated = op.timestamp;
          item._deleted = false;
        }
        break;

      case 'DELETE_ITEM':
        item = findItem(this, op.itemId);
        if (!item) break;
        if (op.timestamp > item.updated) {
          item._deleted = true;
          item.updated = op.timestamp;
        }
        break;
    }
  }
}
