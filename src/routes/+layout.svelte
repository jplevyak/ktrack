<script>
  import { onDestroy } from "svelte";
  import { page } from "$app/stores";
  import Nav from "../components/Nav.svelte";
  import { swipe } from "svelte-gestures";
  import { goto } from "$app/navigation";

  export let segment;

  const unsubscribe = page.subscribe((value) => {
    segment = value.url.pathname.slice(1).split("/")[0];
  });
  onDestroy(unsubscribe);

  const segments = ["", "favorites", "search", "history", "about"];

  function handle_swipe(event) {
    if (event.detail.direction == "left") {
      let i = segments.indexOf(segment);
      if (i >= 0) {
        i += 1;
        if (i > 4) i = 0;
        goto("/" + segments[i]);
      }
    } else if (event.detail.direction == "right") {
      let i = segments.indexOf(segment);
      if (i >= 0) {
        i -= 1;
        if (i < 0) i = 4;
        goto("/" + segments[i]);
      }
    }
  }
</script>

<div
  use:swipe={{ timeframe: 300, minSwipeDistance: 100 }}
  on:swipe={handle_swipe}
>
  <Nav {segment} />

  <main>
    <slot />
  </main>
</div>

<style>
  main {
    position: relative;
    background-color: white;
    padding: 2em;
    margin: 0 auto;
    box-sizing: border-box;
  }
</style>
