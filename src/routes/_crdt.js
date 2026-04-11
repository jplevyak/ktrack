/* Simple CRDT-based class for a collaborative JSON document.
 *
 * Architecture:
 * - Uses Last-Write-Wins (LWW) registers for object properties and array items.
 * - Uses Fractional Indexing for conflict-free array ordering.
 * - "Wrapped Objects": All persistent objects are stored as { data: {}, metadata: {} }.
 *   "data" holds user properties, "metadata" holds per-key LWW timestamps.
 *
 * Conflict Resolution:
 * - Objects: LWW per key based on timestamps.
 * - Arrays: Unique IDs per item + Fractional Indexing for sort order.
 */
import { v4 as uuidv4 } from "uuid";

const HISTORY_PRUNE_LIMIT = 200;
const HISTORY_PRUNE_WINDOW = 100;
export const CRDT_ARRAY_MARKER = "_crdt_array_";

export class CollabJSON {
  constructor(jsonString, options = {}) {
    this.root = { data: {}, metadata: {} };

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

    // Custom generators
    this.idGenerator =
      options.idGenerator ||
      ((data, path) =>
        data && typeof data === "object" && data.id !== undefined
          ? String(data.id)
          : this._generateId());
    this.sortKeyGenerator = options.sortKeyGenerator || ((data, path) => null);

    if (jsonString) {
      this.root = this._plainToCrdt(JSON.parse(jsonString));
    }
  }

  // --- Private Helper Functions ---

  _idToFloat(id) {
    // Use djb2 hash
    let hash = 5381; // Starting constant
    for (let i = 0; i < id.length; i++) {
      // hash * 33 + c
      hash = (hash << 5) + hash + id.charCodeAt(i);
    }
    const unsignedHash = hash >>> 0; // Force to unsigned
    return unsignedHash / 4294967296;
  }

  _tick() {
    // Hybrid Logical Clock (HLC)
    // Combines physical time (in a rough integer sense via counter) with a client ID tie-breaker
    // to ensure total ordering of events across distributed systems.
    this.clock = Math.floor(this.clock) + 1;
    return this.clock + this._idToFloat(this.clientId);
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
      return 1;
    } // Start at 1 to match _plainToCrdt default

    if (previousKey === null) {
      return nextKey - 1;
    }

    if (nextKey === null) {
      return previousKey + 1;
    }

    const mid = (previousKey + nextKey) / 2;
    // Basic precision guard
    if (mid === previousKey || mid === nextKey) {
      console.warn(
        "CollabJSON: Fractional indexing precision limit reached. Re-sorting recommended.",
      );
      return previousKey + 0.000_000_000_01;
    }

