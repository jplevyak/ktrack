<script>
  export let segment;
</script>

<nav class="nav-container">
  <ul class="nav-list">
    <li>
      <a class="nav-link" aria-current={segment === "" ? "page" : undefined} href=".">Day</a>
    </li>
    <li>
      <a
        class="nav-link"
        aria-current={segment === "favorites" ? "page" : undefined}
        href="/favorites">Favorites</a
      >
    </li>
    <li>
      <a class="nav-link" aria-current={segment === "search" ? "page" : undefined} href="/search"
        >Search</a
      >
    </li>
    <li>
      <a class="nav-link" aria-current={segment === "history" ? "page" : undefined} href="/history"
        >History</a
      >
    </li>
    <li>
      <a class="nav-link" aria-current={segment === "about" ? "page" : undefined} href="/about"
        >KTrack</a
      >
    </li>
  </ul>
</nav>

<style>
  .nav-container {
    width: 100%;
    max-width: 800px;
    margin: 0 auto;
    padding: 0 var(--spacing-md);
  }

  .nav-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .nav-link {
    display: block;
    padding: var(--spacing-md) var(--spacing-sm);
    text-decoration: none;
    color: var(--color-text-secondary);
    font-weight: 500;
    position: relative;
    font-size: var(--font-size-base);
    transition: color var(--transition-fast);
  }

  .nav-link:hover {
    color: var(--color-primary);
  }

  .nav-link[aria-current="page"] {
    color: var(--color-primary);
  }

  .nav-link[aria-current="page"]::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: var(--spacing-sm);
    right: var(--spacing-sm);
    height: 3px;
    background-color: var(--color-primary);
    border-top-left-radius: 2px;
    border-top-right-radius: 2px;
  }

  /* Mobile adjustments */
  @media (max-width: 400px) {
    .nav-link {
      font-size: var(--font-size-sm);
      padding: var(--spacing-md) var(--spacing-xs);
    }
  }
</style>
