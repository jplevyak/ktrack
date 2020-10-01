<script>
import { onMount, onDestroy } from 'svelte';
import { reset_data, profile_store, save_profile, today_store, backup_today, favorites_store, backup_favorites, history_store, backup_history } from '../_stores.js';
import { make_profile } from '../_util.js';

const about = [
	{
		title: 'What is KTrack',
		slug: 'what-is-ktrack',
  },
	{
		title: 'FAQ',
		slug: 'faq',
  },
	{
		title: 'Credits',
		slug: 'credits',
  },
];

var profile = undefined;
let today = undefined;
let favorites = undefined;
let history = undefined;

const unsubscribe_profile = profile_store.subscribe(p => {
  if (p == undefined)
    p = make_profile();
  profile = p;
});
const unsubscribe_today = today_store.subscribe(d => { today = d; });
const unsubscribe_favorites = favorites_store.subscribe(f => { favorites = f; });
const unsubscribe_history = history_store.subscribe(h => { history = h; });
onDestroy(() => { unsubscribe_today(); unsubscribe_favorites(); unsubscribe_history(); unsubscribe_profile(); });

function clear_data() {
  let answer = confirm("Do you really want to delete all the local data? ");
  if (!answer)
    return;
  reset_data();
}

function force_sync() {
  backup_today(today, profile, true);
  backup_favorites(favorites, profile, true);
  backup_history(history, profile, true);
  today = today;
  favorites = favorites;
  history = history;
}

onMount(() => {
  let username_input = document.getElementById("username");
  let password_input = document.getElementById("password");
  let old_password_input = document.getElementById("old_password");
  let save = document.getElementById("save");
  function changed() {
    if (profile == undefined)
      return;
    if (username_input.value != profile.username || password_input.value != profile.password) {
      profile.username = username_input.value;
      profile.password = password_input.value;
      profile.old_password = old_password_input.value;
      profile.updated = Date.now();
      save_profile(profile);
    }
  }
  save.onclick = changed;
  document.getElementById("reset").onclick = clear_data;
  document.getElementById("sync").onclick = force_sync;
})

</script>

<style>
	ul {
		margin: 0 0 1em 0;
		line-height: 1.5;
	}
</style>

<svelte:head>
	<title>KTrack</title>
</svelte:head>

<h1>About KTrack</h1>

<ul>
	{#each about as a}
  <li><a href=about/{a.slug}>{a.title}</a></li>
	{/each}
</ul>

<h1>Profile</h1>
Add username and password to store data on the ktrack server. Users concerned about privacy should run their own server.  Contact server administration if the password is lost.
<br>
<br>
{#if profile != undefined}
Status: <b>{profile.message}</b><br>
Username: <input type="text" id="username" value="{profile.username}" /><br>
Password: <input type="password" id="password"value="{profile.password}" /><br>
Old Password (when updating Password) <input type="text" id="old_password"value="{profile.old_password}" /><br>
<button type="button" id="save">Login/Save</button>
{/if}
<input type="button" id="reset" value="Reset All Data"/>
<input type="button" id="sync" value="Force Sync All Data"/>
<br><br>
Today
<ul>
<li>Server Check Time: {today.server_checked ? new Date(today.server_checked).toString() : "unsynced"}</li>
<li>Server Sync Time: {today.server_synced ? new Date(today.server_synced).toString() : "unsynced"}</li>
</ul>
Favorites
<ul>
<li>Server Check Time: {favorites.server_checked ? new Date(favorites.server_checked).toString() : "unsynced"}</li>
<li>Server Sync Time: {favorites.server_synced ? new Date(favorites.server_synced).toString() : "unsynced"}</li>
</ul>
History
<ul>
<li>Server Check Time: {history.server_checked ? new Date(history.server_checked).toString() : "unsynced"}</li>
<li>Server Sync Time: {history.server_synced ? new Date(history.server_synced).toString() : "unsynced"}</li>
</ul>
