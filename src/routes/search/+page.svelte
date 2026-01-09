<script>
  import { onMount, onDestroy } from "svelte";
  import foods from "../_foods.json";
  import index from "../_index.json";
  import Food from "../_food.svelte";
  import {
    today_store,
    edit_store,
    index_store,
    profile_store,
    add_item,
    save_favorite,
    check_for_new_day,
  } from "../_stores.js";
  import { create_elasticlunr } from "../_elasticlunr.js";

  let elasticlunr = create_elasticlunr();
  let search = index_store.value;
  if (search == undefined) {
    search = elasticlunr.Index.load(index);
    index_store.set(search);
  }
  let profile = undefined;
  let today = undefined;
  let edit = undefined;
  let results = [];
  let added_count = 0;

  const unsubscribe_profile = profile_store.subscribe((p) => {
    profile = p;
  });
  const unsubscribe_today = today_store.subscribe((t) => {
    today = t;
  });
  const unsubscribe_edit = edit_store.subscribe((e) => {
    edit = e;
  });

  $: (today, check_for_new_day(today, profile));

  onDestroy(() => {
    unsubscribe_profile();
    unsubscribe_today();
    unsubscribe_edit();
  });

  onMount(() => {
    let search_box = document.getElementById("search_string");
    function search_results() {
      if (search_box.value == "") {
        results = [];
        return;
      }
      let found = search.search(search_box.value);
      results = [];
      let results_set = new Set();
      for (let f of found) results_set.add(f.ref);
      for (let f of results_set) results.push(foods[f]);
    }
    search_box.onchange = search_results;
    document.getElementById("search").onclick = search_results;

    document.getElementById("clear_input").onclick = () => {
      document.getElementById("search_string").value = "";
      results = [];
    };
  });

  function do_msg(event) {
    if (event.status == "completed") return;
    let index = event.detail.index;
    if (index < 0 || index >= results.length) return;
    let item = results[index];
    if (event.detail.change == "fav") {
      save_favorite(item, profile);
    } else if (event.detail.change > 0) {
      added_count += 1;
      add_item(item, today, edit, profile);
    }
  }
</script>

<svelte:head>
  <title>KTrack - Favorites</title>
</svelte:head>

<div class="search-view">
  <!-- Search Header -->
  <div class="card header-card">
    <div class="search-controls flex flex-col gap-sm">
      <label for="search_string" class="sr-only">Search Foods</label>
      <div class="flex gap-sm">
        <input type="text" id="search_string" placeholder="Search database..." class="flex-1" />
        <button type="button" id="search" class="btn btn-primary">Search</button>
        <button type="button" id="clear_input" class="btn btn-outline">Clear</button>
      </div>

      <div class="added-count text-primary font-bold text-sm text-right mt-sm">
        Added: {added_count}
      </div>
    </div>
  </div>

  <!-- Results List -->
  <div class="search-results">
    {#each results as f, i}
      <Food
        name={f.name}
        notes={f.notes}
        index={i}
        mcg={f.mcg}
        fiber={f.fiber}
        unit={f.unit}
        source={f.source}
        use_add="true"
        use_fav="true"
        on:message={do_msg}
      />
    {/each}
  </div>
</div>

<style>
  .search-view {
    padding-bottom: var(--spacing-xl);
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

  .mt-sm {
    margin-top: var(--spacing-sm);
  }

  .text-right {
    text-align: right;
  }
</style>