    return mid;
  }

  _plainToCrdt(data, timestamp = 0, existingNode = null, path = []) {
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
      const crdtArray = { [CRDT_ARRAY_MARKER]: true, items: {}, metadata: {} };

      // Get all existing items (including deleted) sorted by sortKey
      let existingItems = [];
      if (existingNode && existingNode[CRDT_ARRAY_MARKER]) {
        existingItems = Object.values(existingNode.items).sort(
          (a, b) => a.sortKey - b.sortKey || (a.id < b.id ? -1 : 1),
        );
        Object.assign(crdtArray.metadata, existingNode.metadata);
      }

      let sortKey = 1;
      const usedIds = new Set();

      // Step 1: Process new items, trying to match with existing ones
      for (const [index, itemData] of data.entries()) {
        let matchedItem = null;
        const currentPath = [...path, index];

        // 1. Resolve ID using generator (or fallback to default logic built-in to generator default)
        const generatedId = this.idGenerator(itemData, currentPath);

        // Strategy A: Match by ID
        if (generatedId) {
          matchedItem = existingItems.find((i) => i.id === generatedId);
        }

        // 2. Resolve Sort Key
        const customSortKey = this.sortKeyGenerator(itemData, currentPath);
        const finalSortKey =
          customSortKey !== null && customSortKey !== undefined ? customSortKey : sortKey;

        if (matchedItem) {
          usedIds.add(matchedItem.id);

          if (matchedItem.updated > timestamp) {
            // Local item is newer. Preserve its data and deleted status, but update sortKey.
            crdtArray.items[matchedItem.id] = {
              ...matchedItem,
              sortKey: finalSortKey,
            };
          } else {
            // Incoming update is newer. Overwrite (resurrect if deleted).
            crdtArray.items[matchedItem.id] = {
              id: matchedItem.id,
              data: this._plainToCrdt(itemData, timestamp, matchedItem.data, currentPath),
              sortKey: finalSortKey,
              updated: timestamp,
              _deleted: false,
            };
          }
        } else {
          // No match found. Create new item.
          let itemId = generatedId; // Guaranteed to be string or null if generated
          if (!itemId) {
            itemId = this._generateId();
          }

          crdtArray.items[itemId] = {
            id: itemId,
            data: this._plainToCrdt(itemData, timestamp, null, currentPath),
            sortKey: finalSortKey,
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

    if (typeof data === "object" && data !== null) {
      // Create Wrapped Object Structure:
      // { data: { ...usersFields }, metadata: { ...systemFields } }
      // This strict separation prevents user keys from colliding with system metadata.
      // CRITICAL: We enforce strict {data, metadata} structure for objects. 
      // Unlike "plain" JSON, we never store user keys directly on the node to ensure metadata fields
      // (like _ts) are never overwritten by user data with the same name.

      const wrapper = { data: {}, metadata: { _ts: timestamp } };
      const existingMeta = existingNode && existingNode.metadata ? existingNode.metadata : {};
      const existingData = existingNode && existingNode.data ? existingNode.data : {};

      Object.assign(wrapper.metadata, existingMeta);
      // Ensure _ts is updated to current timestamp if we are refreshing the object
      wrapper.metadata._ts = timestamp;

      for (const key in data) {
        const existingChild = existingData[key] || null;


        // Resolve existing metadata, handling default _ts
        let meta = existingMeta[key];
        if (!meta && existingChild && existingMeta._ts) {
          meta = { updated: existingMeta._ts, _deleted: false };
        }

        if (meta && meta.updated > timestamp) {
          // Local is newer. Keep local value.
          wrapper.data[key] = existingChild;
          wrapper.metadata[key] = meta;
        } else {
          // Incoming is newer.
          wrapper.data[key] = this._plainToCrdt(data[key], timestamp, existingChild, [...path, key]);
          wrapper.metadata[key] = { updated: timestamp, _deleted: false };
        }
      }

      if (existingNode) {
        for (const key in existingData) {
          if (!(key in data)) {
            let meta = existingMeta[key];
            if (!meta && existingMeta._ts) {
              meta = { updated: existingMeta._ts, _deleted: false };
            }

            if (meta && meta.updated > timestamp) {
              // Local is newer (and present). Keep it.
              wrapper.data[key] = existingData[key];
              wrapper.metadata[key] = meta;
            } else {
              // Incoming (missing) is newer. Delete it.
              wrapper.data[key] = existingData[key];
              wrapper.metadata[key] = { updated: timestamp, _deleted: true };
            }
          }
        }
      }

      return wrapper;
    }

    // Primitive value: return as is.
    return data;
  }

  _crdtToPlain(data, includeMetadata = false) {
    if (typeof data === "object" && data !== null) {
      if (data[CRDT_ARRAY_MARKER]) {
        return this._getSortedItems(data).map((item) => {
          const plain = this._crdtToPlain(item.data, includeMetadata);
          if (includeMetadata && typeof plain === "object" && plain !== null) {
            plain._id = item.id;
            plain._sortKey = item.sortKey;
            plain._updated = item.updated;
            plain._deleted = item._deleted;
          }
          return plain;
        });
      }

      // Check for Wrapped Object Structure
      let source = data;
      let metaSource = data.metadata;

      if (data.data && typeof data.data === "object" && !data.sortKey) {
        source = data.data;
        metaSource = data.metadata;
      }

      const newObject = {};

      if (includeMetadata && metaSource && metaSource._ts) {
        newObject._updated = metaSource._ts;
      }

      for (const key in source) {
        if (metaSource && metaSource[key] && metaSource[key]._deleted) {
          continue;
        }

        newObject[key] = this._crdtToPlain(source[key], includeMetadata);

        if (includeMetadata && metaSource && metaSource[key]) {
          if (typeof newObject[key] === "object" && newObject[key] !== null) {
            newObject[key]._updated = metaSource[key].updated;
          }
        }
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
      .filter((item) => !item._deleted)
      .sort((a, b) => a.sortKey - b.sortKey || (a.id < b.id ? -1 : 1));
  }

  _traverse(path) {
    let parent = null;
    let current = this.root;
    let finalKey = null;

    for (const segment of path) {
      let container = current;
      if (container && container.hasOwnProperty("data") && container.hasOwnProperty("sortKey")) {
        container = container.data;
      }

      parent = container;
      finalKey = segment;
      if (container === null || typeof container !== "object") {
        return null;
      }

      if (container[CRDT_ARRAY_MARKER]) {
        if (typeof segment === "number") {
          // Index-based access
          const sorted = this._getSortedItems(container);
          if (segment < 0 || segment >= sorted.length) {
            return null;
          }
          current = container.items[sorted[segment].id];
        } else if (typeof segment === "string" && container.items[segment]) {
          // ID-based access
          current = container.items[segment];
        } else {
          return null;
        }
      } else {
        // Object Traversal
        // Ensure container is a Wrapped Object
        // If it's not a wrapper (missing data, or has sortKey meaning it's an array item), we abort.
        // This enforces strict schema adherence: objects MUST be wrapped.
        if (!container.data || container.sortKey) {
          return null;
        }
        const source = container.data;

        if (!Object.hasOwn(source, segment)) {
          return null;
        }
        current = source[segment];
      }
    }
    return { parent, key: finalKey, node: current };
  }

  _resolveItemId(path) {
    let current = this.root;
    let lastItemId = null;

    for (const segment of path) {
      if (current && current[CRDT_ARRAY_MARKER]) {
        const sorted = this._getSortedItems(current);
        if (typeof segment === "number" && segment >= 0 && segment < sorted.length) {
          const item = sorted[segment];
          lastItemId = item.id;
          current = current.items[lastItemId];
        } else {
          return lastItemId;
        }
      } else if (current && typeof current === "object") {
        if (current.data && current.sortKey) current = current.data; // Array Item
        if (current.data && !current.sortKey && !current[CRDT_ARRAY_MARKER]) current = current.data; // Object Wrapper

        if (Object.hasOwn(current, segment)) {
          current = current[segment];
        } else {
          return lastItemId;
        }
      } else {
        return lastItemId;
      }
    }
    return lastItemId;
  }

  _applyAndStore(op) {
    op.clientId = this.clientId;

    if (op.type === "UPDATE_ITEM") {
      // Resolve Target ID for pruning
      if (!op.itemId) {
        op.itemId = this._resolveItemId(op.path);
      }

      // 1. Redundant Update Check
      const currentRes = this._traverse(op.path);
      if (currentRes && currentRes.node) {
        let nodeToCompare = currentRes.node;
        if (nodeToCompare && nodeToCompare.data && nodeToCompare.sortKey) {
          nodeToCompare = nodeToCompare.data;
        }

        // This might be expensive for large objects, but good for primitives/small objects.
        const currentPlain = this._crdtToPlain(nodeToCompare);
        if (JSON.stringify(currentPlain) === JSON.stringify(op.data)) {
          return; // Redundant update
        }
      }

      // 2. Update Compression (Existing)
      const lastOp = this.ops.length > 0 ? this.ops.at(-1) : null;
      if (
        lastOp &&
        lastOp.type === "UPDATE_ITEM" &&
        JSON.stringify(lastOp.path) === JSON.stringify(op.path)
      ) {
        lastOp.data = op.data;
        lastOp.timestamp = op.timestamp;
        this.applyOp(op);
        return;
      }
    }

    if (op.type === "DELETE_ITEM") {
      // 3. Delete Pruning
      const targetItemId = op.itemId; // For array items
      const targetPathStr = JSON.stringify(op.path); // For object keys

      const retainedOps = [];
      let skippedAdd = false;

      for (const pendingOp of this.ops) {
        let isTarget = false;

        // Check by ID if available
        if (targetItemId && pendingOp.itemId === targetItemId) {
          isTarget = true;
        } else if (
          !targetItemId &&
          !pendingOp.itemId &&
          JSON.stringify(pendingOp.path) === targetPathStr
        ) {
          isTarget = true;
        }

        if (isTarget) {
          if (pendingOp.type === "ADD_ITEM") {
            skippedAdd = true;
          }
          // Prune
        } else {
          retainedOps.push(pendingOp);
        }
      }

      this.ops = retainedOps;

      if (skippedAdd) {
        this.applyOp(op);
        return;
      }
    }

    this.applyOp(op);
    this.ops.push(op);

    if (this.clientId === "server") {
      this.commitOps();
    }
  }

  _getSnapshotData() {
    return this.root;
  }

  // --- Public View Functions ---

  // --- Public View Functions ---

  /**
   * Retrieves the plain JSON representation of the document.
   * @param {string[]} path - Optional path to subtree.
   * @param {Object} options - Options object.
   * @param {boolean} options.includeMetadata - If true, injects _id, _sortKey, etc.
   */
  getData(pathOrOptions, options = {}) {
    let path = [];
    let opts = options;

    // Support overloaded arguments: getData(options) or getData(path, options)
    if (Array.isArray(pathOrOptions)) {
      path = pathOrOptions;
    } else if (typeof pathOrOptions === "object" && pathOrOptions !== null) {
      opts = pathOrOptions;
    }

    if (!path || path.length === 0) {
      return this._crdtToPlain(this.root, opts.includeMetadata);
    }

    const result = this._traverse(path);
    if (!result) {
      return undefined;
    }

    let nodeToConvert = result.node;
    if (
      nodeToConvert &&
      nodeToConvert.hasOwnProperty("sortKey") &&
      nodeToConvert.hasOwnProperty("data")
    ) {
      nodeToConvert = nodeToConvert.data;
    }

    return this._crdtToPlain(nodeToConvert, opts.includeMetadata);
  }

  /**
   * Finds the path to a node with a specific ID (for array items) or key.
   * Performs a DFS search.
   */
  findPath(targetId) {
    return this._findPathRecursive(targetId, [], this.root);
  }

  findPathIn(subPath, targetId) {
    const result = this._traverse(subPath);
    if (!result || !result.node) {
      return null;
    }
    return this._findPathRecursive(targetId, subPath, result.node);
  }

  _findPathRecursive(targetId, currentPath = [], currentNode = this.root) {
    if (!currentNode) {
      return null;
    }

    // Unwrap array item wrapper
    let actualNode = currentNode;
    if (currentNode.hasOwnProperty("data") && currentNode.hasOwnProperty("sortKey")) {
      if (currentNode.id === targetId) {
        return currentPath;
      }

      actualNode = currentNode.data;
    }

    if (typeof actualNode !== "object") {
      return null;
    }

    if (actualNode[CRDT_ARRAY_MARKER]) {
      const sorted = this._getSortedItems(actualNode);
      for (const [i, item] of sorted.entries()) {
        if (item.id === targetId) {
          return [...currentPath, i];
        }

        const res = this._findPathRecursive(targetId, [...currentPath, i], item);
        if (res) {
          return res;
        }
      }
    } else {
      const source = (actualNode.data && !actualNode.sortKey) ? actualNode.data : actualNode;
      for (const key in source) {
        if (key === "metadata") {
          continue;
        }

        if (actualNode.metadata && actualNode.metadata[key] && actualNode.metadata[key]._deleted) {
          continue;
        }

        if (key === targetId) {
          return [...currentPath, key];
        }

        const res = this._findPathRecursive(targetId, [...currentPath, key], source[key]);
        if (res) {
          return res;
        }
      }
    }

    return null;
  }

  // --- Operation Generators (Public API) ---

  /**
   * Adds or updates an item in a CRDT List (Array).
   * 
   * @param {string[]} path - Path to the ITEM itself (e.g. ['foo', 'items', 'item_id']). 
   *                          NOTE: This method automatically slices the last segment off to get the parent Array path.
   * @param {Object} data - The content of the item.
   * @param {number|null} sortKey - Optional fractional index for ordering.
   * @param {string|null} itemId - Optional specific ID. If provided, it overrides the ID in the path.
   */
  upsertItemWithSortKey(path, data, sortKey, itemId) {
    // We infer the array path by dropping the last segment (the item ID/Key).
    const parentPath = path.slice(0, -1);

    // 1. Resolve Parent Array
    const result = this._traverse(parentPath);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) {
      throw new Error(`Target for upsert is not an array: ${JSON.stringify(parentPath)}`);
    }

    const items = result.node.items;
    let targetId = itemId;

    if (!targetId && this.idGenerator) {
      targetId = this.idGenerator(data);
    }

    if (!targetId) {
      throw new Error("Cannot upsert item without an ID");
    }

    // 2. Check if Item Exists
    if (targetId in items && !items[targetId]._deleted) {
      const existingItem = items[targetId];

      const sortKeyMatches = (sortKey === undefined || sortKey === null) || (existingItem.sortKey === sortKey);

      if (sortKeyMatches) {
        // Smart Update: Diff the data against the existing item's data
        const itemPath = [...parentPath, targetId];
        this._generateDiffOps(itemPath, data, existingItem);
        return;
      }
    }

    // Fallback: Full Replace / Add
    this._applyAndStore({
      type: "ADD_ITEM",
      path: parentPath,
      data: data,
      itemId: targetId,
      sortKey: sortKey,
      timestamp: this._tick(),
    });
  }

  addItem(path, data, itemId = null) {
    const parentPath = path.slice(0, -1);
    const keyOrIndex = path.at(-1);

    if (typeof keyOrIndex === "string") {
      this.updateItem(path, data);
      return;
    }

    if (typeof keyOrIndex !== "number") {
      throw new TypeError("Final path segment for addItem must be an index or a key.");
    }

    const index = keyOrIndex;


    const result = this._traverse(parentPath);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) {
      throw new Error("Target for addItem is not an array.");
    }

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (index > sortedItems.length) {
      throw new Error("Index out of bounds.");
    }

    const previousItem = sortedItems[index - 1] || null;
    const nextItem = sortedItems[index] || null;
    const previousKey = previousItem ? previousItem.sortKey : null;
    const nextKey = nextItem ? nextItem.sortKey : null;

    const newSortKey = this._generateSortKey(previousKey, nextKey);

    let newItemId = itemId;
    if (!newItemId && this.idGenerator) {
      newItemId = this.idGenerator(data, [...parentPath, index]);
    }

    if (!newItemId) {
      newItemId = this._generateId();
    }

    this._applyAndStore({
      type: "ADD_ITEM",
      path: parentPath,
      itemId: newItemId,
      data,
      sortKey: newSortKey,
      timestamp: this._tick(),
    });
  }

  moveItem(path, fromIndex, toIndex) {
    const result = this._traverse(path);
    if (!result || !result.node || !result.node[CRDT_ARRAY_MARKER]) {
      throw new Error("Target for moveItem is not an array.");
    }

    const targetArray = result.node;
    const sortedItems = this._getSortedItems(targetArray);

    if (fromIndex < 0 || fromIndex >= sortedItems.length) {
      throw new Error("fromIndex out of bounds");
    }

    if (toIndex < 0 || toIndex > sortedItems.length) {
      throw new Error("toIndex out of bounds");
    }

    if (fromIndex === toIndex) {
      return;
    }

    const itemToMove = sortedItems[fromIndex];

    // Calculate new sort key based on the position in the list excluding the moved item.
    let previousKey = null;
    let nextKey = null;

    if (toIndex === 0) {
      nextKey = sortedItems[0].sortKey;
    } else if (toIndex === sortedItems.length) {
      previousKey = sortedItems.at(-1).sortKey;
    } else {
      const listWithoutItem = sortedItems.filter((i) => i.id !== itemToMove.id);
      const actualToIndex = Math.min(toIndex, listWithoutItem.length);

      previousKey = listWithoutItem[actualToIndex - 1].sortKey;
      const nItem = listWithoutItem[actualToIndex];
      nextKey = nItem ? nItem.sortKey : null;
    }

    const newSortKey = this._generateSortKey(previousKey, nextKey);

    this._applyAndStore({
      type: "MOVE_ITEM",
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

    const { parent, key, node } = result;
    const op = { type: "DELETE_ITEM", path, timestamp: this._tick() };

    if (parent[CRDT_ARRAY_MARKER]) {
      op.itemId = node.id;
    }

    this._applyAndStore(op);
  }

  updateItem(path, newData) {
    const p = path || [];
    this._applyAndStore({
      type: "UPDATE_ITEM",
      path: p,
      data: newData,
      timestamp: this._tick(),
    });
  }

  /**
   * Granularly updates a subtree by diffing new data against existing state.
   * Generates minimal operations (UPDATE/DELETE) for changed fields.
   */
  diffUpdate(path, newData) {
    const p = path || [];
    const result = this._traverse(p);
    // If target doesn't exist, fall back to standard update (create)
    if (!result || !result.node) {
      this.updateItem(p, newData);
      return;
    }

    const startClock = this.clock;
    // We rely on _tick() to handle timestamps naturally for each operation.

    this._generateDiffOps(p, newData, result.node);
  }

  _generateDiffOps(path, data, node) {
    // 1. Unwrap CRDT node wrapper if present
    let current = node;
    if (current && typeof current === "object" && current.data && current.sortKey) {
      current = current.data;
    }

    // 2. Handle Primitives / Type Mismatches / Arrays (Fallback)
    // If data is not object, or node is not object, or array mismatch:
    // Full replace necessary for that specific leaf.
    const isDataObj = typeof data === "object" && data !== null && !Array.isArray(data);
    const isNodeObj = typeof current === "object" && current !== null && !Array.isArray(current) && !current[CRDT_ARRAY_MARKER];

    if (!isDataObj || !isNodeObj) {
      // Simple equality check to avoid redundant leaf update
      const currentPlain = this._crdtToPlain(current);
      if (JSON.stringify(currentPlain) !== JSON.stringify(data)) {
        this.updateItem(path, data);
      }
      return;
    }

    // 3. Object Diffing
    // Determine source keys and metadata
    let source = current;
    // Unwrap Array Item first to get ObjectWrapper
    if (current && typeof current === "object" && current.data && current.sortKey) {
      source = current.data;
    }

    // Unwrap if it is an Object Wrapper (has data, no sortKey)
    // to access the inner user data for diffing.
    let innerData = source;
    if (source && source.data && !source.sortKey && !source[CRDT_ARRAY_MARKER]) {
      innerData = source.data;
    }

    // A. Recursively Check Properties in Data
    for (const key in data) {
      const subPath = [...path, key];
      if (key in innerData && !this._isDeleted(source, key)) { // Check deletion on Wrapper
        // Exists: Recurse
        this._generateDiffOps(subPath, data[key], innerData[key]);
      } else {
        // New Property: Update (Create)
        this.updateItem(subPath, data[key]);
      }
    }

    // B. Check for Deletions (Keys in Node but not in Data)
    for (const key in innerData) {
      if (key === "metadata") continue;
      if (this._isDeleted(source, key)) continue;

      if (!(key in data)) {
        // Delete Property
        this.deleteItem([...path, key]);
      }
    }
  }

  _isDeleted(node, key) {
    return node.metadata && node.metadata[key] && node.metadata[key]._deleted;
  }

  prune(pruneFn, clientRequestData) {
    if (pruneFn) {
      pruneFn(this, clientRequestData);
    }

    if (this.history.length < HISTORY_PRUNE_LIMIT) {
      return;
    }

    // Tombstone TTL strategy: purge tombstones older than the history window.
    const minTimestamp = this.clock - HISTORY_PRUNE_WINDOW;
    this.purgeTombstones(this.root, minTimestamp);

    this.snapshot = this._getSnapshotData();
    this.snapshotDvv = new Map(this.dvv);
    this.history = this.history.slice(-HISTORY_PRUNE_WINDOW);
  }

  /**
   * Garbage Collection: Permanently remove items marked as deleted.
   * WARNING: Can cause desyncs if clients reference purged items.
   */
  purgeTombstones(node = this.root, minTimestamp = 0) {
    if (typeof node !== "object" || node === null) {
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
      const source = (node.data && !node.sortKey) ? node.data : node;
      for (const key in source) {
        if (key === "metadata") {
          continue;
        }

        if (node.metadata && node.metadata[key] && node.metadata[key]._deleted) {
          if (node.metadata[key].updated < minTimestamp) {
            delete source[key];
            delete node.metadata[key];
          }
        } else {
          this.purgeTombstones(source[key], minTimestamp);
        }
      }
    }
  }

  clear() {
    this.root = { data: {}, metadata: {} };
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

    const traversePath = op.type === "MOVE_ITEM" ? op.path : op.path.slice(0, -1);
    const { parent, node } = this._traverse(traversePath) || {};

    switch (op.type) {
      case "ADD_ITEM": {
        const targetArray = this._traverse(op.path)?.node;
        if (!targetArray || !targetArray[CRDT_ARRAY_MARKER]) {
          break;
        }

        let item = targetArray.items[op.itemId];
        item ||= targetArray.items[op.itemId] = { id: op.itemId };

        if (!item.updated || op.timestamp >= item.updated) {
          const itemPath = [...op.path, op.itemId];
          item.data = this._plainToCrdt(op.data, op.timestamp, item.data, itemPath);
          item.sortKey = op.sortKey;
          item.updated = op.timestamp;
          item._deleted = false;
        }

        break;
      }

      case "MOVE_ITEM": {
        const moveArray = this._traverse(op.path)?.node;
        if (!moveArray || !moveArray[CRDT_ARRAY_MARKER]) {
          break;
        }

        const itemToMove = moveArray.items[op.itemId];
        if (!itemToMove) {
          break;
        }

        // LWW on the sortKey specifically.
        if (op.timestamp >= (itemToMove.updated || 0)) {
          itemToMove.sortKey = op.sortKey;
          itemToMove.updated = op.timestamp;
        }

        break;
      }

      case "DELETE_ITEM": {
        const parentPath = op.path.slice(0, -1);
        const parentRes = this._traverse(parentPath);

        if (!parentRes || !parentRes.node) {
          break;
        }

        const container = parentRes.node;
        let targetMeta = null;

        if (container[CRDT_ARRAY_MARKER]) {
          if (op.itemId && container.items[op.itemId]) {
            targetMeta = container.items[op.itemId];
          }
        } else {
          const key = op.path.at(-1);
          // Object Wrapper: Metadata is in container.metadata
          // Ensure metadata container exists
          container.metadata ||= {};

          // Logic for Wrapped Object
          let targetUpdated = 0;
          if (container.metadata[key]) {
            targetUpdated = container.metadata[key].updated;
          }

          if (op.timestamp > targetUpdated) {
            container.metadata[key] = { updated: op.timestamp, _deleted: true };
          }
        }

        if (targetMeta && op.timestamp > (targetMeta.updated || 0)) {
          targetMeta._deleted = true;
          targetMeta.updated = op.timestamp;
        }

        break;
      }

      case "UPDATE_ITEM": {
        if (op.path.length === 0) {
          this.root = this._plainToCrdt(op.data, op.timestamp, this.root);
          break;
        }

        const updateRes = this._traverse(op.path);
        if (updateRes && updateRes.parent) {

          const { parent, key, node } = updateRes;

          let itemUpdated = 0;
          if (parent[CRDT_ARRAY_MARKER]) {
            itemUpdated = node ? node.updated : 0;
          } else {
            // Object Wrapper
            if (parent.metadata && parent.metadata[key]) {
              itemUpdated = parent.metadata[key].updated;
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
            // Wrapped Object Write
            if (!parent.data && !parent.sortKey) parent.data = {}; // Init data if missing

            // Update the key in .data
            parent.data[key] = this._plainToCrdt(op.data, op.timestamp, parent.data[key], op.path);
            parent.metadata ||= {};
            parent.metadata[key] = { updated: op.timestamp, _deleted: false };
          }
        } else if (op.path.length > 0) {
          // Create path (upsert)
          let current = this.root;
          for (let i = 0; i < op.path.length - 1; i++) {
            const segment = op.path[i];

            // Traversal Logic matching _traverse (unwrapping)
            let container = current;
            if (
              container &&
              container.hasOwnProperty("data") &&
              container.hasOwnProperty("sortKey")
            ) {
              container = container.data;
            }
            // Unwrap Object Wrapper for traversal DOWN
            // But we need to CREATE if missing.
            // If container is Object Wrapper, we look in container.data
            // If container.data[segment] missing, create it.

            // Unwrap Object Wrapper for traversal DOWN.
            // If container is Object Wrapper, we look in container.data.
            // If container.data[segment] missing, create it.

            // Standardizing Object Wrapper unwrap:
            if (container.data && !container.sortKey && !container[CRDT_ARRAY_MARKER]) {
              container = container.data;
            }

            // Now container is the storage object (Inner Data).
            // We need to check segment.
            if (
              !Object.hasOwn(container, segment) ||
              typeof container[segment] !== "object" ||
              container[segment] === null
            ) {
              // Create NEW NODE.
              // Must be Wrapped Object!
              // Create NEW NODE as a Wrapped Object.
              container[segment] = { data: {}, metadata: { _ts: op.timestamp } };
            }

            // Advance
            current = container[segment];
          }

          // Final Upsert
          const finalKey = op.path.at(-1);

          let parentContainer = current;

          // Unwrap Object Wrapper
          // If we encounter a populated wrapper, unwrap it (ONLY if it's an array item wrapper that holds an object wrapper inside?)
          // No, wait. 
          // Structural hierarchy:
          // 1. Array Item Wrapper: { data: {ObjectWrapper}, sortKey:..., id:... }  -> Unwrap to data (ObjectWrapper)
          // 2. Object Wrapper: { data: {...}, metadata: {...} } -> DO NOT UNWRAP. We write 'into' it.

          if (parentContainer.hasOwnProperty("data") && parentContainer.hasOwnProperty("sortKey")) {
            parentContainer = parentContainer.data;
          }

          // Unwrap Object Wrapper to access data container for write.

          if (typeof parentContainer !== "object" || parentContainer === null) {
            break;
          }

          // Ensure structure
          // If parentContainer is Object Wrapper
          if (parentContainer.data && !parentContainer.sortKey && !parentContainer[CRDT_ARRAY_MARKER]) {
            parentContainer.data[finalKey] = this._plainToCrdt(op.data, op.timestamp, parentContainer.data[finalKey]);
            parentContainer.metadata ||= {};
            parentContainer.metadata[finalKey] = { updated: op.timestamp, _deleted: false };
          }
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
      clientId: options.clientId || (state && state.clientId ? state.clientId : undefined),
    });
    if (!state) {
      return doc;
    }

    doc.root = state.root || state.snapshot || {};
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
      if (ts > maxTs) {
        maxTs = ts;
      }
    }

    doc.clock = maxTs;

    return doc;
  }

  static loadOrInit(stateString, syncRequest, defaultJson, options = {}) {
    const options_ = { ...options, clientId: "server" };
    if (stateString) {
      return CollabJSON.fromJSON(JSON.parse(stateString), options_);
    }

    if (syncRequest && syncRequest.snapshot) {
      return CollabJSON.fromSnapshot(
        syncRequest.snapshot,
        syncRequest.snapshotDvv,
        syncRequest.docId,
        options_,
      );
    }

    return new CollabJSON(defaultJson, {
      ...options_,
      id: syncRequest ? syncRequest.docId : undefined,
    });
  }

  static fromOps(ops) {
    const doc = new CollabJSON("{}");
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
    const newOps = this.ops.filter((op) => op.timestamp > lastSeenBySystem);
    this.checked = Date.now();

    const request = {
      dvv: Object.fromEntries(this.dvv),
      ops: newOps,
      clientId: this.clientId,
      docId: this.id,
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
    this.ops = this.ops.filter((op) => op.timestamp > (this.dvv.get(this.clientId) || 0));
    this.synced = Date.now();
  }

  replaceData(jsonString) {
    const data = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;

    // Advance clock to invalidate previous states
    this._tick();

    this.root = this._plainToCrdt(data, this.clock);

    this.history = [];
    this.ops = [];

    // Reset DVV as authority
    this.dvv.clear();
    this.dvv.set(this.clientId, this.clock);

    this.snapshot = this.root;
    this.snapshotDvv = new Map(this.dvv);

    this.checked = Date.now();
    this.synced = Date.now();
  }

  getSyncResponse(syncRequest) {
    const { dvv: clientDvv, ops: clientOps, clientId, docId } = syncRequest;

    if (this.id && docId && this.id !== docId) {
      return this.getResetResponse();
    }

    const clientDvvMap = new Map(Object.entries(clientDvv));

    // Check for history gap
    if (this.snapshot) {
      let needsReset = false;
      for (const [cId, ts] of this.snapshotDvv.entries()) {
        if ((clientDvvMap.get(cId) || 0) < ts) {
          needsReset = true;
          break;
        }
      }

      if (needsReset) {
        return this.getResetResponse();
      }
    }

    for (const op of clientOps) {
      this.applyOp(op);
      this.history.push(op);
    }

    const maxTs = clientOps.reduce(
      (max, op) => (op.clientId === clientId ? Math.max(max, op.timestamp) : max),
      0,
    );
    if (maxTs > 0) {
      this.dvv.set(clientId, Math.max(this.dvv.get(clientId) || 0, maxTs));
    }

    const opsForClient = this.history.filter((op) => {
      if (op.clientId === clientId) {
        return false;
      }

      return (clientDvvMap.get(op.clientId) || 0) < op.timestamp;
    });
    return { ops: opsForClient, dvv: Object.fromEntries(this.dvv) };
  }

}
