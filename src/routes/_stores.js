import { readable, writable, get } from "svelte/store";
import { browser } from '$app/environment';
import { CollabJSON } from "./_crdt.js";
import {
  compare_date,
  get_date_info,
  merge_history_limit,
  make_today,
  make_favorites,
  make_history,
  make_profile,
  date_key,
} from "./_util.js";

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

export function synced_store(key, initialValue, sync, fromJSON) {
  const SYNC_INTERVAL = 1000 * 60 * 5; // 5 minutes
  const DEBOUNCE_WAIT = 2000; // 2 seconds

  const dirtyKey = `${key}:dirty`;

  let storedValue = initialValue;
  let isDirty = false;

  if (browser) {
    const fromStorage = localStorage.getItem(key);
    if (fromStorage) {
      const parsed = JSON.parse(fromStorage);
      storedValue = fromJSON ? fromJSON(parsed) : parsed;
    }
    isDirty = localStorage.getItem(dirtyKey) === 'true';
  }

  const status = writable(isDirty ? 'dirty' : 'idle');

  let intervalId;
  const { subscribe, set: svelteSet, update: svelteUpdate } = writable(storedValue, () => {
    if (!browser) return;
    // Start function (on first subscriber)
    if (isDirty) syncToServer();
    intervalId = setInterval(syncToServer, SYNC_INTERVAL);
    // Stop function (on last unsubscriber)
    return () => clearInterval(intervalId);
  });

  async function syncToServer() {
    if (!browser || !isDirty || !get(online)) {
      if (isDirty && !get(online)) {
        status.set('error');
      }
      return;
    }

    console.log('Syncing to server...');
    status.set('syncing');

    try {
      const currentValue = get({ subscribe });
      const ok = await sync(currentValue);

      if (!ok) throw new Error('Server sync failed');

      svelteSet(currentValue); // Notify Svelte of mutated value

      isDirty = false;
      if (browser) localStorage.setItem(dirtyKey, 'false');
      status.set('idle');
      console.log('Sync successful');

    } catch (error) {
      console.error(error.message);
      status.set('error');
    }
  }

  const debouncedSync = debounce(syncToServer, DEBOUNCE_WAIT);

  const set = (newValue) => {
    if (browser) {
      localStorage.setItem(key, JSON.stringify(newValue));
      localStorage.setItem(dirtyKey, 'true');
    }
    isDirty = true;
    status.set('dirty');
    svelteSet(newValue);
    debouncedSync();
  };

  const update = (updater) => {
    set(updater(get({ subscribe })));
  };

  return {
    subscribe,
    set,
    update,
    status: {
      subscribe: status.subscribe
    }
  };
}

export async function sync_profile(profile) {
  if (profile.password == "") {
    profile_store.set(make_profile());
    console.log("logout");
    return;
  }
  let data = {
    username: profile.username,
    password: profile.password,
    value: profile,
  };
  try {
    const response = await fetch('/api/profile', {
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
        localStorage.setItem('profile', JSON.stringify(profile));
        return false;
      }
      let p = data.value;
      profile.message = p.message;
      profile.authenticated = p.authenticated;
      if (p.authenticated) {
        profile.old_password = "";
      }
      localStorage.setItem('profile', JSON.stringify(profile));
    } catch (err) {
      console.log("JSON error", err.message);
      localStorage.setItem('profile', JSON.stringify(profile));
      return false;
    }
  } catch (err) {
    console.log("POST error", err.message);
    localStorage.setItem('profile', JSON.stringify(profile));
    return false;
  }
  return true;
}

export const online = readable(browser ? navigator.onLine : true, (set) => {
  if (!browser) return;

  const updateOnlineStatus = () => set(navigator.onLine);

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  return () => {
    window.removeEventListener('online', updateOnlineStatus);
    window.removeEventListener('offline', updateOnlineStatus);
  };
});

