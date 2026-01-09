<script>
  import { goto } from "$app/navigation";
  import { afterUpdate, onDestroy, onMount } from "svelte";
  import Food from "./_food.svelte";

  onMount(() => {
    syncManager.syncIfNeeded();
  });
  import {
    weekdays,
    months,
    get_total,
    get_total_fiber,
    make_today,
    compute_averages,
    get_date_info,
  } from "./_util.js";
  import {
    today_store,
    profile_store,
    history_store,
    edit_store,
    save_today,
    save_favorite,
    save_history,
    check_for_new_day,
    syncManager,
  } from "./_stores.js";

  let total = 0;
  let total_fiber = 0;
  let fiber_unknown = 0;
  let today = undefined;
  let history = undefined;
  let profile = undefined;
  let editing = undefined;
  let editing_index = undefined;
  let resolution = 0.0001;
  let edit = undefined;
  let day = undefined;

  // Access the status store from the custom store object
  const today_status = today_store.status;

  // straddle all small moves.
  let stops = [0.2, 0.25, 0.3, 0.3333333333, 0.4, 0.5, 0.6, 0.6666666666, 0.7, 0.75, 0.8];
  let rstops = [...stops].sort((x, y) => y - x);
  let small_stops = [0.0, 0.015625, 0.03125, 0.0625, 0.1, 0.125, 0.2];
  let rsmall_stops = [...small_stops].sort((x, y) => y - x);

  const unsubscribe_profile = profile_store.subscribe((p) => {
    profile = p;
  });
  const unsubscribe_today = today_store.subscribe((t) => {
    today = t;
  });
  const unsubscribe_history = history_store.subscribe((value) => {
    history = value;
  });

  const unsubscribe_edit = edit_store.subscribe((d) => {
    let edit_data = d ? d.getData() : undefined;
    if (edit_data != undefined && edit_data.start_edit) {
      if (Date.now() - edit_data.start_edit > 10 * 60 * 1000 /* 10 min */) {
        edit_store.set(undefined);
        d = undefined;
      }
    }
    edit = d;
  });
  onDestroy(() => {
    unsubscribe_today();
    unsubscribe_profile();
    unsubscribe_edit();
    unsubscribe_history();
  });

  $: (today, check_for_new_day(today, profile));
  $: day = edit || today;
  $: date_info = day ? get_date_info(day.getData()) : null;
  $: all_items = day ? day.getData().items : [];
  $: food_items = all_items.filter((item) => typeof item.mcg !== "undefined");
  $: total = get_total(all_items);
  $: [total_fiber, fiber_unknown] = get_total_fiber(all_items);
  $: averages =
    history && history.getData ? compute_averages(history.getData()) || [0, 0, 0] : [0, 0, 0];

  function save_day() {
    if (edit == undefined) {
      save_today(day, profile);
    } else {
      edit_store.set(day);
    }
  }

  function cancel_edit() {
    editing = undefined;
  }

  function save_edit() {
    day.updateItem(["items", editing_index], editing);
    save_day();
    editing = undefined;
  }

  function done_edit() {
    save_history(day, profile);
    edit_store.set(undefined);
    goto("/history");
  }

  // Move to p2 if between p1 and p2.
  function fix_change(x, p1, p2) {
    var r = undefined;
    if (p2 > p1) {
      // e.g. p1 = 0.2 p2 = 0.25
      if (x + resolution > p1 && x + resolution < p2) {
        r = p2 - x;
      }
    } else if (x - resolution < p1 && x - resolution > p2) {
      // e.g. p1 = 0.25, p2 = 0.2
      r = p2 - x;
    }
    return r;
  }

  function get_change(servings, change) {
    let fractional_part = servings - Math.floor(servings);
    let s = change > 0 ? stops : rstops;
    if (servings <= 0.2 + resolution) s = change > 0 ? small_stops : rsmall_stops;
    let r;
    for (let i = 0; i < s.length - 1; i++)
      if ((r = fix_change(fractional_part, s[i], s[i + 1]))) return r;
    r = 0.1 * change;
    if (servings + r >= 0) return r;
    return -servings;
  }

  function do_msg(event) {
    if (event.status == "completed" || !day) return;

    const index_in_food_items = event.detail.index;
    if (index_in_food_items < 0 || index_in_food_items >= food_items.length) {
      return;
    }

    const item_data = food_items[index_in_food_items];
    const original_index = all_items.findIndex((item) => item === item_data);
    if (original_index === -1) return;

    let change = event.detail.change;

    if (change == "del") {
      day.deleteItem(["items", original_index]);
      save_day();
    } else if (change == "fav") {
      save_favorite(item_data, profile);
    } else if (change == "edit") {
      editing = { ...item_data };
      editing_index = original_index;
    } else {
      let servings_change = get_change(item_data.servings, change);
      // round to prevent small errors from accumulating.
      let new_servings = parseFloat((item_data.servings + servings_change).toFixed(6));
      day.updateItem(["items", original_index, "servings"], new_servings);
      save_day();
    }
  }
