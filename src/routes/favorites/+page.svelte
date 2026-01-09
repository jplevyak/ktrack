<script>
  import { afterUpdate, onDestroy, onMount } from "svelte";

  onMount(() => {
    syncManager.syncIfNeeded();
  });
  import Food from "../_food.svelte";
  import {
    today_store,
    edit_store,
    favorites_store,
    profile_store,
    add_item,
    save_favorite,
    check_for_new_day,
    syncManager,
  } from "../_stores.js";
  import { create_elasticlunr } from "../_elasticlunr.js";

  let elasticlunr = create_elasticlunr();
  let index = undefined;
  let search_value = undefined;
  let favorites = undefined;
  let results = undefined;
  let results_map = undefined;
  let added_count = 0;
  let editing = undefined;
  let editing_replace_index = undefined;
  let profile = undefined;
  let today = undefined;
  let edit = undefined;

  const unsubscribe_profile = profile_store.subscribe((p) => {
    profile = p;
  });
  const unsubscribe_favorites = favorites_store.subscribe((value) => {
    if (value == undefined) {
      return;
    }
    favorites = value;
    create_index();
    update_results();
  });
  const unsubscribe_today = today_store.subscribe((t) => {
    today = t;
  });
  const unsubscribe_edit = edit_store.subscribe((e) => {
    edit = e;
  });

  const favorites_status = favorites_store.status;

  $: (today, check_for_new_day(today, profile));

  onDestroy(() => {
    unsubscribe_today();
    unsubscribe_edit();
    unsubscribe_favorites();
    unsubscribe_profile();
  });

  function create_index() {
    index = elasticlunr(function () {
      this.addField("name");
      this.setRef("i");
      this.saveDocument(false);
    });
    if (favorites != undefined) {
      let favorites_data = favorites.getData();
      for (var i in favorites_data) {
        index.addDoc({ i: i, name: favorites_data[i].name });
      }
    }
  }

  function make_item() {
    return {
      name: "",
      notes: "",
      mcg: 0.0,
      fiber: 0.0,
      unit: "",
      servings: 1.0,
      source: "custom",
    };
  }

  function update_results() {
    let favorites_data = favorites.getData();
    results_map = undefined;
    if (search_value == undefined || search_value == "") {
      results = [...favorites_data];
      return;
    }
    results_map = new Map();
    if (!index) create_index();
    let found = index.search(search_value);
    results = [];
    found.forEach((f, i) => {
      results_map.set(i, f.ref);
      results.push(favorites_data[f.ref]);
    });
  }

  function save(favs) {
    favorites_store.set(favs);
  }

  function search_results() {
    // search_value is bound to the input, so just update results
    update_results();
  }

  function create_favorite() {
    editing = make_item();
  }

  function clear_search() {
    search_value = "";
    update_results();
  }

  function cancel_edit() {
    editing_replace_index = undefined;
    editing = undefined;
  }

  function save_edit() {
    let edited = { ...editing };
    save_favorite(edited, profile, editing_replace_index);
    editing_replace_index = undefined;
    editing = undefined;
  }

  function do_msg(event) {
    if (event.status == "completed") return;
    let index = event.detail.index;
    if (index < 0 || index >= results.length) {
      return;
    }
    let item = results[index];
    let change = event.detail.change;
    if (change == "del") {
      let y = confirm("Do you want to delete the favorite?");
      if (!y) return;
      let i = index;
      if (results_map != undefined) {
        i = results_map.get(index);
      }
      favorites.deleteItem([Number(i)]);
      save(favorites);
    } else if (change == "edit") {
      editing_replace_index = index;
      if (results_map != undefined) editing_replace_index = results_map.get(index);
      editing_replace_index = Number(editing_replace_index);
      let edit = { ...item };
      edit.source = "custom";
      editing = edit;
    } else if (change == "dup") {
      let edit = { ...item };
      edit.name = edit.name + " (dup)";
      edit.source = "custom";
      editing = edit;
    } else if (change == "up") {
      let i = index;
      if (results_map != undefined) i = results_map.get(index);
      i = Number(i);
      let j = i - 1;
      if (j >= 0) {
        favorites.moveItem([], i, i - 1);
        save(favorites);
        return;
      }
    } else if (change == "down") {
      let i = index;
      if (results_map != undefined) i = results_map.get(index);
      i = Number(i);
      let j = i + 1;
      if (j < favorites.getData().length) {
        favorites.moveItem([], i, i + 1);
        save(favorites);
        return;
      }
    } else if (change > 0) {
      add_item(item, today, edit, profile);
      added_count += 1;
    }
  }
