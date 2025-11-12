import { readable, writable, get } from "svelte/store";
import { browser } from '$app/environment';
import { CollabJSON } from "./_crdt.js";
import {
  compare_date,
  merge_items,
  merge_day,
  merge_history_limit,
  merge_history,
  make_today,
  make_favorites,
  make_history,
  make_historical_day,
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

  const { subscribe, set: svelteSet, update: svelteUpdate } = writable(storedValue);

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

  if (browser) {
    if (isDirty) {
      syncToServer();
    }
    const intervalId = setInterval(syncToServer, SYNC_INTERVAL);
  }

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
  return await sync_internal(today.items, "today");
}

async function sync_favorites(favorites) {
  return await sync_internal(favorites.items, "favorites");
}

export async function sync_history(history) {
  return await sync_internal(history.items, "history");
}

function collab_from_json(parsed) {
    if (parsed && parsed.items) {
        parsed.items = CollabJSON.fromJSON(parsed.items);
    }
    return parsed;
}

export const today_store = synced_store("today", make_today(), sync_today, collab_from_json);
export const favorites_store = synced_store("favorites", make_favorites(), sync_favorites, collab_from_json);
export const history_store = synced_store("history", make_history(), sync_history, collab_from_json);

export function add_item(item, today, edit, profile) {
  if (edit != undefined) {
    if (Date.now() - edit.start_edit > 10 * 60 * 1000) {
      // 10 min.
      edit_store.set(undefined);
      edit = undefined;
    } else {
      edit.start_edit = Date.now();
    }
  }
  let store = edit != undefined ? edit_store : today_store;
  if (edit == undefined) {
    today = check_for_new_day(today, profile);
  }
  store.update(function (day) {
    if (day == undefined) day = make_today();
    for (let i of day.items) {
      if (i.name == item.name) {
        if (i.del == undefined) return day;
        delete i.del;
        i.updated = Date.now();
        if (edit == undefined) {
          sync_today(today, profile, true);
        }
        save_history(day, profile, true);
        return day;
      }
    }
    item = { ...item };
    item.updated = Date.now();
    delete item.del;
    if (item.servings == undefined) item.servings = 1.0;
    day = { ...day };
    day.items.push(item);
    day.updated = Date.now();
    if (edit == undefined) {
      sync_today(today, profile, true);
    }
    save_history(day, profile, true);
    return day;
  });
}

export function save_history(day, profile) {
  if (day == undefined) return;
  var h = { updated: day.updated, items: [day, make_historical_day(day, 1)] };
  history_store.update(function (history) {
    let new_history = merge_history(history, h);
    if (new_history.updated != history.updated) {
      sync_history(new_history, profile, true);
      return new_history;
    }
    return history;
  });
}

export function save_today(today, profile) {
  today_store.set(today);
  sync_today(today, profile, true);
  save_history(today, profile);
}

export function save_favorite(item, profile, replace_index) {
  favorites_store.update(function (favorites) {
    if (favorites == undefined) favorites = make_favorites();
    item = { ...item };
    item.updated = Date.now();
    favorites.updated = item.updated;
    if (replace_index != undefined) {
      if (replace_index >= favorites.items.length) {
        console.log("bad replace_index", replace_index);
        return favorites;
      }
      favorites.items.splice(replace_index, 1, item);
      return favorites;
    }
    for (let i in favorites.items) {
      if (favorites.items[i].name == item.name) {
        favorites.items.splice(i, 1, item);
        sync_favorites(favorites, profile, true);
        return favorites;
      }
    }
    if (item.servings == undefined) item.servings = 1.0;
    favorites.items.push(item);
    sync_favorites(favorites, profile, true);
    return favorites;
  });
}

export function check_for_new_day(t, profile) {
  let new_day = make_today();
  if (t.year == undefined || compare_date(t, new_day) < 0) {
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

