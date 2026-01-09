<script>
  import { onDestroy } from "svelte";
  import { page } from "$app/stores";
  import Nav from "../components/Nav.svelte";
  import { goto } from "$app/navigation";
  import "../app.css";

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
  class="app-container"
  use:swipe={{ timeframe: 300, minSwipeDistance: 100, touchAction: "pan-y" }}
  on:swipe={handle_swipe}
>
  <header class="app-header">
    <Nav {segment} />
  </header>

  <main class="app-content">
    <slot />
  </main>
</div>

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    background-color: var(--color-background);
  }

  .app-header {
    background-color: var(--color-surface);
    box-shadow: var(--shadow-sm);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .app-content {
    flex: 1;
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
    padding: var(--spacing-md);
    box-sizing: border-box;
  }
</style>
