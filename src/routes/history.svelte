<script>
import { goto } from '@sapper/app';
import { onMount, onDestroy } from 'svelte';
import Food from './_food';
import { weekdays, months, make_history, get_total, compute_averages } from './_util.js';
import { today_store, history_store, profile_store, edit_store, add_item, save_favorite, backup_history, check_for_new_day } from './_stores.js';

let the_date = new Date();
let history = undefined;
let limit = 30;
let results = [];
let added_count = 0;
let profile = undefined;
let server_checked = false;

const unsubscribe_profile = profile_store.subscribe(p => {
  profile = p;
});
const unsubscribe_history = history_store.subscribe(value => {
  if (value.items == undefined) {
    value = make_history();
    history_store.set(value);
  }
  history = value;
  if (!server_checked) {
    server_checked = true;
    backup_history(history, profile);
  }
});
const unsubscribe_today = today_store.subscribe(check_for_new_day);
onDestroy(() => {
  unsubscribe_today();
  unsubscribe_history();
  unsubscribe_profile();
});

function get_results() {
  return history.items.slice(0, limit);
}

$: results = history.items.slice(0, limit);
$: averages = compute_averages(history);

onMount(() => {
  let box = document.getElementById("limit");
  box.onchange = function() {
    limit = box.value;
  };
});

function do_msg(event) {
  if (event.status == "completed") return;
  let entry = event.detail.entry;
  if (entry < 0 || entry >= history.items.length) {
    return;
  }
  let day = history.items[entry];
  let index = event.detail.index;
  if (index < 0 || index >= day.items.length) {
    return;
  }
  let change = event.detail.change;
  if (change == 'fav') {
    save_favorite(day.items[index], profile);
    return;
  }
  if (change > 0) {
    add_item(day.items[index], profile);
    added_count += 1;
  }
}

function edit(day) {
  edit_store.set(day);
  goto('/');
}
</script>

<svelte:head>
    <title>KTrack - History</title>
</svelte:head>


Averages [3, 5, 7] days: [{averages[0].toFixed(1)}, {averages[1].toFixed(1)}, {averages[2].toFixed(1)}]<br>
Number of days to view <input type="number" id="limit" value="{limit}" />
&nbsp;&nbsp; Added: {added_count}
<br><br>

{#each results as day, e}
<b>Date: {weekdays[day.day]} {months[day.month]} {day.date}, {day.year} <button on:click={() => edit(day)}>edit</button>
</b><br><br>
{#each day.items as f, i}
{#if f.del == undefined}
<Food name={f.name} notes={f.notes} entry={e} index={i} mcg={f.mcg} unit={f.unit} servings={f.servings} source={f.source} use_fav=true on:message={do_msg}/>
{/if}
{/each}
<p></p>Total: {get_total(day).toFixed(2)}
<br><br>
{/each}
