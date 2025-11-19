<script>
  import { goto } from "$app/navigation";
  import { onMount, onDestroy } from "svelte";
  import Food from "../_food.svelte";
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
  } from "../_stores.js";

  let the_date = new Date();
  let profile = undefined;
  let today = undefined;
  let edit = undefined;
  let history = undefined;
  let limit = 30;
  let results = [];
  let added_count = 0;

  const unsubscribe_profile = profile_store.subscribe((p) => { profile = p; });
  const unsubscribe_today = today_store.subscribe((t) => { today = t; });
  const unsubscribe_edit = edit_store.subscribe((value) => { edit = value; });
  const unsubscribe_history = history_store.subscribe((value) => { history = value;
  });
  onDestroy(() => {
    unsubscribe_profile();
    unsubscribe_today();
    unsubscribe_edit();
    unsubscribe_history();
  });

  $: results = history.getData().slice(0, limit);
  $: averages = compute_averages(history.getData());

  onMount(() => {
    let box = document.getElementById("limit");
    box.onchange = function () {
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
    if (change == "fav") {
      save_favorite(day.items[index], profile);
      return;
    }
    if (change > 0) {
      add_item(day.items[index], today, edit, profile);
      added_count += 1;
    }
  }

  function edit_day(day) {
    let day_doc = CollabJSON(JSON.stringify(day));
    today = check_for_new_day(today, profile);
    if (compare_date(day_doc, today) == 0) {
      edit_store.set(undefined);
      goto("/");
      return;
    }
    day_doc.addItem(['start_edit'], Date.now());
    edit_store.set(day);
    goto("/");
  }
</script>

<svelte:head>
  <title>KTrack - History</title>
</svelte:head>

Averages [3, 5, 7] days: [{averages[0].toFixed(1)}, {averages[1].toFixed(1)}, {averages[2].toFixed(
  1
)}]<br />
Number of days to view <input type="number" id="limit" value={limit} />
&nbsp;&nbsp; Added: {added_count}
<br /><br />

{#each results as day, e}
  <b
    >Date: {weekdays[day[0].day]}
    {months[day[0].month]}
    {day[0].date}, {day[0].year} <button on:click={() => edit_day(day)}>edit</button>
  </b><br /><br />
  {#each day as f, i}
    {#if i != 0}
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
        on:message={do_msg}
      />
    {/if}
  {/each}
  Total: {get_total(day).toFixed(2)} Total fiber: {get_total_fiber(day)[0].toFixed(2)} {#if get_total_fiber(day)[1]} * some unknown * {/if} 
  <br /><br />
{/each}
