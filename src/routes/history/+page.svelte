<script>
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";
  import Food from "../_food.svelte";
  import { CollabJSON } from "../_crdt.js";

  onMount(() => {
    syncManager.syncIfNeeded();
  });
  import {
    get_date_info,
    weekdays,
    months,
    get_total,
    get_total_fiber,
    compute_averages,
    compare_date,
  } from "../_util.js";
  import {
    today_store,
    history_store,
    profile_store,
    edit_store,
    add_item,
    save_favorite,
    check_for_new_day,
    syncManager,
  } from "../_stores.js";

  let the_date = new Date();
  let profile = undefined;
  let today = undefined;
  let edit = undefined;
  let history = undefined;
  let limit = 30;
  let results = [];
  let added_count = 0;

  const unsubscribe_profile = profile_store.subscribe((p) => {
    profile = p;
  });
  const unsubscribe_today = today_store.subscribe((t) => {
    today = t;
  });
  const unsubscribe_edit = edit_store.subscribe((value) => {
    edit = value;
  });
  const unsubscribe_history = history_store.subscribe((value) => {
    history = value;
  });

  const history_status = history_store.status;

  onDestroy(() => {
    unsubscribe_profile();
    unsubscribe_today();
    unsubscribe_edit();
    unsubscribe_history();
  });

  $: (today, check_for_new_day(today, profile));
  $: results = history.getData().slice(0, limit);

  function do_msg(event) {
    if (event.status == "completed") return;
    let entry = event.detail.entry;
    if (entry < 0 || entry >= results.length) {
      return;
    }
    let day = results[entry];
    if (!day || !day.items) return; // Safety check

    let index = event.detail.index;
    if (index < 0 || index >= day.items.length) {
      return;
    }
    let item = day.items[index];
    if (!item) return; // Safety check

    let change = event.detail.change;
    if (change == "fav") {
      save_favorite(item, profile);
      return;
    }
    if (change > 0) {
      add_item(item, today, edit, profile);
      added_count += 1;
    }
  }

  function edit_day(day) {
    let day_doc = new CollabJSON(JSON.stringify(day));
    if (!today || compare_date(day_doc, today) == 0) {
      edit_store.set(undefined);
      goto("/");
      return;
    }
    day_doc.addItem(["start_edit"], Date.now());
    edit_store.set(day_doc);
    goto("/");
  }
</script>

<svelte:head>
  <title>KTrack - History</title>
</svelte:head>

<div class="history-view">
  <!-- Controls & Stats Header -->
  <div class="card header-card">
    <div class="controls-row flex justify-between items-center">
      <div class="limit-control flex items-center gap-sm">
        <label for="limit" class="mb-0">Days to view:</label>
        <input type="number" id="limit" bind:value={limit} class="limit-input" />
      </div>

      <div class="added-count text-primary font-bold">
        Added: {added_count}
      </div>
    </div>

    <!-- Unsaved Changes Indicator -->
    <div class="status-row mt-sm">
      {#if $history_status && $history_status != "idle"}
        <span class="status-badge">🟡 {$history_status}</span>
      {/if}
    </div>
  </div>

  <!-- History List -->
  <div class="history-list">
    {#each results as day, e}
      {@const day_info = get_date_info(day)}

      <div class="card day-card">
        <div class="day-header">
          <!-- Removed flex classes here to allow block stacking -->
          <div class="flex justify-between items-center mb-sm">
            <h3 class="day-date">
              {weekdays[day_info.day]}, {months[day_info.month]}
              {day_info.date}, {day_info.year}
            </h3>
            <button on:click={() => edit_day(day)} class="btn btn-icon" aria-label="Edit Day">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path
                  d="m15 5 4 4"
                /></svg
              >
            </button>
          </div>

          <!-- Totals Section moved to header -->
          <div
            class="totals-section flex justify-between items-center pt-sm border-t border-border"
          >
            <div class="total-row large">
              <span class="text-primary font-bold">{get_total(day.items).toFixed(2)}</span>
              mcg Vit K
            </div>
            <div class="total-row large">
              {get_total_fiber(day.items)[0].toFixed(2)} g {#if get_total_fiber(day.items)[1]}<span
                  class="text-error"
                >
                  + ?</span
                >{/if} Fiber
            </div>
          </div>
        </div>

        <div class="day-items">
          {#each day.items as f, i}
            <Food
              name={f.name}
              notes={f.notes}
              entry={e}
              index={i}
              mcg={f.mcg}
              fiber={f.fiber}
              unit={f.unit}
              servings={f.servings}
              source={f.source}
              use_add="true"
              use_fav="true"
              hide_details={true}
              on:message={do_msg}
            />
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .history-view {
    padding-bottom: var(--spacing-xl);
  }

  .mb-0 {
    margin-bottom: 0;
  }

  .mt-sm {
    margin-top: var(--spacing-sm);
    min-height: 24px;
  }

  .limit-input {
    width: 80px;
    display: inline-block;
  }

  .status-badge {
    background-color: #fffde7;
    padding: 2px 6px;
    border-radius: 4px;
    color: #fbc02d;
    border: 1px solid #fbc02d;
    font-size: 0.8rem;
    font-weight: 500;
  }

  .day-card {
    border-left: 4px solid var(--color-primary);
  }

  .day-header {
    margin-bottom: var(--spacing-md);
    padding-bottom: var(--spacing-sm);
    border-bottom: 1px solid var(--color-border);
  }

  .pt-sm {
    padding-top: var(--spacing-sm);
  }
  .border-t {
    border-top: 1px solid var(--color-border);
  }

  .total-row.large {
    font-size: 1.15rem; /* Slightly smaller than main page to fit card context */
    font-weight: 500;
  }

  .text-error {
    color: var(--color-error);
  }
</style>
