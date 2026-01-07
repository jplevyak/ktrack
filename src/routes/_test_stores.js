
import { add_item } from "./_stores_common.js";
import { make_today } from "./_util.js";
import assert from "assert";

// --- Test Runner ---
let tests = [];
let failures = 0;

function test(description, fn) {
  tests.push({ description, fn });
}

async function runTests() {
  console.log("Running Store tests...");
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✅ ${t.description}`);
    } catch (error) {
      console.error(`❌ ${t.description}`);
      console.error(error);
      failures++;
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

// --- Tests ---

test("add_item does not inject 'id' field", () => {
  // 1. Setup 'today' doc
  const today = make_today();

  // 2. Mock 'today_store'
  const today_store = {
    update: (fn) => {
      fn(today);
    }
  };

  const stores = {
    today_store,
    edit_store: { set: () => { } },
    history_store: { update: () => { } }
  };

  // CLEAN INPUT (No redundant ID)
  const item = { name: "Apple", servings: 1 };

  // 4. Call add_item
  add_item(item, today, undefined, {}, stores);

  // 5. Verify data
  const data = today.getData();
  const addedItem = data.items[0];

  assert.strictEqual(addedItem.name, "Apple");
  assert.strictEqual(addedItem.servings, 1);
  assert.strictEqual(addedItem.id, undefined, "Item should not have 'id' property");

  // 6. Verify System ID (via metadata)
  const dataWithMeta = today.getData({ includeMetadata: true });
  assert.strictEqual(dataWithMeta.items[0]._id, "Apple");
});


runTests();
