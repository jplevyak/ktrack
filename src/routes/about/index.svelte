<script>
import { onMount, onDestroy } from 'svelte';
import { reset_data, profile_store, save_profile } from '../_stores.js';
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

const unsubscribe_profile = profile_store.subscribe(p => {
  if (p == undefined)
    p = make_profile();
  profile = p;
});
onDestroy(unsubscribe_profile);

function clear_data() {
  let answer = confirm("Do you really want to delete all the local data? ");
  if (!answer)
    return;
  reset_data();
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
