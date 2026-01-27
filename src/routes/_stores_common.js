import { CollabJSON } from "./_crdt.js";
import {
  merge_history_limit,
  make_today,
  make_favorites,
  make_history,
  make_profile,
  get_date_info,
  compare_date,
} from "./_util.js";

export class SyncManager {
  constructor(syncCallback, debounceWait = 500, syncInterval = 2000) {
    this.stores = new Map();
    this.syncCallback = syncCallback;
    this.debounceWait = debounceWait;
    this.syncInterval = syncInterval;
    this.timeout = null;
    this.interval = null;
    this.pendingSyncs = new Set();
    this.isSyncing = false;
    this.lastSyncTime = 0;
  }

  register(key, storeMethods) {
    this.stores.set(key, storeMethods);
  }

  start() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.syncAll(false), this.syncInterval);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  notifyChange(key) {
    this.pendingSyncs.add(key);
    this.debouncedSync();
  }

  debouncedSync() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.timeout = null;
      this.syncAll(false); // Sync dirty ones, or whatever logic
    }, this.debounceWait);
  }

  syncIfNeeded(minInterval = 1000) {
    if (this.isSyncing) return;
    if (Date.now() - this.lastSyncTime < minInterval) return;
    this.syncAll(true);
  }

  async syncAll(force = false) {
    if (this.isSyncing) return;
    this.isSyncing = true;
    try {
      // Collect requests
      const requests = {};
      const keysToSync = [];

      for (const [key, methods] of this.stores.entries()) {
        // Logic from old syncToServer:
        // if !browser || (!isDirty && !force) || !isOnline -> skip
        // We assume the methods.shouldSync(force) handles this check
        if (methods.shouldSync(force)) {
          const req = methods.getSyncRequest();
          if (req) {
            requests[key] = req;
            keysToSync.push(key);
            methods.setSyncingStatus();
          }
        }
      }

      if (Object.keys(requests).length === 0) return;

      try {
        const responses = await this.syncCallback(requests);
        if (!responses) {
          // Failed completely
          keysToSync.forEach((key) => this.stores.get(key).setStatus("error"));
          return;
        }

        for (const key of keysToSync) {
          const methods = this.stores.get(key);
          const res = responses[key];
          if (res) {
            if (res.err) {
              methods.setStatus("error");
            } else {
              methods.applySyncResponse(res);
              methods.setIdleStatus();
            }
          } else {
            // No response for this key?
            console.error("No response for", key);
            methods.setStatus("error");
          }
        }
        this.lastSyncTime = Date.now();
      } catch (e) {
        console.error("Batch sync error", e);
        keysToSync.forEach((key) => this.stores.get(key).setStatus("error"));
      }
    } finally {
      this.isSyncing = false;
    }
  }
}

let globalSyncManager;

