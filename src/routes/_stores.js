import { readable, writable, get } from "svelte/store";
import { browser } from "$app/environment";
import { CollabJSON } from "./_crdt.js";
import { v4 as uuidv4 } from "uuid";
import {
  compare_date,
  get_date_info,
  merge_history_limit,
  make_today,
  make_favorites,
  make_history,
  make_profile,
} from "./_util.js";

// --- IndexedDB Helper ---
const DB_NAME = "KTrackDB";
const DB_VERSION = 1;

function openDB() {
  if (!browser) return Promise.reject("Not in browser");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("stores")) {
        db.createObjectStore("stores");
      }
    };
  });
}

async function dbGet(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("stores", "readonly");
      const store = transaction.objectStore("stores");
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("DB Get Error", e);
    return undefined;
  }
}

async function dbSet(key, value) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("stores", "readwrite");
      const store = transaction.objectStore("stores");
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("DB Set Error", e);
  }
}
// ------------------------

// --- Global Client ID ---
let globalClientId;
if (browser) {
  globalClientId = localStorage.getItem("ktrack_client_id");
  if (!globalClientId) {
    globalClientId = uuidv4();
    localStorage.setItem("ktrack_client_id", globalClientId);
  }
} else {
  // For SSR, we don't have a persistent ID, but we can generate one or use a placeholder.
  // Since SSR shouldn't be generating ops that persist to the client in this architecture,
  // a random one is acceptable or 'server-render'.
  globalClientId = uuidv4();
}
// ------------------------

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    const callNow = !timeout;

    clearTimeout(timeout);

    timeout = setTimeout(() => {
      timeout = null;
      if (!callNow) func.apply(context, args);
    }, wait);

    if (callNow) func.apply(context, args);
  };
}

export function synced_store(key, initialValue, sync, fromJSON) {
  const SYNC_INTERVAL = 2000;
  const DEBOUNCE_WAIT = 500;

  // We store an object in IDB: { data: serializedData, dirty: boolean }

  let isDirty = false;
  const status = writable("loading"); // Start with loading status

  // Initialize with default value
  const {
    subscribe,
    set: svelteSet,
    update: svelteUpdate,
  } = writable(initialValue, () => {
    if (!browser) return;

    // Setup sync interval
    const intervalId = setInterval(syncToServer, SYNC_INTERVAL);
    return () => clearInterval(intervalId);
  });

  // Load from IndexedDB on initialization
  if (browser) {
    dbGet(key).then((record) => {
      if (record) {
        try {
          // record.data is the JSON object (CollabJSON.toJSON result)
          const parsed = record.data;
          const value = fromJSON ? fromJSON(parsed) : parsed;
          svelteSet(value);
          isDirty = record.dirty || false;
          status.set(isDirty ? "dirty" : "idle");

          // if (isDirty) syncToServer(); // OLD: Only synced if dirty

          // NEW: Always sync on load to get fresh server state (Pull-to-Refresh behavior on reload)
          // Pass force=true to bypass the (!isDirty) check in syncToServer
          syncToServer(true);
        } catch (e) {
          console.error(`Error parsing ${key} from IndexedDB`, e);
          status.set("error");
        }
      } else {
        // No data in DB, use initialValue
        status.set("idle");
        // Also sync on first load/empty DB to populate from server
        syncToServer(true);
      }
    });
  }

  async function syncToServer(force = false) {
    if (!browser || (!isDirty && !force) || !get(online)) {
      if (isDirty && !get(online)) {
        status.set("error"); // Offline but dirty
      }
      return;
    }

    console.log("Syncing to server...", key);
    status.set("syncing");

    try {
      const currentValue = get({ subscribe });

      // Sanity check before sync
      if (fromJSON && !(currentValue instanceof CollabJSON)) {
        console.error(`Store ${key} corrupted before sync: expected CollabJSON`, currentValue);
        return;
      }

      const ok = await sync(currentValue);

      if (!ok) throw new Error("Server sync failed");

      // Sanity check after sync
      if (fromJSON && !(currentValue instanceof CollabJSON)) {
        console.error(`Store ${key} corrupted after sync: expected CollabJSON`, currentValue);
        return;
      }

      // Notify Svelte of mutated value.
      svelteSet(currentValue);

      if (browser) {
        // Save clean state to IDB
        const serialized = fromJSON ? currentValue.toJSON() : currentValue;
        await dbSet(key, { data: serialized, dirty: false });
      }

      isDirty = false;
      status.set("idle");
      console.log("Sync successful", key);
    } catch (error) {
      console.error(error.message);
      status.set("error");
    }
  }

  const debouncedSync = debounce(syncToServer, DEBOUNCE_WAIT);

  const set = (newValue) => {
    isDirty = true;
    status.set("dirty");
    svelteSet(newValue);

    if (browser) {
      // Save dirty state to IDB
      const serialized = fromJSON ? newValue.toJSON() : newValue;
      // We don't await this because set() is synchronous in Svelte contract usually,
      // but IDB is async. It's "fire and forget" for the UI, but ensures persistence.
      dbSet(key, { data: serialized, dirty: true });
    }

    debouncedSync();
  };

  const update = (updater) => {
    set(updater(get({ subscribe })));
  };

  return {
    subscribe,
    set,
    update,
    sync: () => syncToServer(true),
    status: {
      subscribe: status.subscribe,
    },
  };
}

