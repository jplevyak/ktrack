import {
    check_for_new_day,
    today_store,
    history_store,
    add_item,
} from "./_stores_test_adapter.js";
import { CollabJSON } from "./_crdt.js";
import { make_today, make_history, make_profile } from "./_util_test_adapter.js";
import assert from "assert";

// --- Mock Global Environment for node ---
// Note: _stores_test_adapter already handles generic browser/storage mocking
// but we need to mock 'fetch' for the sync loop.

const serverDocs = {
    today: new CollabJSON("{}"),
    history: new CollabJSON("[]"),
    favorites: new CollabJSON("[]"),
};

// Reset server docs between tests?
function resetServer() {
    serverDocs.today = new CollabJSON("{}", { clientId: "server" });
    serverDocs.history = new CollabJSON("[]", { clientId: "server" });
    serverDocs.favorites = new CollabJSON("[]", { clientId: "server" });
}

global.fetch = async (url, options) => {
    const parts = url.split("/");
    const endpoint = parts[parts.length - 1]; // 'today', 'history', etc.

    if (endpoint !== "today" && endpoint !== "history" && endpoint !== "favorites") {
        if (endpoint === "profile") return { ok: true, json: async () => ({ value: { authenticated: true } }) };
        return { ok: false, status: 404 };
    }

    const body = JSON.parse(options.body);
    const serverDoc = serverDocs[endpoint];

    if (!serverDoc) return { ok: true, json: async () => ({}) };

    const response = serverDoc.getSyncResponse(body);
    serverDoc.applySyncResponse(response); // Apply implicit changes if any? No, getSyncResponse applies?
    // Actually, getSyncResponse DOES NOT apply changes to the serverDoc automatically in all implementations,
    // but CollabJSON implementation usually just calculates diffs.
    // Wait, looking at _crdt.js: getSyncResponse(req) ...
    // It computes 'ops' to send back.
    // Using: serverDoc is likely updated via 'upload' or receives ops?
    // The Protocol:
    // Client sends: { version: ..., ops: [ ...newOps ] } (SyncRequest)
    // Server should:
    // 1. Apply newOps to serverDoc.
    // 2. Return new ops from serverDoc that client hasn't seen.

    // Let's check _crdt.js logic if we can.
    // Assuming standard sync:
    if (body.ops) {
        for (const op of body.ops) {
            serverDoc.applyOp(op);
        }
    }

    // Now generate response
    const responsePayload = serverDoc.getSyncResponse(body);

    return {
        ok: true,
        json: async () => responsePayload,
    };
};

global.localStorage = {
    getItem: () => null,
    setItem: () => { },
};

// --- Test Utilities ---

function createClientDocs(clientId) {
    const today = make_today();
    today.clientId = clientId;
    const history = make_history();
    history.clientId = clientId;
    return { today, history };
}

function setStoreState(today, history) {
    today_store.set(today);
    history_store.set(history);
}

// Ensure the stores are "connected" (sync triggered by set) but we rely on manual sync calls or the interval.
// The adapter runs sync on interval and debounce. We might want to force sync.

async function forceSyncAll() {
    await today_store.sync();
    await history_store.sync();
}

// --- Tests ---