export function createSyncedStore(key, initialValue, sync, fromJSON, deps) {
  const { writable, get, browser, dbGet, dbSet, online, syncManager } = deps;
  // If we want a singleton manager injected, we use that.

  const manager = syncManager;

  let isDirty = false;
  const status = writable("loading");

  const {
    subscribe,
    set: svelteSet,
    update: svelteUpdate,
  } = writable(initialValue, () => {
    if (!browser) return;
    // We rely on the manager's global interval now, or we can ensure it's started
    return () => { };
  });

  // Helper methods for the manager
  const storeMethods = {
    shouldSync: (force) => {
      const isOnline = get(online);
      return browser && (isDirty || force) && isOnline;
    },
    getSyncRequest: () => {
      const val = get({ subscribe });
      if (fromJSON && !(val instanceof CollabJSON)) return null;
      return val.getSyncRequest();
    },
    setSyncingStatus: () => status.set("syncing"),
    setStatus: (s) => status.set(s),
    applySyncResponse: async (res) => {
      const currentValue = get({ subscribe });
      const ok = await sync(currentValue, res); // We might need to adjust 'sync' signature or usage
      // Actually, the old 'sync' function did the fetch. Now the manager does the fetch.
      // We need to inject the applying logic properly.
      // Ideally 'sync' argument to createSyncedStore was 'sync_today' which called 'sync_internal'.
      // 'sync_internal' did fetch then apply.
      // We should break that apart.

      // Let's assume the 'sync' arg is now just "apply this response to the doc".
      // BUT wait, we need to handle the fact that 'sync_internal' handled the fetch.

      // Refactor plan: The 'sync' argument to createSyncedStore is becoming less relevant
      // if the manager handles the fetch.
      // We need the doc to apply the response.
      if (currentValue instanceof CollabJSON) {
        currentValue.applySyncResponse(res);
        svelteSet(currentValue); // Notify
        if (browser) {
          // persist
          const serialized = fromJSON ? currentValue.toJSON() : currentValue;
          await dbSet(key, { data: serialized, dirty: false });
        }
        isDirty = false;
      }
      return true;
    },
    setIdleStatus: () => status.set("idle"),
  };

  if (manager) {
    manager.register(key, storeMethods);
  }

  if (browser) {
    dbGet(key).then((record) => {
      if (record) {
        try {
          const parsed = record.data;
          const value = fromJSON ? fromJSON(parsed) : parsed;
          svelteSet(value);
          isDirty = record.dirty || false;
          status.set(isDirty ? "dirty" : "idle");

          if (manager) manager.notifyChange(key); // Force initial sync check
        } catch (e) {
          console.error(`Error parsing ${key} from IndexedDB`, e);
          status.set("error");
        }
      } else {
        status.set("idle");
        if (manager) manager.notifyChange(key);
      }
    });
  }

  const set = (newValue) => {
    isDirty = true;
    status.set("dirty");
    svelteSet(newValue);

    if (browser) {
      const serialized = fromJSON ? newValue.toJSON() : newValue;
      dbSet(key, { data: serialized, dirty: true });
    }

    if (manager) manager.notifyChange(key);
  };

  const update = (updater) => {
    set(updater(get({ subscribe })));
  };

  return {
    subscribe,
    set,
    update,
    get: () => get({ subscribe }),
    sync: () => {
      if (manager) manager.notifyChange(key);
    }, // Trigger immediate check
    status: {
      subscribe: status.subscribe,
    },
  };
}

export function bindActions(stores, extraDeps = {}) {
  const { sync_profile } = extraDeps;
  return {
    add_item: (item, today, edit, profile) => add_item(item, today, edit, profile, stores),
    save_history: (day, profile) => save_history(day, profile, stores),
    save_profile: (profile) => save_profile(profile, sync_profile, stores),
    save_today: (today, profile) => save_today(today, profile, stores),
    save_favorite: (item, profile, replace_index) =>
      save_favorite(item, profile, replace_index, stores),
    check_for_new_day: (t, profile) => check_for_new_day(t, profile, stores),
    logout: () => logout(stores),
  };
}

export function add_item(item, today, edit, profile, stores) {
  const { today_store, edit_store } = stores;

  if (edit != undefined) {
    let edit_data = edit.getData();
    if (Date.now() - edit_data.start_edit > 10 * 60 * 1000) {
      edit_store.set(undefined);
      edit = undefined;
    } else {
      edit.updateItem(edit.findPath("start_edit"), Date.now());
      edit_store.set(edit);
    }
  } else {
    if (!today) return;
  }
  let store = edit != undefined ? edit_store : today_store;
  store.update(function (day) {
    const data = day.getData();
    const existing_index = data.items.findIndex((i) => i.name == item.name);
    if (existing_index !== -1) {
      return day;
    }

    item = { ...item };
    if (item.servings == undefined) item.servings = 1.0;

    day.addItem(["items", data.items.length], item, item.name);

    if (edit == undefined) {
      save_history(day, profile, stores);
    }
    return day;
  });
}

