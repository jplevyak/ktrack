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
</script>

<div class="card food-card">
  <div class="food-header flex justify-between items-center">
    <div>
      <h3 class="food-name">{name}</h3>
      {#if servings != undefined}
        <div class="food-servings">
          <span class="font-bold text-primary">{servings.toFixed(3)}</span> servings
        </div>
      {/if}
    </div>

    <div class="food-actions flex gap-sm">
      {#if use_edit}
        <button on:click={edit} class="btn btn-outline text-sm" aria-label="Edit">Edit</button>
      {/if}
      {#if use_dup}
        <button on:click={dup} class="btn btn-outline text-sm" aria-label="Duplicate">Dup</button>
      {/if}
    </div>
  </div>

  <div class="food-details text-secondary text-sm">
    <div class="detail-row">
      <span class="detail-label">Micronutrients:</span>
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

  <div class="food-toolbar flex justify-between items-center">
    <div class="left-tools flex gap-sm">
      {#if use_dec}
        <button on:click={dec} class="btn btn-icon" aria-label="Decrease">&lt;</button>
      {/if}
      {#if use_inc}
        <button on:click={inc} class="btn btn-icon" aria-label="Increase">&gt;</button>
      {/if}
      {#if use_add}
        <button on:click={inc} class="btn btn-icon" aria-label="Add">+</button>
      {/if}
    </div>

    <div class="right-tools flex gap-sm">
      {#if use_move}
        <button on:click={up} class="btn btn-icon" aria-label="Move Up">^</button>
        <button on:click={down} class="btn btn-icon" aria-label="Move Down">v</button>
      {/if}
      {#if use_fav}
        <button on:click={fav} class="btn btn-icon star-btn" aria-label="Favorite">★</button>
      {/if}
      {#if use_del}
        <button on:click={del} class="btn btn-icon delete-btn" aria-label="Delete">✕</button>
      {/if}
    </div>
  </div>
</div>

<style>
  .food-card {
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
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
    margin: var(--spacing-sm) 0;
    padding: var(--spacing-sm) 0;
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
    margin-top: var(--spacing-sm);
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

  .btn-icon {
    font-size: 1.2rem;
    width: 36px;
    height: 36px;
  }
</style>
