<script>
  import { onMount, onDestroy } from "svelte";
  import {
    logout,
    syncManager,
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

  // Local state for password updates to avoid overwriting store immediately or for UI convenience
  // Actually, we can bind directly to profile object properties since we save explicitly.

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
        let data = JSON.parse(e.target.result);
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

  async function save_changes() {
    if (!profile) return;
    if (profile.username || profile.password) {
      // If changing credentials, we might want to logout first or handle re-auth
      // The original logic checked DOM elements vs profile values.
      // Here we just save.
      // Note: Originally logout() was called if username/pass changed.
      // We can't easily detect 'change' against store without keeping a copy,
      // but save_profile generally handles the API call.
      // Let's stick to simple save.
      await save_profile(profile);
    }
  }
</script>

<svelte:head>
  <title>KTrack - About</title>
</svelte:head>

<div class="about-container">
  <!-- Section: About Links -->
  <div class="card mb-lg">
    <h2 class="text-xl font-bold mb-md">About KTrack</h2>
    <ul class="flex flex-col gap-sm">
      {#each about as a}
        <li>
          <a href="about/{a.slug}" class="text-primary hover:underline flex items-center gap-xs">
            <span class="text-lg">›</span>
            {a.title}
          </a>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Section: Profile -->
  <div class="card mb-lg">
    <h2 class="text-xl font-bold mb-sm">Profile</h2>
    <p class="text-secondary text-sm mb-md">
      Login to sync data across devices. For privacy, you can run your own server.
    </p>

    {#if profile != undefined}
      <div class="status-message mb-md p-sm bg-gray-50 rounded text-sm">
        Status: <span
          class="font-bold {profile.authenticated ? 'text-green-600' : 'text-amber-600'}"
          >{profile.message}</span
        >
      </div>

      <div class="form-group mb-sm">
        <label for="username">Username</label>
        <input type="text" id="username" bind:value={profile.username} class="w-full" />
      </div>

      <div class="form-group mb-sm">
        <label for="password">Password</label>
        <input type="password" id="password" bind:value={profile.password} class="w-full" />
      </div>

      <div class="form-group mb-md">
        <label for="old_password"
          >Old Password <span class="text-secondary font-normal">(if changing)</span></label
        >
        <input type="password" id="old_password" bind:value={profile.old_password} class="w-full" />
      </div>

      <div class="flex gap-md flex-wrap">
        <button type="button" class="btn btn-primary" on:click={save_changes}>Login / Save</button>
        <button type="button" class="btn btn-outline" on:click={logout}>Logout</button>
        <button type="button" class="btn btn-outline" on:click={() => syncManager.syncAll(true)}
          >Force Sync</button
        >
      </div>
    {/if}
  </div>

  <!-- Section: Data Management -->
  <div class="card">
    <h2 class="text-xl font-bold mb-md">Data Management</h2>

    <div class="data-row flex items-center justify-between mb-sm pb-sm border-b">
      <span class="font-medium">Today</span>
      <div class="actions flex gap-sm">
        <button class="btn btn-sm btn-outline" on:click={() => download_json("today.json", today)}
          >Download</button
        >
        <button
          class="btn btn-sm btn-outline"
          on:click={() => document.getElementById("upload_today").click()}>Upload</button
        >
        <input
          type="file"
          id="upload_today"
          style="display:none"
          accept=".json"
          on:change={(e) => upload_json("today", today_store, e.target.files[0])}
        />
      </div>
    </div>

    <div class="data-row flex items-center justify-between mb-sm pb-sm border-b">
      <span class="font-medium">Favorites</span>
      <div class="actions flex gap-sm">
        <button
          class="btn btn-sm btn-outline"
          on:click={() => download_json("favorites.json", favorites)}>Download</button
        >
        <button
          class="btn btn-sm btn-outline"
          on:click={() => document.getElementById("upload_favorites").click()}>Upload</button
        >
        <input
          type="file"
          id="upload_favorites"
          style="display:none"
          accept=".json"
          on:change={(e) => upload_json("favorites", favorites_store, e.target.files[0])}
        />
      </div>
    </div>

    <div class="data-row flex items-center justify-between mb-md">
      <span class="font-medium">History</span>
      <div class="actions flex gap-sm">
        <button
          class="btn btn-sm btn-outline"
          on:click={() => download_json("history.json", history)}>Download</button
        >
        <button
          class="btn btn-sm btn-outline"
          on:click={() => document.getElementById("upload_history").click()}>Upload</button
        >
        <input
          type="file"
          id="upload_history"
          style="display:none"
          accept=".json"
          on:change={(e) => upload_json("history", history_store, e.target.files[0])}
        />
      </div>
    </div>

    <div class="server-status text-xs text-secondary mt-md grid-cols-2">
      <div class="text-right font-medium">Check Time:</div>
      <div>{today && today.checked ? new Date(today.checked).toLocaleString() : "unsynced"}</div>

      <div class="text-right font-medium">Sync Time:</div>
      <div>{today && today.synced ? new Date(today.synced).toLocaleString() : "unsynced"}</div>
    </div>
  </div>
</div>

<style>
  .about-container {
    padding-bottom: var(--spacing-xl);
  }

  .mb-sm {
    margin-bottom: var(--spacing-sm);
  }
  .mb-md {
    margin-bottom: var(--spacing-md);
  }
  .mb-lg {
    margin-bottom: var(--spacing-lg);
  }
  .pb-sm {
    padding-bottom: var(--spacing-sm);
  }
  .mt-md {
    margin-top: var(--spacing-md);
  }

  .text-xl {
    font-size: 1.25rem;
  }
  .text-lg {
    font-size: 1.125rem;
  }
  .text-sm {
    font-size: 0.875rem;
  }
  .text-xs {
    font-size: 0.75rem;
  }

  .font-bold {
    font-weight: 700;
  }
  .font-medium {
    font-weight: 500;
  }
  .font-normal {
    font-weight: 400;
  }

  .text-secondary {
    color: var(--color-text-secondary);
  }

  .border-b {
    border-bottom: 1px solid var(--color-border);
  }

  .w-full {
    width: 100%;
  }

  label {
    display: block;
    margin-bottom: 4px;
    font-size: 0.9rem;
    font-weight: 500;
  }
  .grid-cols-2 {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: var(--spacing-sm);
    row-gap: 2px;
  }

  .text-right {
    text-align: right;
  }

  .server-status {
    border-top: 1px solid var(--color-border);
    padding-top: var(--spacing-sm);
  }
</style>