function local_writable(key, initialValue) {
    let storedValue = initialValue;
    if (browser) {
        const fromStorage = localStorage.getItem(key);
        if (fromStorage && fromStorage !== 'undefined') {
            try {
                storedValue = JSON.parse(fromStorage);
            } catch(e) {
                console.error(`Could not parse stored value for ${key}`, e);
            }
        }
    }

    const { subscribe, set, update } = writable(storedValue);

    return {
        subscribe,
        set: (value) => {
            if (browser) {
                localStorage.setItem(key, JSON.stringify(value));
            }
            set(value);
        },
        update: (fn) => {
            update(currentValue => {
                const newValue = fn(currentValue);
                if (browser) {
                    localStorage.setItem(key, JSON.stringify(newValue));
                }
                return newValue;
            });
        }
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
    const response = await fetch('/api/' + name, {
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
    return CollabJSON.fromJSON(parsed);
}

export const today_store = synced_store("today", make_today(), sync_today, collab_from_json);
export const favorites_store = synced_store("favorites", make_favorites(), sync_favorites, collab_from_json);
export const history_store = synced_store("history", make_history(), sync_history, collab_from_json);

export function add_item(item, today, edit, profile) {
  if (edit != undefined) {
    let edit_data = edit.toData();
    if (Date.now() - edit_data.start_edit > 10 * 60 * 1000) { // 10 min.
      edit_store.set(undefined);
      edit = undefined;
    } else {
      edit.updateItem(edit.findPath('start_edit'), Date.now());
      edit_store.set(edit);
    }
  }
  let store = edit != undefined ? edit_store : today_store;
  if (edit == undefined) {
    today = check_for_new_day(today, profile);
  }
  store.update(function (day) {
    if (day == undefined)
      day = make_today();

    const data = day.getData();
    const existing_index = data.findIndex(i => i.name == item.name);
    if (existing_index !== -1) {
      return day;
    }

    item = { ...item };
    if (item.servings == undefined)
      item.servings = 1.0;
    day.addItem([data.length], item);

    if (edit == undefined) {
      save_history(day, profile);
    }
    return day;
  });
}

export function save_history(day, profile) {
  if (day == undefined) return;
  history_store.update(function (history) {
    if (history == undefined)
      history = make_history();

    const day_docs = Array.from(history.items.values())
      .filter(item => !item._deleted)
      .sort((a, b) => a.sortKey - b.sortKey)
      .map(item => item.data);

    const key = date_key(day);
    const existing_index = day_docs.findIndex(d => d && date_key(d) === key);

    console.log('existing index', existing_index);
    if (existing_index !== -1) {
      history.updateItem([existing_index], day.getData());
    } else {
      const insert_index = day_docs.findIndex(d => d && date_key(d) < key);
      history.addItem([insert_index === -1 ? day_docs.length : insert_index], day.getData());
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

export function save_today(today, profile) {
  console.log('save2', today);
  today_store.set(today);
  save_history(today, profile);
}

export function save_favorite(item, profile, replace_index) {
  favorites_store.update(function (favorites) {
    if (favorites == undefined)
      favorites = make_favorites();
    
    item = { ...item };

    if (replace_index != undefined) {
      if (replace_index >= favorites.getData().length) {
        console.log("bad replace_index", replace_index);
        return favorites;
      }
      favorites.updateItem([replace_index], item);
      return favorites;
    }
    
    const items_array = favorites.getData();
    const existing_index = items_array.findIndex(i => i.name == item.name);

    if (existing_index !== -1) {
      favorites.updateItem([existing_index], item);
    } else {
      if (item.servings == undefined) item.servings = 1.0;
      favorites.addItem([items_array.length], item);
    }
    
    return favorites;
  });
}

export function check_for_new_day(t, profile) {
  let new_day = make_today();
  // Use get_date_info as the document no longer has date properties directly.
  if (!t || !get_date_info(t) || compare_date(t, new_day) < 0) {
    save_today(new_day, profile);
    return new_day;
  }
  return t;
}

export function logout() {
  profile_store.set(make_profile());
  today_store.set(make_today());
  favorites_store.set(make_favorites());
  history_store.set(make_history());
}

