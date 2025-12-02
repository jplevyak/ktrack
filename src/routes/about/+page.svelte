<script>
  import { onMount, onDestroy } from "svelte";
  import {
    logout,
    profile_store,
    save_profile,
    today_store,
    favorites_store,
    history_store,
  } from "../_stores.js";
  import { make_profile } from "../_util.js";

  const about = [
    {
      title: "What is KTrack",
      slug: "what-is-ktrack",
    },
    {
      title: "FAQ",
      slug: "faq",
    },
    {
      title: "Credits",
      slug: "credits",
    },
  ];

  var profile = undefined;
  let today = undefined;
  let favorites = undefined;
  let history = undefined;

  const unsubscribe_profile = profile_store.subscribe((p) => {
    if (p == undefined) p = make_profile();
    profile = p;
  });
  const unsubscribe_today = today_store.subscribe((d) => {
    today = d;
  });
  const unsubscribe_favorites = favorites_store.subscribe((f) => {
    favorites = f;
  });
  const unsubscribe_history = history_store.subscribe((h) => {
    history = h;
  });
  onDestroy(() => {
    unsubscribe_today();
    unsubscribe_favorites();
    unsubscribe_history();
    unsubscribe_profile();
  });

  function download_json(filename, data) {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.getData(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function upload_json(name, store, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (profile && profile.username && profile.password) {
          const credentials = btoa(`${profile.username}:${profile.password}`);
          const response = await fetch(`/api/${name}`, {
            method: "PUT",
            headers: {
              Authorization: `Basic ${credentials}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
          });
          if (response.ok) {
            store.sync();
          } else {
            alert("Upload failed");
          }
        } else {
          store.update((doc) => {
            doc.updateItem([], data);
            return doc;
          });
        }
      } catch (error) {
        console.error("Error uploading JSON:", error);
        alert("Failed to upload JSON. Check console for details.");
      }
    };
    reader.readAsText(file);
  }

  onMount(async () => {
    let username_input = document.getElementById("username");
    let password_input = document.getElementById("password");
    let old_password_input = document.getElementById("old_password");
    let save = document.getElementById("save");
    async function changed() {
      if (profile == undefined) {
        console.log("profile undefined");
        return;
      }
      if (
        username_input.value != profile.username ||
        password_input.value != profile.password ||
        !profile.authenticated
      ) {
        if (profile.username || profile.password) {
          logout();
        }
        profile.username = username_input.value;
        profile.password = password_input.value;
        profile.old_password = old_password_input.value;
        await save_profile(profile);
      }
    }
    save.onclick = changed;
    document.getElementById("logout").onclick = logout;
  });
</script>

<svelte:head>
  <title>KTrack</title>
</svelte:head>

<h1>About KTrack</h1>

<ul>
  {#each about as a}
    <li><a href="about/{a.slug}">{a.title}</a></li>
  {/each}
</ul>

<h1>Profile</h1>
Add username and password to store data on the ktrack server. Users concerned about
privacy should run their own server. Contact server administration if the password
is lost.
<br />
<br />
{#if profile != undefined}
  Status: <b>{profile.message}</b><br />
  Username: <input type="text" id="username" value={profile.username} /><br />
  Password: <input type="password" id="password" value={profile.password} /><br
  />
  Old Password (when updating Password)
  <input type="text" id="old_password" value={profile.old_password} /><br />
  <button type="button" id="save">Login/Save</button>
{/if}
<input type="button" id="logout" value="Logout" />
<br /><br />
Today
<button on:click={() => download_json("today.json", today)}>Download</button>
<input
  type="file"
  id="upload_today"
  style="display:none"
  accept=".json"
  on:change={(e) => upload_json("today", today_store, e.target.files[0])}
/>
<button on:click={() => document.getElementById("upload_today").click()}
  >Upload</button
>
<button on:click={() => today_store.sync()}>Sync</button>
<ul>
  <li>
    Server Check Time: {today.checked
      ? new Date(today.checked).toString()
      : "unsynced"}
  </li>
  <li>
    Server Sync Time: {today.synced
      ? new Date(today.synced).toString()
      : "unsynced"}
  </li>
</ul>
Favorites
<button on:click={() => download_json("favorites.json", favorites)}
  >Download</button
>
<input
  type="file"
  id="upload_favorites"
  style="display:none"
  accept=".json"
  on:change={(e) => upload_json("favorites", favorites_store, e.target.files[0])}
/>
<button on:click={() => document.getElementById("upload_favorites").click()}
  >Upload</button
>
<button on:click={() => favorites_store.sync()}>Sync</button>
<ul>
  <li>
    Server Check Time: {favorites.checked
      ? new Date(favorites.checked).toString()
      : "unsynced"}
  </li>
  <li>
    Server Sync Time: {favorites.synced
      ? new Date(favorites.synced).toString()
      : "unsynced"}
  </li>
</ul>
History
<button on:click={() => download_json("history.json", history)}>Download</button
>
<input
  type="file"
  id="upload_history"
  style="display:none"
  accept=".json"
  on:change={(e) => upload_json("history", history_store, e.target.files[0])}
/>
<button on:click={() => document.getElementById("upload_history").click()}
  >Upload</button
>
<button on:click={() => history_store.sync()}>Sync</button>
<ul>
  <li>
    Server Check Time: {history.checked
      ? new Date(history.checked).toString()
      : "unsynced"}
  </li>
  <li>
    Server Sync Time: {history.synced
      ? new Date(history.synced).toString()
      : "unsynced"}
  </li>
</ul>

<style>
  ul {
    margin: 0 0 1em 0;
    line-height: 1.5;
  }
</style>
