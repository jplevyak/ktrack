<script>
  import { afterUpdate, onDestroy } from "svelte";
  import Food from "../_food.svelte";
  import {
    today_store,
    edit_store,
    favorites_store,
    profile_store,
    add_item,
    save_favorite,
    check_for_new_day,
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

  const unsubscribe_profile = profile_store.subscribe((p) => { profile = p; });
  const unsubscribe_favorites = favorites_store.subscribe((value) => {
    if (value == undefined) {
      return;
    }
    favorites = value;
    create_index();
    update_results();
  });
  const unsubscribe_today = today_store.subscribe((t) => { today = t; });
  const unsubscribe_edit = edit_store.subscribe((e) => { edit = e; });

  $: today, check_for_new_day(today, profile);

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
    for (let f in found) {
      results_map.set(f, found[f].ref);
      results.push(favorites_data[found[f].ref]);
    }
  }

  function save(favs) {
    favorites_store.set(favs);
  }

  afterUpdate(() => {
    if (editing == undefined) {
      let search_box = document.getElementById("search_string");
      function search_results() {
        search_value = search_box.value;
        update_results();
      }
      search_box.onchange = search_results;
      document.getElementById("search").onclick = search_results;
      document.getElementById("create").onclick = function () {
        editing = make_item();
      };
      document.getElementById("clear_input").onclick = () => {
        document.getElementById("search_string").value = "";
        search_value = "";
        update_results();
      };
    } else {
      document.getElementById("cancel").onclick = function () {
        editing_replace_index = undefined;
        editing = undefined;
      };
      document.getElementById("save").onclick = function () {
        let edited = { ...editing };
        save_favorite(edited, profile, editing_replace_index);
        editing_replace_index = undefined;
        editing = undefined;
      };
    }
  });

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
      favorites.deleteItem([i]);
      save(favorites);
    } else if (change == "edit") {
      editing_replace_index = index;
      if (results_map != undefined)
        editing_replace_index = results_map.get(index);
      let edit = { ...item };
      delete edit.del;
      edit.source = "custom";
      editing = edit;
    } else if (change == "dup") {
      let edit = { ...item };
      edit.name = edit.name + " (dup)";
      delete edit.del;
      edit.source = "custom";
      editing = edit;
    } else if (change == "up") {
      let i = index;
      if (results_map != undefined) i = results_map.get(index);
      let j = i - 1;
      if (j >= 0) {
        favorites.moveItem([], i, i-1);
        save(favorites);
        return;
      }
    } else if (change == "down") {
      let i = index;
      if (results_map != undefined) i = results_map.get(index);
      let j = i + 1;
      if (j < favorites.getData().length) {
        favorites.moveItem([], i, i+1);
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

{#if editing == undefined}
  Search <input type="text" id="search_string" />
  <button type="button" id="search">Search</button>
  <button type="button" id="clear_input">Clear</button>
  <button type="button" id="create">Create New Favorite</button>
  &nbsp;&nbsp; Added: {added_count}
  <br /><br />
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
        on:message={do_msg}
      />
    {/each}
  {/if}
{:else}
  <table>
  <tbody>
    <tr
      ><th>Name</th><th
        ><input class="val" type="text" bind:value={editing.name} /></th
      ></tr
    >
    <tr
      ><th>Notes</th><th
        ><input class="val" type="text" bind:value={editing.notes} /></th
      ></tr
    >
    <tr
      ><th>mcg</th><th>
        <input class="val" type="number" bind:value={editing.mcg} /></th
      ></tr
    >
    <tr
      ><th>fiber</th><th>
        <input class="val" type="number" bind:value={editing.fiber} /></th
      ></tr
    >
    <tr
      ><th>Unit</th><th
        ><input class="val" type="text" bind:value={editing.unit} /></th
      ></tr
    >
    <tr
      ><th>Servings</th><th
        ><input
          class="val"
          type="number"
          step="0.1"
          bind:value={editing.servings}
        /></th
      ></tr
    >
    <tr
      ><th>Source</th><th
        ><input class="val" type="text" bind:value={editing.source} /></th
      ></tr
    >
  </tbody>
  </table>
  <br /><button type="button" id="cancel">cancel</button>
  <button type="button" id="save">save</button>
{/if}

<style>
  table,
  th {
    align: "left";
  }
  .val {
    width: 50em;
  }
</style>
