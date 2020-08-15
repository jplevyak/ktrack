<script>

import { onMount, onDestroy } from 'svelte';
import foods from './_foods.json';
import index from './_index.json';
import elasticlunr from './_elasticlunr.js';
import Food from './_food';
import { today_store, edit_store, index_store, profile_store, add_item, save_favorite, check_for_new_day } from './_stores.js';

let search = index_store.value;
if (search == undefined) {
  search = elasticlunr.Index.load(index);
  index_store.set(search);
}
let edit = undefined;
let profile = undefined;
let results = [];
let added_count = 0;

const unsubscribe_today = today_store.subscribe(check_for_new_day);
const unsubscribe_edit = edit_store.subscribe(value => { edit = value; });
const unsubscribe_profile = profile_store.subscribe(p => { profile = p; });
onDestroy(() => { unsubscribe_today(); unsubscribe_edit(); unsubscribe_profile(); });

onMount(() => {
  let search_box = document.getElementById("search_string");
  function search_results() {
    if (search_box.value == "") {
      results = [];
      return;
    }
    let found = search.search(search_box.value);
    results = [];
    for (let f of found)
      results.push(foods[f.ref]);
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
  if (index < 0 || index >= results.length)
    return;
  let item = results[index];
  if (event.detail.change == 'fav') {
    save_favorite(item, profile);
  } else if (event.detail.change > 0) {
    added_count += 1;
    add_item(item, edit, profile);
  }
}
  
</script>

<svelte:head>
	<title>KTrack - Favorites</title>
</svelte:head>

Search <input type="text" id="search_string"/>
<button type="button" id="search">Search</button>
<button type="button" id="clear_input">Clear</button>
&nbsp;&nbsp; Added: {added_count}
<br><br>

{#each results as f, i}
<Food name={f.name} notes={f.notes} index={i} mcg={f.mcg} unit={f.unit} source={f.source} use_fav=true on:message={do_msg} />
{/each}