export function save_history(day, profile, stores) {
  const { history_store } = stores;
  if (day == undefined) return;
  history_store.update(function (history) {
    if (history == undefined) history = make_history();
    let day_data = day.getData();

    if (!day_data.timestamp) {
      console.error("Attempting to save history with invalid timestamp:", day_data);
      return history;
    }

    const current_history = history.getData();
    if (current_history.length > 0) {
      const last_entry = current_history[0];
      if (last_entry.timestamp && day_data.timestamp) {
        const last_date_info = get_date_info(last_entry);
        const current_date_info = get_date_info(day_data);

        // Create dates (months are 0-indexed in Date, but get_date_info handles the -1 correction/check)
        // get_date_info returns: month: parseInt(...) - 1. So it is 0-indexed.
        const last_date = new Date(
          last_date_info.year,
          last_date_info.month,
          last_date_info.date,
        );
        const current_date = new Date(
          current_date_info.year,
          current_date_info.month,
          current_date_info.date,
        );

        let iter_date = new Date(last_date);
        iter_date.setDate(iter_date.getDate() + 1);

        while (iter_date < current_date) {
          const empty_day_doc = make_today(iter_date);
          const empty_day_data = empty_day_doc.getData();

          const tsKey = empty_day_data.timestamp
            ? parseInt(empty_day_data.timestamp.split("-").slice(0, 3).join(""))
            : 0;
          const sortKey = -tsKey;

          history.upsertItemWithSortKey(
            ["items"],
            {
              ...empty_day_data,
            },
            sortKey,
            empty_day_data.timestamp,
          );

          iter_date.setDate(iter_date.getDate() + 1);
        }
      }
    }

    const tsKey = day_data.timestamp
      ? parseInt(day_data.timestamp.split("-").slice(0, 3).join(""))
      : 0;
    const sortKey = -tsKey;

    history.upsertItemWithSortKey(
      ["items"],
      {
        ...day_data,
      },
      sortKey,
      day_data.timestamp
    );

    const limit = merge_history_limit || 50;

    const current_items = history.getData();
    if (current_items.length > limit) {
      for (let i = limit; i < current_items.length; i++) {
        history.deleteItem([limit]);
      }
    }

    return history;
  });
}

export async function save_profile(profile, sync_profile, stores) {
  const { profile_store } = stores;
  profile_store.set(profile);
  await sync_profile(profile);
}

export function save_today(today, profile, stores) {
  const { today_store } = stores;
  today_store.set(today);
  save_history(today, profile, stores);
}

export function save_favorite(item, profile, replace_index, stores) {
  const { favorites_store } = stores;
  favorites_store.update(function (favorites) {
    if (favorites == undefined) favorites = make_favorites();

    item = { ...item };

    const favorites_data = favorites.getData();

    if (replace_index != undefined) {
      if (replace_index >= favorites_data.length) {
        console.log("bad replace_index", replace_index);
        return favorites;
      }
      favorites.updateItem([replace_index], item);
      return favorites;
    }

    const existing_index = favorites_data.findIndex((i) => i.name == item.name);

    if (existing_index !== -1) {
      favorites.updateItem([existing_index], item);
    } else {
      if (item.servings == undefined) item.servings = 1.0;
      favorites.addItem([favorites_data.length], item, item.name);
    }

    return favorites;
  });
}

export function check_for_new_day(t, profile, stores) {
  let new_day = make_today();
  if (!t) {
    save_today(new_day, profile, stores);
    save_history(new_day, profile, stores);
    return new_day;
  }

  if (compare_date(t, new_day) < 0) {
    save_history(t, profile, stores);
    save_today(new_day, profile, stores);
    save_history(new_day, profile, stores);
  } else {
    // START FIX: Ensure current 'today' is in history (Fresh Load Scenario)
    const { history_store } = stores;
    if (history_store && history_store.get) {
      const history = history_store.get();
      // Check if today is already in history to avoid redundant "dirty" updates
      const history_data = history.getData();
      const t_data = t.getData();
      const exists = history_data.some(item => item.timestamp === t_data.timestamp);

      if (!exists) {
        save_history(t, profile, stores);
      }
    }
    // END FIX
  }
  return t;
}

export function logout(stores) {
  const { profile_store, today_store, favorites_store, history_store } = stores;
  profile_store.set(make_profile());
  today_store.set(make_today());
  favorites_store.set(make_favorites());
  history_store.set(make_history());
}
