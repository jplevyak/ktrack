<script>

import { afterUpdate, onDestroy } from 'svelte';
import foods from './_foods.json';
import Food from './_food';
import { weekdays, months, compare_date, get_total, make_today } from './_util.js';
import { today_store, profile_store, save_today, save_favorite, backup_today } from './_stores.js';

let total = 0;
let today = undefined;
let profile = undefined;
let editing = undefined;
let editing_index = undefined;
let server_checked = false;
let resolution = 0.0001;

// straddle all small moves.
let stops = [0.2, 0.250, 0.3, 0.3333333333, 0.4, 0.5, 0.6, 0.6666666666, 0.7, 0.75, 0.8];
let rstops = [...stops].sort((x, y) => y - x);
let small_stops = [0.0, 0.015625, 0.03125, 0.0625, 0.1, 0.125, 0.2];
let rsmall_stops = [...small_stops].sort((x, y) => y - x);

const unsubscribe_profile = profile_store.subscribe(p => { profile = p; });
const unsubscribe_today = today_store.subscribe(t => {
  if (t.year == undefined) {
    t = make_today();
    today_store.set(t);
  }
  let new_day = make_today();
  if (compare_date(t, new_day) != 0) {
    console.log("new day", t, new_day);
    today = new_day;
    save_today(today, profile);
  } else {
    today = t;
    console.log("set today", today);
    if (!server_checked) {
      server_checked = true;
      backup_today(today, profile);
    }
  }
});
onDestroy(() => { unsubscribe_today(); unsubscribe_profile(); });

function save_item(item) {
  item.updated = Date.now();
  today.updated = item.updated;
  save_today(today, profile);
}

afterUpdate(() => {
  if (editing != undefined) {
    document.getElementById("cancel").onclick = function() {
      editing = undefined;
    };
    document.getElementById("save").onclick = function() {
      today.items[editing_index] = editing;
      save_item(editing);
      editing = undefined;
    };
  }
});

// Move to p2 if between p1 and p2.
function fix_change(x, p1, p2) {
  var r = null
  if (p2 > p1) { // e.g. p1 = 0.2 p2 = 0.25
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
  let x = servings - Math.floor(servings);
  let s = change > 0 ? stops : rstops;
  let ss = change > 0 ? small_stops : rsmall_stops;
  let r;
  console.log(change, s);
  for (let i = 0; i < s.length - 1; i++)
    if (r = fix_change(x, s[i], s[i+1])) return r;
  if (servings - resolution > 1) {
    return change;
  } else {
    if (x - resolution > 0.2)
      return change;
    for (let i = 0; i < ss.length - 1; i++)
      if (r = fix_change(x, ss[i], ss[i+1])) return r;
    if (change < 0 && x - resolution > 0.015625)
      return 0.0 - x;
    return change;
  }
}

function do_msg(event) {
  if (event.status == "completed") return;
  let index = event.detail.index;
  if (index < 0 || index >= today.items.length) {
    return;
  }
  let change = event.detail.change;
  let item = today.items[index];
  if (change == "del") {
    item.del = true;
    save_item(item);
  } else if (event.detail.change == 'fav') {
    save_favorite(item, profile);
  } else if (event.detail.change == "edit") {
    editing = {...item};
    editing_index = index;
  } else {
    change = get_change(item.servings, change);
    item.servings += change;
    save_item(item);
  }
}

$: total = get_total(today);

</script>

<svelte:head>
	<title>KTrack - Today</title>
</svelte:head>

<b>Date: {weekdays[today.day]} {months[today.month]} {today.date}, {today.year}</b><br><br>
{#if editing == undefined}
{#each today.items as f, i}
{#if f.del == undefined}
<Food name={f.name} notes={f.notes} index={i} mcg={f.mcg} unit={f.unit} servings={f.servings} source={f.source} use_edit=true use_fav=true use_dec=true use_del=true on:message={do_msg}/>
{/if}
{/each}
<p></p>Total: {total.toFixed(2)}
{:else}
<table><col><col>
<tr><th>Name</th><th><input class="val" type="text" bind:value={editing.name} readonly /></th></tr>
<tr><th>Notes</th><th><input class="val" type="text" bind:value={editing.notes} /></th></tr>
<tr><th>mcg</th><th> <input class="val" type="number" bind:value={editing.mcg} readonly /></th></tr>
<tr><th>Unit</th><th><input class="val" type="text" bind:value={editing.unit} readonly /></th></tr>
<tr><th>Servings</th><th><input class="val" type="number" step=0.1 bind:value={editing.servings} /></th></tr>
<tr><th>Source</th><th><input class="val" type="text" bind:value={editing.source} readonly /></th></tr>
</table>
<br><button type="button" id="cancel">cancel</button>
<button type="button" id="save">save</button>
{/if}
