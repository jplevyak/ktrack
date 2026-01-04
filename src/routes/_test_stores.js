import {
    check_for_new_day,
    today_store,
    history_store,
    add_item,
    syncManager
} from "./_stores_test_adapter.js";
import { CollabJSON } from "./_crdt.js";
import { make_today, make_history, make_profile } from "./_util_test_adapter.js";
import assert from "assert";

// --- Mock Global Environment for node ---

const serverDocs = {
    today: new CollabJSON("{}"),
    history: new CollabJSON("[]"),
    favorites: new CollabJSON("[]"),
};

// Reset server docs between tests
function resetServer() {
    serverDocs.today = new CollabJSON("{}", { clientId: "server" });
    serverDocs.history = new CollabJSON("[]", { clientId: "server" });
    serverDocs.favorites = new CollabJSON("[]", { clientId: "server" });
}

global.fetch = async (url, options) => {
    const parts = url.split("/");
    const endpoint = parts[parts.length - 1];

    if (url.includes("/api/sync")) {
        // console.log("[MockFetch] Processing batch sync...");
        const body = JSON.parse(options.body);
        const responses = {};

        if (body.requests) {
            // console.log(`[MockFetch] Batch contains ${Object.keys(body.requests).length} requests`);
            for (const [key, req] of Object.entries(body.requests)) {
                const serverDoc = serverDocs[key];
                if (serverDoc) {
                    if (req.ops) {
                        // console.log(`[MockFetch] Applying ${req.ops.length} ops to ${key}`);
                        for (const op of req.ops) {
                            serverDoc.applyOp(op);
                        }
                    }
                    responses[key] = serverDoc.getSyncResponse(req);
                }
            }
        }

        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(responses),
        });
    }

    if (endpoint === "profile") {
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ value: { authenticated: true, message: "ok" } }),
        });
    }

    if (endpoint !== "today" && endpoint !== "history" && endpoint !== "favorites") {
        return { ok: false, status: 404 };
    }

    // Fallback for individual syncs if any (though we are moving away)
    const serverDoc = serverDocs[endpoint];
    const body = JSON.parse(options.body);

    if (!serverDoc) return { ok: true, json: async () => ({}) };

    if (body.ops) {
        for (const op of body.ops) {
            serverDoc.applyOp(op);
        }
    }

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
async function forceSyncAll() {
    await syncManager.syncAll(true);
}

function get_store_value(store) {
    let val;
    store.subscribe(v => val = v)();
    return val;
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
       But they are DIFFERENT CollabJSON objects with DIFFERENT IDs.
       ... (Assuming Server handles merge or we accept behavior for now)
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
    syncManager.stop();
}

runTest().catch(e => {
    console.error("TEST FAILED", e);
    syncManager.stop();
    process.exit(1);
});