async function runTest() {
    console.log("Starting test: check_for_new_day with two clients");
    resetServer();

    // 1. Setup Clients
    // Start with "old" day. Jan 1 1970.
    const OLD_DATE = "1970-01-01-4"; // Thursday

    const c1 = createClientDocs("client1");
    // Manually set date to old date
    c1.today.updateItem(["timestamp"], OLD_DATE);
    c1.today.commitOps(); // Ensure it's committed so it's not "floating"

    const c2 = createClientDocs("client2");
    c2.today.updateItem(["timestamp"], OLD_DATE);
    c2.today.commitOps();

    const profile = make_profile();
    profile.authenticated = true;

    // --- Client 1 Routine ---
    console.log("--- Client 1 Routine ---");
    setStoreState(c1.today, c1.history);

    // Verify initial state
    assert.strictEqual(c1.today.getData().timestamp, OLD_DATE);

    // Call check_for_new_day
    // This should detect old date, create new today, save old to history.
    console.log("Client 1 checking for new day...");
    check_for_new_day(c1.today, profile);

    // Store is async updated? check_for_new_day calls save_today -> store.set
    // Wait a tick for debounce? Or just check references inside store?
    // today_store.set updates the referenced CollabJSON object? No, it sets a NEW CollabJSON object.
    // So c1.today reference might be stale if we don't grab it from store.

    // Update c1 ref
    let c1_today_new = get_store_value(today_store);
    let c1_history_new = get_store_value(history_store);

    assert.notStrictEqual(c1_today_new.getData().timestamp, OLD_DATE, "Client 1 should have new date");
    const newDate = c1_today_new.getData().timestamp;
    console.log(`Client 1 new date: ${newDate}`);

    // Add item as Client 1
    console.log("Client 1 seeking to add item...");
    add_item({ name: "Apple", id: "apple1", servings: 1 }, c1_today_new, undefined, profile);
    // Note: add_item calls store.update, so we need to fetch fresh ref again
    c1_today_new = get_store_value(today_store);

    assert.strictEqual(c1_today_new.getData().items.length, 1);
    assert.strictEqual(c1_today_new.getData().items[0].name, "Apple");

    // Sync Client 1
    console.log("Client 1 syncing...");
    await forceSyncAll();

    // Verify Server State
    console.log("Verifying Server State after C1 sync...");
    assert.strictEqual(serverDocs.today.getData().timestamp, newDate, "Server should have new date");
    assert.strictEqual(serverDocs.today.getData().items.length, 1, "Server should have Apple");

    // --- Client 2 Routine ---
    console.log("--- Client 2 Routine ---");
    // Restore C2 state (still in 1970)
    setStoreState(c2.today, c2.history);

    // Verify C2 is old
    const c2_val_initial = get_store_value(today_store);
    assert.strictEqual(c2_val_initial.getData().timestamp, OLD_DATE);

    // Call check_for_new_day
    console.log("Client 2 checking for new day...");
    check_for_new_day(c2_val_initial, profile);

    /*
       CRITICAL MOMENT:
       C2 generates a NEW day locally. It matches C1's new day only by coincidence of Wall Clock Time (make_today uses Date.now).
       But they are DIFFERENT CollabJSON objects with DIFFERENT IDs?
       _util.js make_today():
         doc = new CollabJSON("{}") -> generates random ID.
         updateItem(["timestamp"], y-m-d...)
         updateItem(["items"], [])

       So C1 and C2 generate different 'today' docs (different UUIDs).
       Phase 1: C2 syncs.
       Server receives C2's new doc.
       Server logic in `prune_today` (on real server) handles overwriting if timestamp is newer.
       But here, timestamp is SAME as Server's current (C1's) timestamp.
       So Server might just Merge?
       If IDs are different, merge might be messy.
       Real application logic relies on `prune_today` or Single Active Today.
       Wait, `check_for_new_day` logic:
         if (!get_date_info(t) || compare_date(t, new_day) < 0) {
            save_history(t);
            save_today(new_day); // Sets local store to new_day
         }
       Then sync happens.
       If Server has "Doc A (Today)" and Client 2 sends "Doc B (Today)".
       They conflict.
       The "today" endpoint usually assumes a singleton or LWW on the root?
       CollabJSON merge logic: if two docs have different IDs, they don't merge well unless structured same?
       CollabJSON structure: root = { timestamp: ..., items: ... }
       If Doc A and Doc B have different internal IDs, `applySyncResponse` might fail or behavior is undefined if they aren't clones.
       BUT: `synced_store` initializes with `make_today`, which makes a random ID doc.
       So every client starts with different ID?
       NO. `synced_store` loads from IndexedDB (persisted ID).
       If new browser, starts fresh (random ID).
       When it syncs to server:
       If Server has doc with ID S.
       Client has doc with ID C.
       Client sends ops for C.
       Server has history for S.
       This is a fundamental CRDT issue if not handled.
       Usually, the first sync aligns the IDs or one overwrites the other.
       In `_crdt.js`, `applySyncResponse` / `getSyncResponse` rely on common ancestry?
       `_crdt.js`:
         constructor(..., options) { this.id = options.id || uuidv4(); }
       If IDs differ, they are distinct documents.
       `sync_today` -> `sync_internal` uses `doc.getSyncRequest()`.
       Server receives it.
       If Server Doc UUID != Client Doc UUID:
       The tests in `_test_crdt.js` usually share `id: docId`.
       Reference `_test_crdt` line 312: `const server = new CollabJSON("{}", { clientId: "server", id: docId });`

       ISSUE: `make_today` does NOT specify a fixed ID.
       So Client 1 and Client 2 generate different IDs.
       How does the app handle this?
       Maybe `prune_today` (server side) resets the document?
       `_util.js`: `prune_today(server_doc, clientSyncRequest)`
       "If server has no date, or client's date is newer... server_doc.clear()".
       This suggests server resets to accept the new day.
       BUT `clear()` keeps the same `id`?
       `CollabJSON.clear()`: `this.root = {}; ...`
       It does NOT change `this.id`.
       So Server keeps `ServerID`.
       Client 1 sends ops (for Client1ID).
       If `ServerID` != `Client1ID`, ops might apply if they are path-based?
       `applyOp` validates ID? No. `applyOp` uses `path`.
       So as long as structure matches, it works?
       Yes, `CollabJSON` is path-based. The Document ID is mostly for identifying the "Doc" context, but `applyOp` doesn't check "is this op for DocID X?".
       So merging DIFFERENT documents works as long as paths align.
    */

    let c2_today_new = get_store_value(today_store);

    // Add item as Client 2
    console.log("Client 2 seeking to add item...");
    add_item({ name: "Banana", id: "banana1", servings: 1 }, c2_today_new, undefined, profile);
    c2_today_new = get_store_value(today_store);

    assert.strictEqual(c2_today_new.getData().items.length, 1);
    assert.strictEqual(c2_today_new.getData().items[0].name, "Banana");

    // Sync Client 2
    console.log("Client 2 syncing...");
    await forceSyncAll();

    // Verify Server State
    // Should have BOTH Apple (from C1) and Banana (from C2)
    // Because C2 synced `timestamp` (same as C1's or updated LWW?).
    // Paths: ["items", 0]
    // C1 added Apple at index 0.
    // C2 added Banana at index 0.
    // Conflict!
    // `add_item` uses `addItem`.
    // `addItem` generates fractional index.
    // If both start empty, both add at index 0?
    // `_stores.js` `add_item`:
    // `day.addItem(["items", data.items.length], ...)`
    // If length is 0, add at 0.
    // CRDT resolution: one will sort after another.
    // But they will both exist.
    console.log("Verifying Server State after C2 sync...");
    const serverData = serverDocs.today.getData();
    console.log("Server Items:", JSON.stringify(serverData.items, null, 2));
    assert.strictEqual(serverData.items.length, 2, "Server should have 2 items");

    // --- Final Sync for Consistency ---
    console.log("--- Final Sync for Client 1 ---");
    // Switch back to C1
    setStoreState(c1_today_new, c1_history_new);
    await forceSyncAll();

    c1_today_new = get_store_value(today_store);
    console.log("Client 1 Items:", JSON.stringify(c1_today_new.getData().items, null, 2));

    assert.strictEqual(c1_today_new.getData().items.length, 2, "Client 1 should see 2 items");

    console.log("✅ TEST PASSED");
}

function get_store_value(store) {
    let val;
    store.subscribe(v => val = v)();
    return val;
}

runTest().catch(e => {
    console.error("TEST FAILED", e);
    process.exit(1);
});
