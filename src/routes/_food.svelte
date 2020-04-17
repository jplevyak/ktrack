<script>
import { createEventDispatcher } from 'svelte';
export let name = "";
export let entry = -1; // history entry index if any.
export let index = -1; // index into items in day or search results.
export let unit = "";
export let mcg = undefined;
export let servings = undefined;
export let notes = undefined;
export let source = "";
export let use_edit = false;
export let use_dup = false;
export let use_fav = false;
export let use_dec = false;
export let use_del = false;
export let use_move = false;
export let use_total = mcg && servings != undefined;

const dispatch = createEventDispatcher();

function msg(change) {
  dispatch('message', {
    entry: entry,
    index: index,
    change: change
  });
}
function inc() { msg(0.1); }
function dec() { msg(-0.1); }
function del() { msg('del'); }
function fav() { msg('fav'); }
function edit() { msg('edit'); }
function dup() { msg('dup'); }
function up() { msg("up"); }
function down() { msg("down"); }
</script>

<style>
.food {
  display: table;
  border-style: none none solid none;
  border-width: 1px;
}
</style>

<div class="food">
{name} @ {mcg == undefined ? "unknown" : mcg} mcg/{unit}{#if notes != undefined && notes != ""}, {notes}{/if}{#if servings != undefined}, {servings.toFixed(3)} servings{/if}{#if use_total}&nbsp= {(mcg * servings).toFixed(3)} mcg{/if}{#if source}, {source} {/if}
{#if use_edit}<button on:click={edit}>edit</button>{/if}
{#if use_dup}<button on:click={dup}>dup</button>{/if}
{#if use_del}<button on:click={del}>x</button>{/if}
{#if use_fav}<button on:click={fav}>*</button>{/if}
{#if use_move}
<button on:click={up}>^</button>
<button on:click={down}>v</button>
{/if}
{#if use_dec} <button on:click={dec}>-</button>{/if}
<button on:click={inc}>+</button>
</div>