</script>

<svelte:head>
  <title>KTrack - Day</title>
</svelte:head>

<div class="day-view">
  <!-- Header Section -->
  <div class="header-section border-b-2 border-black pb-1 mb-2">
    <div class="flex justify-between items-baseline">
      <h2 class="current-date m-0 text-lg">
        {#if date_info}
          {weekdays[date_info.day].toUpperCase()}
          {months[date_info.month].toUpperCase()}
          {date_info.date}
        {/if}
        {#if $today_status && $today_status != "idle"}
          <span class="text-sm"> [{$today_status}]</span>
        {/if}
      </h2>
      {#if edit != undefined}
        <div class="edit-warning">
          <span class="text-error font-bold">EDITING</span>
          <button type="button" class="btn btn-primary btn-sm" on:click={done_edit}>DONE</button>
        </div>
      {/if}
    </div>

    <div class="text-sm mt-1">
      <div class="mb-xs">
        <strong>Averages (3/5/7 days):</strong> [{(averages[0] || 0).toFixed(1)} / {(
          averages[1] || 0
        ).toFixed(1)} / {(averages[2] || 0).toFixed(1)}]
      </div>
      <div class="text-lg flex justify-between items-center">
        <div>
          <span class="text-primary font-bold">{total.toFixed(1)}</span> mcg Vit K
        </div>
        <div>
          {total_fiber.toFixed(2)} g {#if fiber_unknown}<span class="text-error"> + ?</span>{/if} Fiber
        </div>
      </div>
    </div>
  </div>

  {#if editing == undefined}
    <!-- View Mode -->
    <div class="food-list">
      {#each food_items as f, i}
        <Food
          name={f.name}
          notes={f.notes}
          index={i}
          mcg={f.mcg}
          fiber={f.fiber}
          unit={f.unit}
          servings={f.servings}
          source={f.source}
          use_edit="true"
          use_fav="true"
          use_dec="true"
          use_inc="true"
          use_del="true"
          hide_details={true}
          on:message={do_msg}
        />
      {/each}
    </div>
  {:else}
    <!-- Edit Mode -->
    <div class="card edit-form">
      <h3>Edit Item</h3>

      <div class="form-group">
        <label for="edit-name">Name</label>
        <input id="edit-name" type="text" bind:value={editing.name} readonly />
      </div>

      <div class="form-group">
        <label for="edit-notes">Notes</label>
        <input id="edit-notes" type="text" bind:value={editing.notes} placeholder="Add notes..." />
      </div>

      <div class="grid-2-col">
        <div class="form-group">
          <label for="edit-mcg">Mcg</label>
          <input id="edit-mcg" type="number" bind:value={editing.mcg} readonly />
        </div>

        <div class="form-group">
          <label for="edit-fiber">Fiber</label>
          <input id="edit-fiber" type="number" bind:value={editing.fiber} readonly />
        </div>
      </div>

      <div class="grid-2-col">
        <div class="form-group">
          <label for="edit-unit">Unit</label>
          <input id="edit-unit" type="text" bind:value={editing.unit} readonly />
        </div>

        <div class="form-group">
          <label for="edit-servings">Servings</label>
          <input id="edit-servings" type="number" step="0.1" bind:value={editing.servings} />
        </div>
      </div>

      <div class="form-group">
        <label for="edit-source">Source</label>
        <input id="edit-source" type="text" bind:value={editing.source} readonly />
      </div>

      <div class="form-actions flex gap-md justify-between mt-lg">
        <button type="button" class="btn btn-outline" on:click={cancel_edit}>Cancel</button>
        <button type="button" class="btn btn-primary" on:click={save_edit}>Save Changes</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .current-date {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .total-row.large {
    font-size: 1.2rem;
    font-weight: 500;
  }

  .mb-xs {
    margin-bottom: var(--spacing-xs);
  }

  .text-lg {
    font-size: 1.25rem;
  }

  .stats-row {
    margin-top: var(--spacing-sm);
    border-top: 1px solid var(--color-border);
    padding-top: var(--spacing-sm);
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

  .border-t {
    border-top: 1px solid var(--color-border);
  }
  .pt-md {
    padding-top: var(--spacing-md);
  }

  .total-row.large {
    font-size: 1.25rem;
    margin-bottom: var(--spacing-xs);
  }

  .edit-form {
    padding: var(--spacing-lg);
  }

  .form-group {
    margin-bottom: var(--spacing-md);
  }

  label {
    display: block;
    margin-bottom: var(--spacing-xs);
    font-weight: 500;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .grid-2-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-md);
  }

  .mt-lg {
    margin-top: var(--spacing-lg);
  }

  .text-error {
    color: var(--color-error);
  }
</style>
