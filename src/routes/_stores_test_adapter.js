import { readable, writable, get } from "./_test_svelte_mocks.js";
const browser = true;

import { CollabJSON } from "./_crdt.js";
import { v4 as uuidv4 } from "uuid";
import {
    make_today,
    make_favorites,
    make_history,
    make_profile,
} from "./_util_test_adapter.js";
import {
    createSyncedStore,
    add_item_logic,
    save_history_logic,
    save_profile_logic,
    save_today_logic,
    save_favorite_logic,
    check_for_new_day_logic,
    logout_logic,
} from "./_stores_common.js";

// --- IndexedDB Helper ---
const DB_NAME = "KTrackDB";
const DB_VERSION = 1;

function openDB() {
    if (!browser) return Promise.reject("Not in browser");
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            resolve({
                transaction: () => ({
                    objectStore: () => ({
                        get: () => ({ onsuccess: () => { }, onerror: () => { } }),
                        put: () => ({ onsuccess: () => { }, onerror: () => { } }),
                    })
                }),
                objectStoreNames: { contains: () => true }
            });
            return;
        }

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

const mockStore = new Map();
async function dbGet(key) {
    if (typeof indexedDB === 'undefined') return mockStore.get(key);
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
    if (typeof indexedDB === 'undefined') {
        mockStore.set(key, value);
        return;
    }
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
    if (typeof localStorage !== 'undefined') {
        globalClientId = localStorage.getItem("ktrack_client_id");
        if (!globalClientId) {
            globalClientId = uuidv4();
            localStorage.setItem("ktrack_client_id", globalClientId);
        }
    } else {
        globalClientId = uuidv4();
    }
} else {
    globalClientId = uuidv4();
}
// ------------------------

const initialOnline = (typeof navigator !== 'undefined' && typeof navigator.onLine !== 'undefined') ? navigator.onLine : true;
export const online = readable(browser ? initialOnline : true, (set) => {
    if (!browser) return;
    if (typeof window === 'undefined') return;

    const updateOnlineStatus = () => set(navigator.onLine);

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
        window.removeEventListener("online", updateOnlineStatus);
        window.removeEventListener("offline", updateOnlineStatus);
    };
});

function local_writable(key, initialValue) {
    let storedValue = initialValue;
    if (browser) {
        if (typeof localStorage !== 'undefined') {
            const fromStorage = localStorage.getItem(key);
            if (fromStorage && fromStorage !== "undefined") {
                try {
                    storedValue = JSON.parse(fromStorage);
                } catch (e) {
                    console.error(`Could not parse stored value for ${key}`, e);
                }
            }
        }
    }

    const { subscribe, set, update } = writable(storedValue);

    return {
        subscribe,
        set: (value) => {
            if (browser) {
                if (typeof localStorage !== 'undefined') {
                    try {
                        localStorage.setItem(key, JSON.stringify(value));
                    } catch (e) {
                        console.error("localStorage quota exceeded for local_writable", e);
                    }
                }
            }
            set(value);
        },
        update: (fn) => {
            update((currentValue) => {
                const newValue = fn(currentValue);
                if (browser) {
                    if (typeof localStorage !== 'undefined') {
                        try {
                            localStorage.setItem(key, JSON.stringify(newValue));
                        } catch (e) {
                            console.error("localStorage quota exceeded for local_writable", e);
                        }
                    }
                }
                return newValue;
            });
        },
    };
}

export function synced_store(key, initialValue, sync, fromJSON) {
    return createSyncedStore(key, initialValue, sync, fromJSON, {
        writable,
        get,
        browser,
        dbGet,
        dbSet,
        online,
    });
}

export const index_store = writable(undefined);
export const edit_store = local_writable("edit", undefined);

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
                return false;
            }
            let p = data.value;
            profile.message = p.message;
            profile.authenticated = p.authenticated;
            if (p.authenticated) {
                profile.old_password = "";
                if (today_store && today_store.sync) today_store.sync();
                if (favorites_store && favorites_store.sync) favorites_store.sync();
                if (history_store && history_store.sync) history_store.sync();
            }
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

export const profile_store = synced_store("profile", make_profile(), sync_profile);

async function sync_internal(doc, name) {
    if (!(doc instanceof CollabJSON)) {
        console.error(`Sync object for "${name}" is not a CollabJSON document. Aborting sync.`);
        return false;
    }
    const profile = get(profile_store);
    if (profile == undefined/* || !profile.authenticated*/) {
        // return false;
    }

    const syncRequest = doc.getSyncRequest();
    const data = {
        username: profile ? profile.username : 'test',
        password: profile ? profile.password : 'test',
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
    if (!parsed) return null;
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

const stores = {
    today_store,
    favorites_store,
    history_store,
    edit_store,
    profile_store,
};

export function add_item(item, today, edit, profile) {
    return add_item_logic(item, today, edit, profile, stores);
}

export function save_history(day, profile) {
    return save_history_logic(day, profile, stores);
}

export async function save_profile(profile) {
    return save_profile_logic(profile, sync_profile, stores);
}

export function save_today(today, profile) {
    return save_today_logic(today, profile, stores);
}

export function save_favorite(item, profile, replace_index) {
    return save_favorite_logic(item, profile, replace_index, stores);
}

export function check_for_new_day(t, profile) {
    return check_for_new_day_logic(t, profile, stores);
}

export function logout() {
    return logout_logic(stores);
}