</script>

<svelte:head>
  <title>KTrack - Favorites</title>
</svelte:head>

<div class="favorites-view">
  {#if editing == undefined}
    <!-- Search & Controls Header -->
    <div class="card header-card">
      <div class="search-controls flex flex-col gap-sm">
        <label for="search_string" class="sr-only">Search Favorites</label>
        <div class="flex gap-sm">
          <input
            type="text"
            id="search_string"
            bind:value={search_value}
            on:input={search_results}
            placeholder="Search favorites..."
            class="flex-1"
          />
          <button type="button" class="btn btn-primary" on:click={search_results}>Search</button>
          <button type="button" class="btn btn-outline" on:click={clear_search}>Clear</button>
        </div>

        <div class="flex justify-between items-center mt-sm">
          <button type="button" class="btn btn-outline text-sm" on:click={create_favorite}>
            + Create New Favorite
          </button>

          <div class="added-count text-primary font-bold text-sm">
            Added: {added_count}
          </div>
        </div>
      </div>

      <div class="status-row mt-sm">
        {#if $favorites_status && $favorites_status != "idle"}
          <span class="status-badge">🟡 {$favorites_status}</span>
        {/if}
      </div>
    </div>

    <!-- Favorites List -->
    <div class="favorites-list">
      {#if favorites != undefined}
        {#each results as f, i}
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
            use_dup="true"
            use_add="true"
            use_del="true"
            use_move="true"
            hide_details={true}
            on:message={do_msg}
          />
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Edit Mode -->
    <div class="card edit-form">
      <h3>{editing.name ? "Edit Favorite" : "Create Favorite"}</h3>

      <div class="form-group">
        <label for="fav-name">Name</label>
        <input id="fav-name" type="text" bind:value={editing.name} />
      </div>

      <div class="form-group">
        <label for="fav-notes">Notes</label>
        <input id="fav-notes" type="text" bind:value={editing.notes} placeholder="Add notes..." />
      </div>

      <div class="grid-2-col">
        <div class="form-group">
          <label for="fav-mcg">Mcg</label>
          <input id="fav-mcg" type="number" bind:value={editing.mcg} />
        </div>

        <div class="form-group">
          <label for="fav-fiber">Fiber</label>
          <input id="fav-fiber" type="number" bind:value={editing.fiber} />
        </div>
      </div>

      <div class="grid-2-col">
        <div class="form-group">
          <label for="fav-unit">Unit</label>
          <input id="fav-unit" type="text" bind:value={editing.unit} />
        </div>

        <div class="form-group">
          <label for="fav-servings">Servings</label>
          <input id="fav-servings" type="number" step="0.1" bind:value={editing.servings} />
        </div>
      </div>

      <div class="form-group">
        <label for="fav-source">Source</label>
        <input id="fav-source" type="text" bind:value={editing.source} />
      </div>

      <div class="form-actions flex gap-md justify-between mt-lg">
        <button type="button" class="btn btn-outline" on:click={cancel_edit}>Cancel</button>
        <button type="button" class="btn btn-primary" on:click={save_edit}>Save Favorite</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .favorites-view {
    padding-bottom: var(--spacing-xl);
  }

  .mt-sm {
    margin-top: var(--spacing-sm);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }

  .flex-1 {
    flex: 1;
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

  /* Form Styles (Reused from Main Page concept) */
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
</style>
