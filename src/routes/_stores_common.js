import { CollabJSON } from "./_crdt.js";
import {
    merge_history_limit,
    make_today,
    make_favorites,
    make_history,
    make_profile,
    get_date_info,
    compare_date,
} from "./_util_common.js";

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

export function createSyncedStore(key, initialValue, sync, fromJSON, deps) {
    const { writable, get, browser, dbGet, dbSet, online } = deps;
    const SYNC_INTERVAL = 2000;
    const DEBOUNCE_WAIT = 500;

    let isDirty = false;
    const status = writable("loading");

    const {
        subscribe,
        set: svelteSet,
        update: svelteUpdate,
    } = writable(initialValue, () => {
        if (!browser) return;

        const intervalId = setInterval(syncToServer, SYNC_INTERVAL);
        return () => clearInterval(intervalId);
    });

    if (browser) {
        dbGet(key).then((record) => {
            if (record) {
                try {
                    const parsed = record.data;
                    const value = fromJSON ? fromJSON(parsed) : parsed;
                    svelteSet(value);
                    isDirty = record.dirty || false;
                    status.set(isDirty ? "dirty" : "idle");

                    syncToServer(true);
                } catch (e) {
                    console.error(`Error parsing ${key} from IndexedDB`, e);
                    status.set("error");
                }
            } else {
                status.set("idle");
                syncToServer(true);
            }
        });
    }

    async function syncToServer(force = false) {
        const isOnline = get(online);
        if (!browser || (!isDirty && !force) || !isOnline) {
            if (isDirty && !isOnline) {
                status.set("error");
            }
            return;
        }

        status.set("syncing");

        try {
            const currentValue = get({ subscribe });

            if (fromJSON && !(currentValue instanceof CollabJSON)) {
                console.error(`Store ${key} corrupted before sync: expected CollabJSON`, currentValue);
                return;
            }

            const ok = await sync(currentValue);

            if (!ok) throw new Error("Server sync failed");

            if (fromJSON && !(currentValue instanceof CollabJSON)) {
                console.error(`Store ${key} corrupted after sync: expected CollabJSON`, currentValue);
                return;
            }

            svelteSet(currentValue);

            if (browser) {
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
            const serialized = fromJSON ? newValue.toJSON() : newValue;
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

export function add_item_logic(item, today, edit, profile, stores) {
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

        day.addItem(["items", data.items.length], { ...item, id: item.name });

        if (edit == undefined) {
            save_history_logic(day, profile, stores);
        }
        return day;
    });
}

export function save_history_logic(day, profile, stores) {
    const { history_store } = stores;
    if (day == undefined) return;
    history_store.update(function (history) {
        if (history == undefined) history = make_history();
        let day_data = day.getData();

        const tsKey = day_data.timestamp
            ? parseInt(day_data.timestamp.split("-").slice(0, 3).join(""))
            : 0;
        const sortKey = -tsKey;

        history.upsertItemWithSortKey(
            ["items"],
            {
                ...day_data,
                id: day_data.timestamp,
            },
            sortKey,
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

export async function save_profile_logic(profile, sync_profile, stores) {
    const { profile_store } = stores;
    profile_store.set(profile);
    await sync_profile(profile);
}

export function save_today_logic(today, profile, stores) {
    const { today_store } = stores;
    today_store.set(today);
    save_history_logic(today, profile, stores);
}

export function save_favorite_logic(item, profile, replace_index, stores) {
    const { favorites_store } = stores;
    favorites_store.update(function (favorites) {
        if (favorites == undefined) favorites = make_favorites();

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

export function check_for_new_day_logic(t, profile, stores) {
    let new_day = make_today();
    if (!t) {
        save_today_logic(new_day, profile, stores);
        save_history_logic(new_day, profile, stores);
        return new_day;
    }

    if (!get_date_info(t) || compare_date(t, new_day) < 0) {
        save_history_logic(t, profile, stores);
        save_today_logic(new_day, profile, stores);
        save_history_logic(new_day, profile, stores);
    }
    return t;
}

export function logout_logic(stores) {
    const { profile_store, today_store, favorites_store, history_store } = stores;
    profile_store.set(make_profile());
    today_store.set(make_today());
    favorites_store.set(make_favorites());
    history_store.set(make_history());
}
