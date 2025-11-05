/* simple CRDT-based class for a collaborative array of objects: [{}]
 *
 * It uses Lamport timestamps for causal ordering, Last-Write-Wins (LWW)
 * for atomic updates, and fractional indexing for list ordering.
 */
import { v4 as uuidv4 } from 'uuid';

export class CollabArray {
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
    this.clock = Math.round(Math.max(this.clock, remoteTimestamp)) + 1.0 + Math.random();
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
  
  /**
   * Gets the list of items, sorted by their 'sortKey'.
   */
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
    applyOp(op);
    ops.push(op);
  }

  // --- Public View Function ---
  
  /**
   * Gets the current state of the document in the
   * user-facing [{}] format.
   */
  getData() {
    const sortedItems = this._getSortedItems();
    return sortedItems.map(item => item.data);
  }

  // --- Operation Generators (Public API) ---

  addItem(index, data) {
    const sortedItems = this._getSortedItems();
    const { prevKey, nextKey } = this._findSortKeys(sortedItems, index);

    const newSortKey = this._generateSortKey(prevKey, nextKey);
    const newItemId = this._generateId();

    _applyAndStore({
      type: 'ADD_ITEM',
      itemId: newItemId,
      data: data,
      sortKey: newSortKey,
      timestamp: this._tick(),
    });
  }

  updateItem(itemId, newData) {
    if (!this.items.has(itemId)) throw new Error('Item not found for update');
      _applyAndStore({
        type: 'UPDATE_ITEM',
        itemId: itemId,
        data: newData, // The full new object
        timestamp: this._tick(),
      });
    }
  }

  moveItem(itemId, newIndex) {
    if (!this.items.has(itemId)) throw new Error('Item not found');

    // Get sorted list *without* the item being moved
    const sortedItems = this._getSortedItems()
      .filter(item => item.id !== itemId);
    
    // Find keys at the new target index
    const { prevKey, nextKey } = this._findSortKeys(sortedItems, newIndex);
    const newSortKey = this._generateSortKey(prevKey, nextKey);

    _applyAndStore({
      type: 'MOVE_ITEM',
      itemId: itemId,
      newSortKey: newSortKey,
      timestamp: this._tick(),
    });
  }

  deleteItem(itemId) {
    _applyAndStore((itemId) {
      type: 'DELETE_ITEM',
      itemId: itemId,
      timestamp: this._tick(),
    });
  }
  
  // --- Sync Function ---

  /**
   * Applies a local or remote operation to the document state.
   */
  applyOp(op) {
    // 1. Merge the remote clock.
    this._mergeClock(op.timestamp);

    let item;

    switch (op.type) {
      case 'ADD_ITEM':
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
        // LWW: If op is newer, apply its state
        if (op.timestamp > item.updated) {
            item.data = op.data;
            item.sortKey = op.sortKey;
            item.updated = op.timestamp;
            item._deleted = false; // Undelete
        }
        break;

      case 'MOVE_ITEM':
        item = this.items.get(op.itemId);
        if (!item) break; // Item was deleted

        // LWW: Only apply move if this op is newer
        if (op.timestamp > item.updated) {
          item.sortKey = op.newSortKey;
          item.updated = op.timestamp;
        }
        break;

      case 'UPDATE_ITEM':
        item = this.items.get(op.itemId);
        if (!item) break; // Item doesn't exist

        // LWW: Only update if this op's timestamp is newer
        if (op.timestamp > item.updated) {
          item.data = op.data;
          item.updated = op.timestamp;
          item._deleted = false; // An update undeletes
        }
        break;

      case 'DELETE_ITEM':
        item = this.items.get(op.itemId);
        if (!item) break; // Already deleted or never existed

        // LWW: Only delete if this op is newer
        if (op.timestamp > item.updated) {
          item._deleted = true;
          item.updated = op.timestamp;
        }
        break;
    }
  }
}