async function sync_profile(profile) {
  if (profile.password == "") {
    return true;
  }
  let data = {
    username: profile.username,
    password: profile.password,
    value: profile,
  };
  try {
    const response = await fetch("/api/profile", {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      console.log("profile not-ok", response.status, response.statusText);
      profile_store.set(profile);
      return false;
    }
    try {
      const data = await response.json();
      if (data.err) {
        console.log("profile err", data.err);
        // Persist error state if needed, though profile_store handles its own persistence via set()
        return false;
      }
      let p = data.value;
      profile.message = p.message;
      profile.authenticated = p.authenticated;
      if (p.authenticated) {
        profile.old_password = "";
        // Force sync of other stores upon successful login
        if (today_store && today_store.sync) today_store.sync();
        if (favorites_store && favorites_store.sync) favorites_store.sync();
        if (history_store && history_store.sync) history_store.sync();
      }
      // profile_store.set will handle IDB persistence
    } catch (err) {
      console.log("JSON error", err.message);
      return false;
    }
  } catch (err) {
    console.log("POST error", err.message);
    return false;
  }
  return true;
}

export const online = readable(browser ? navigator.onLine : true, (set) => {
  if (!browser) return;

  const updateOnlineStatus = () => set(navigator.onLine);

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  return () => {
    window.removeEventListener("online", updateOnlineStatus);
    window.removeEventListener("offline", updateOnlineStatus);
  };
});

function local_writable(key, initialValue) {
  // Keep local_writable using localStorage for small non-critical UI state (like 'edit')
  // or switch to IDB if consistency is desired.
  // 'edit' is transient, so localStorage is probably fine, but let's keep it simple.
  let storedValue = initialValue;
  if (browser) {
    const fromStorage = localStorage.getItem(key);
    if (fromStorage && fromStorage !== "undefined") {
      try {
        storedValue = JSON.parse(fromStorage);
      } catch (e) {
        console.error(`Could not parse stored value for ${key}`, e);
      }
    }
  }

  const { subscribe, set, update } = writable(storedValue);

  return {
    subscribe,
    set: (value) => {
      if (browser) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
          console.error("localStorage quota exceeded for local_writable", e);
        }
      }
      set(value);
    },
    update: (fn) => {
      update((currentValue) => {
        const newValue = fn(currentValue);
        if (browser) {
          try {
            localStorage.setItem(key, JSON.stringify(newValue));
          } catch (e) {
            console.error("localStorage quota exceeded for local_writable", e);
          }
        }
        return newValue;
      });
    },
  };
}

export const index_store = writable(undefined);
export const edit_store = local_writable("edit", undefined);
export const profile_store = synced_store("profile", make_profile(), sync_profile);

