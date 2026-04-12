<script>
  import { onDestroy } from "svelte";
  import { page } from "$app/stores";
  import Nav from "../components/Nav.svelte";
  import { goto } from "$app/navigation";

  export let segment;

  // Custom swipe action to replace svelte-gestures
  function swipe(node, options = {}) {
    let touchstartX = 0;
    let startTime = 0;

    const { timeframe = 300, minSwipeDistance = 100, touchAction = "pan-y" } = options;

    node.style.touchAction = touchAction;

    function handleTouchStart(event) {
      touchstartX = event.touches[0].clientX;
      startTime = new Date().getTime();
    }

    function handleTouchEnd(event) {
      const touchendX = event.changedTouches[0].clientX;

      const elapsedTime = new Date().getTime() - startTime;
      if (elapsedTime > timeframe) {
        return;
      }

      const deltaX = touchendX - touchstartX;

      if (Math.abs(deltaX) > minSwipeDistance) {
        const direction = deltaX < 0 ? "left" : "right";
        node.dispatchEvent(new CustomEvent("swipe", { detail: { direction } }));
      }
    }

    node.addEventListener("touchstart", handleTouchStart, { passive: true });
    node.addEventListener("touchend", handleTouchEnd, { passive: true });

    return {
      destroy() {
        node.removeEventListener("touchstart", handleTouchStart);
        node.removeEventListener("touchend", handleTouchEnd);
      },
    };
  }

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
  use:swipe={{ timeframe: 300, minSwipeDistance: 100, touchAction: "pan-y" }}
  on:swipe={handle_swipe}
  style="height: 100%;"
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
