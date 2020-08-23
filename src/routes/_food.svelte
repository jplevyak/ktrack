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
export let use_inc = false;
export let use_add = false;
export let use_del = false;
export let use_move = false;

let use_total = undefined;
let use_notes = undefined;
let m = undefined;
let grams = undefined;
let use_grams = undefined;

$: use_total = ((mcg != undefined) && (servings != undefined));
$: use_notes = ((notes != undefined) && (notes != ""));
$: m = use_notes ? notes.match(/^(\d+)g/) : undefined;
$: grams = (m == undefined) ? undefined : m[1];
$: use_grams = (grams != undefined) && (servings != 1.0);

const dispatch = createEventDispatcher();

function msg(change) {
  dispatch('message', {
    entry: entry,
    index: index,
    change: change
  });
}
function inc() { msg(1); }
function dec() { msg(-1); }
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
.but {
  padding: 2 2px;
  font-size: 21px;
}
</style>

<div class="food" style="line-height:20px">
{name}{#if servings != undefined}, <b>{servings.toFixed(3)}</b> servings{/if} @ {mcg == undefined ? "unknown" : mcg} mcg/{unit}{#if use_notes}, {notes}{/if}
{#if use_total}= {#if use_grams}{(grams * servings).toFixed(3)}g {/if}<b>{(mcg * servings).toFixed(3)}</b> mcg{/if}{#if source}, {source} {/if}
{#if use_edit}<button on:click={edit}>edit</button>&nbsp{/if}
{#if use_dup}<button on:click={dup}>dup</button>&nbsp{/if}
<span style="font-size:100%; whitespace:nowrap; float:right;">
{#if use_del}<button on:click={del} class="but">x</button>{/if}
{#if use_fav}<button on:click={fav} class="but">*</button>{/if}
{#if use_move}
<button on:click={up} class="but">^</button>
<button on:click={down} class="but">v</button>
{/if}
{#if use_dec} <button on:click={dec} class="but">&lt</button>{/if}
{#if use_inc} <button on:click={inc} class="but">&gt</button>{/if}
{#if use_add} <button on:click={inc} class="but">+</button>{/if}
</span>
</div>
