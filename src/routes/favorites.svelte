<script>

import { afterUpdate, onDestroy } from 'svelte';
import elasticlunr from './_elasticlunr.js';
import Food from './_food';
import { today_store, edit_store, favorites_store, profile_store, add_item, backup_favorites, save_favorite, check_for_new_day } from './_stores.js';

let index = undefined;
let search_value = undefined;
let favorites = undefined;
let results = undefined;
let results_map = undefined;
let added_count = 0;
let editing = undefined;
let editing_replace_index = undefined;
let server_checked = false;
let edit = undefined;
let profile = undefined;

const unsubscribe_profile = profile_store.subscribe(p => { profile = p; });
const unsubscribe_favorites = favorites_store.subscribe(value => {
  if (value == undefined) {
    return;
  }
  favorites = value;
  if (!server_checked) {
    server_checked = true;
    backup_favorites(favorites, profile);
  }
  create_index();
  update_results();
});
const unsubscribe_today = today_store.subscribe(check_for_new_day);
const unsubscribe_edit = edit_store.subscribe(value => { edit = value; });
onDestroy(() => { unsubscribe_today(); unsubscribe_edit(); unsubscribe_favorites(); unsubscribe_profile(); });

function create_index() {
  index = elasticlunr(function () {
    this.addField('name')
    this.setRef("i")
    this.saveDocument(false);
  });
  if (favorites != undefined) {
    for (var i in favorites.items) {
      index.addDoc({"i": i, "name": favorites.items[i].name, });
    }
  }
}

function make_item() {
  return {
    name: "",
    notes: "",
    mcg: 0.0,
    unit: "",
    servings: 1.0,
    source: "custom"
  };
}

function update_results() {
  results_map = undefined;
  if (search_value == undefined || search_value == "") {
    results = [...favorites.items];
    return;
  }
  results_map = new Map();
  if (!index)
    create_index();
  let found = index.search(search_value);
  results = [];
  for (let f in found) {
    results_map.set(f, found[f].ref);
    results.push(favorites.items[found[f].ref]);
  }
}

function save() {
  favorites.updated = Date.now();
  favorites_store.set(favorites);
  backup_favorites(favorites, profile);
  update_results();
}

afterUpdate(() => {
  if (editing == undefined) {
    let search_box = document.getElementById("search_string");
    function search_results() {
      search_value = search_box.value;
      update_results();
    };
    search_box.onchange = search_results;
    document.getElementById("search").onclick = search_results;
    document.getElementById("create").onclick = function() {
      editing = make_item();
    };
    document.getElementById("clear_input").onclick = () => {
      document.getElementById("search_string").value = "";
      search_value = "";
      update_results();
    };
  } else {
    document.getElementById("cancel").onclick = function() {
      editing = undefined;
      editing_replace_index = undefined;
    };
    document.getElementById("save").onclick = function() {
      editing.updated = Date.now();
      save_favorite(editing, profile, editing_replace_index);
      editing = undefined;
      editing_replace_index = undefined;
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
    if (!y)
      return;
    item.updated = Date.now();
    item.del = true;
    save();
  } else if (change == "edit") {
    editing_replace_index = index;
    if (results_map != undefined)
      editing_replace_index = results_map.get(index);
    editing = {...item};
    delete editing.del;
    editing.source = "custom";
  } else if (change == "dup") {
    editing = {...item};
    editing.name = editing.name + " (dup)";
    delete editing.del;
    editing.source = "custom";
  } else if (change == "up") {
    let i = index;
    if (results_map != undefined)
      i = results_map.get(index);
    let j = i - 1;
    while (j >= 0) {
      if (favorites.items[j].del == undefined) {
        let f = favorites.items[i];
        favorites.items.splice(i, 1);
        favorites.items.splice(j, 0, f);
        save();
        return;
      }
      j = j - 1;
    }
  } else if (change == "down") {
    let i = index;
    if (results_map != undefined)
      i = results_map.get(index);
    let j = i + 1;
    while (j < favorites.items.length) {
      if (favorites.items[j].del == undefined) {
        let f = favorites.items[i];
        favorites.items.splice(i, 1);
        favorites.items.splice(j, 0, f);
        save();
        return;
      }
      j = j + 1;
    }
  } else if (change > 0) {
    add_item(item, edit, profile);
    added_count += 1;
  }
}

</script>

<style>
table, col {
  align: "left"
}
th {
  align: "left"
}
.val {
  width: 50em;
}
</style>

<svelte:head>
	<title>KTrack - Favorites</title>
</svelte:head>

{#if editing == undefined}
Search <input type="text" id="search_string"/>
<button type="button" id="search">Search</button>
<button type="button" id="clear_input">Clear</button>
<button type="button" id="create">Create New Favorite</button>
&nbsp;&nbsp; Added: {added_count}
<br><br>
{#if favorites != undefined }
{#each results as f, i}
{#if f.del == undefined }
<Food name={f.name} notes={f.notes} index={i} mcg={f.mcg} unit={f.unit} servings={f.servings} source={f.source} use_edit=true use_dup=true use_add=true use_del=true use_move=true on:message={do_msg} />
{/if}
{/each}
{/if}
{:else}
<table><col><col>
<tr><th>Name</th><th><input class="val" type="text" bind:value={editing.name} /></th></tr>
<tr><th>Notes</th><th><input class="val" type="text" bind:value={editing.notes} /></th></tr>
<tr><th>mcg</th><th> <input class="val" type="number" bind:value={editing.mcg} /></th></tr>
<tr><th>Unit</th><th><input class="val" type="text" bind:value={editing.unit} /></th></tr>
<tr><th>Servings</th><th><input class="val" type="number" step=0.1 bind:value={editing.servings} /></th></tr>
<tr><th>Source</th><th><input class="val" type="text" bind:value={editing.source} /></th></tr>
</table>
<br><button type="button" id="cancel">cancel</button>
<button type="button" id="save">save</button>
{/if}