async function sync_internal(doc, name) {
  if (!(doc instanceof CollabJSON)) {
    console.error(`Sync object for "${name}" is not a CollabJSON document. Aborting sync.`);
    return false;
  }
  const profile = get(profile_store);
  if (profile == undefined || !profile.authenticated) {
    return false;
  }

  const syncRequest = doc.getSyncRequest();
  const data = {
    username: profile.username,
    password: profile.password,
    ...syncRequest,
  };

  try {
    const response = await fetch("/api/" + name, {
      method: "POST",
      body: JSON.stringify(data),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      console.log("not-ok", name, response.status, response.statusText);
      return false;
    }
    try {
      const sync_response = await response.json();
      if (sync_response.err) {
        console.log("sync err", name, sync_response.err);
        return false;
      }
      doc.applySyncResponse(sync_response);
    } catch (err) {
      console.log(name, "JSON error", err.message);
      return false;
    }
  } catch (err) {
    console.log(name, "POST error", err.message);
    return false;
  }
  return true;
}

async function sync_today(today) {
  return await sync_internal(today, "today");
}

async function sync_favorites(favorites) {
  return await sync_internal(favorites, "favorites");
}

async function sync_history(history) {
  return await sync_internal(history, "history");
}

function collab_from_json(parsed) {
  // Gracefully handle null/undefined if localStorage is empty.
  if (!parsed) return null;
  // Override clientId with global one
  return CollabJSON.fromJSON(parsed, { clientId: globalClientId });
}

function init_store_value(maker) {
  const doc = maker();
  if (doc instanceof CollabJSON && globalClientId) {
    doc.clientId = globalClientId;
  }
  return doc;
}

export const today_store = synced_store(
  "today",
  init_store_value(make_today),
  sync_today,
  collab_from_json,
);
export const favorites_store = synced_store(
  "favorites",
  init_store_value(make_favorites),
  sync_favorites,
  collab_from_json,
);
export const history_store = synced_store(
  "history",
  init_store_value(make_history),
  sync_history,
  collab_from_json,
);

export function add_item(item, today, edit, profile) {
  if (edit != undefined) {
    let edit_data = edit.getData();
    if (Date.now() - edit_data.start_edit > 10 * 60 * 1000) {
      // 10 min.
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

    // Inject ID for deterministic conflict resolution
    day.addItem(["items", data.items.length], { ...item, id: item.name });

    if (edit == undefined) {
      save_history(day, profile);
    }
    return day;
  });
}

export function save_history(day, profile) {
  if (day == undefined) return;
  history_store.update(function (history) {
    if (history == undefined) history = make_history();
    let history_data = history.getData();
    let day_data = day.getData();

    const existing_index = history_data.findIndex((d) => d && d.timestamp === day_data.timestamp);

    if (existing_index !== -1) {
      history.updateItem([existing_index], day_data);
    } else {
      const insert_index = history_data.findIndex((d) => d && d.timestamp < day_data.timestamp);
      history.addItem([insert_index === -1 ? history_data.length : insert_index], {
        ...day_data,
        id: day_data.timestamp,
      });
    }

    const limit = merge_history_limit || 50;
    const current_items = history.getData();
    if (current_items.length > limit) {
      // Prune oldest items if history exceeds limit
      for (let i = limit; i < current_items.length; i++) {
        history.deleteItem([limit]); // Always delete item at `limit` index as list shrinks
      }
    }

    return history;
  });
}

export async function save_profile(profile) {
  profile_store.set(profile);
  await sync_profile(profile);
}

export function save_today(today, profile) {
  today_store.set(today);
  save_history(today, profile);
}

export function save_favorite(item, profile, replace_index) {
  favorites_store.update(function (favorites) {
    if (favorites == undefined) favorites = make_favorites();

    // Inject ID for deterministic conflict resolution
    item = { ...item, id: item.name };

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
      favorites.addItem([favorites_data.length], item);
    }

    return favorites;
  });
}

export function check_for_new_day(t, profile) {
  let new_day = make_today();
  if (!t) {
    save_today(new_day, profile);
    return new_day;
  }

  if (!get_date_info(t) || compare_date(t, new_day) < 0) {
    save_history(t, profile);

    // Mutate existing document to preserve ID and avoid server reset
    const newData = new_day.getData();

    if (newData.timestamp) {
      t.updateItem(["timestamp"], newData.timestamp);
    }

    t.updateItem(["items"], []);

    save_today(t, profile);
  }
  save_history(t, profile);
  return t;
}

export function logout() {
  profile_store.set(make_profile());
  today_store.set(make_today());
  favorites_store.set(make_favorites());
  history_store.set(make_history());
}
