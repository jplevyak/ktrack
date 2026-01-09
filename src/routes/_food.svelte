<script>
  import { createEventDispatcher } from "svelte";
  export let name = "";
  export let entry = -1; // history entry index if any.
  export let index = -1; // index into items in day or search results.
  export let unit = "";
  export let mcg = undefined;
  export let fiber = undefined;
  export let servings = undefined;
  export let notes = undefined;
  export let source = "";
  export let use_edit = false;
  export let use_dup = false;
  export let use_fav = false;
  export let use_dec = false;
  export let use_inc = false;
  export let use_add = false;
  export let use_del = false;
  export let use_move = false;
  export let hide_details = false;

  let show_details = !hide_details;
  let use_total = undefined;
  let use_notes = undefined;
  let g100 = unit == "100g";
  let m = undefined;
  let grams = undefined;
  let use_grams = undefined;

  $: use_total = mcg != undefined && servings != undefined;
  $: use_notes = notes != undefined && notes != "";
  $: m = use_notes ? notes.match(/^(\d+)g/) : undefined;
  $: grams = m == undefined ? (g100 ? 100 : undefined) : m[1];
  $: use_grams = grams != undefined;

  const dispatch = createEventDispatcher();

  function msg(change) {
    dispatch("message", {
      entry: entry,
      index: index,
      change: change,
    });
  }
  function inc() {
    msg(1);
  }
  function dec() {
    msg(-1);
  }
  function del() {
    msg("del");
  }
  function fav() {
    msg("fav");
  }
  function edit() {
    msg("edit");
  }
  function dup() {
    msg("dup");
  }
  function up() {
    msg("up");
  }
  function down() {
    msg("down");
  }
  function toggle_details() {
    show_details = !show_details;
  }
</script>

<div class="card food-card">
  <div class="food-header flex justify-between items-center">
    <div>
      <h3 class="food-name">{name}</h3>
      {#if servings != undefined}
        <div class="food-servings">
          <span class="font-bold text-primary">{servings.toFixed(3)}</span> servings
          {#if mcg != undefined}
            <span class="text-secondary">
              · {(mcg * servings).toFixed(1)} mcg Vit K
            </span>
          {/if}
          {#if fiber != undefined && fiber !== ""}
            <span class="text-secondary">
              · {(fiber * servings).toFixed(1)} g Fiber
            </span>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Actions moved to toolbar -->
  </div>

  {#if show_details}
    <div class="food-details text-secondary text-sm">
      <div class="detail-row">
        <span class="detail-label">Vitamin K:</span>
        <span class="detail-value">{mcg == undefined ? "unknown" : mcg} mcg/{unit}</span>
      </div>

      <div class="detail-row">
        <span class="detail-label">Fiber:</span>
        <span class="detail-value"
          >{fiber == undefined || fiber == "" ? "unknown" : fiber} g/{unit}</span
        >
      </div>

      {#if use_notes}
        <div class="detail-row">
          <span class="detail-label">Notes:</span>
          <span class="detail-value">{notes}</span>
        </div>
      {/if}

      {#if source}
        <div class="detail-row">
          <span class="detail-label">Source:</span>
          <span class="detail-value">{source}</span>
        </div>
      {/if}

      {#if use_total}
        <div class="detail-row food-total">
          <span class="detail-label">Total:</span>
          <span class="detail-value">
            {#if use_grams}{(grams * servings).toFixed(3)}g &bull;
            {/if}
            <strong>{(mcg * servings).toFixed(3)}</strong> mcg
          </span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="food-toolbar flex justify-between items-center">
    <div class="left-tools flex gap-sm">
      {#if use_dec}
        <button on:click={dec} class="btn btn-icon" aria-label="Decrease">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg
          >
        </button>
      {/if}
      {#if use_inc}
        <button on:click={inc} class="btn btn-icon" aria-label="Increase">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg
          >
        </button>
      {/if}
      {#if use_add}
        <button on:click={inc} class="btn btn-icon" aria-label="Add">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg
          >
        </button>
      {/if}
    </div>

    <div class="right-tools flex gap-sm">
      {#if use_move}
        <button on:click={up} class="btn btn-icon" aria-label="Move Up">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="m18 15-6-6-6 6" /></svg
          >
        </button>
        <button on:click={down} class="btn btn-icon" aria-label="Move Down">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg
          >
        </button>
      {/if}
      {#if use_fav}
        <button on:click={fav} class="btn btn-icon star-btn" aria-label="Favorite">★</button>
      {/if}
      {#if use_del}
        <button on:click={del} class="btn btn-icon delete-btn" aria-label="Delete">✕</button>
      {/if}
      {#if hide_details}
        <button on:click={toggle_details} class="btn btn-icon" aria-label="Info">
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
            ><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg
          >
        </button>
      {/if}
      {#if use_edit}
        <button on:click={edit} class="btn btn-icon" aria-label="Edit">
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
      {/if}
      {#if use_dup}
        <button on:click={dup} class="btn btn-icon" aria-label="Duplicate">
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
            ><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path
              d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
            /></svg
          >
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .food-card {
    padding: var(--spacing-sm);
    margin-bottom: var(--spacing-sm);
    transition: transform var(--transition-fast);
  }

  .food-name {
    margin: 0;
    font-size: 1.1rem;
    color: var(--color-text-main);
  }

  .food-servings {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
  }

  .text-primary {
    color: var(--color-primary);
  }

  .food-details {
    margin: var(--spacing-xs) 0;
    padding: var(--spacing-xs) 0;
    border-top: 1px dashed var(--color-border);
    border-bottom: 1px dashed var(--color-border);
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .food-total {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dotted var(--color-border);
    font-weight: 500;
    color: var(--color-text-main);
  }

  .food-toolbar {
    margin-top: var(--spacing-xs);
  }

  .star-btn {
    color: #fbc02d;
  }

  .delete-btn {
    color: var(--color-error);
  }

  .delete-btn:hover {
    background-color: #ffebee;
  }

  .delete-btn:hover {
    background-color: #ffebee;
  }
</style>
