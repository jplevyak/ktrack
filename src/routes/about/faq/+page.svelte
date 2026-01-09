<svelte:head>
  <title>KTrack - FAQ</title>
</svelte:head>

<div class="subpage-container">
  <div class="mb-md">
    <a href="/about" class="btn btn-outline inline-flex items-center gap-xs">
      <span class="text-lg">‹</span> Back
    </a>
  </div>

  <div class="card">
    <h1 class="text-xl font-bold mb-md">FAQ</h1>

    <h3 class="text-lg font-bold mb-sm">What does "mcg/unit" mean?</h3>
    <p>
      The USDA differentiates between true measures (i.e. a cup of water) and nominal measures (a
      cup of loose leaves). When the measure is not a true measure, the mcg amount is listed as
      "mcg/unit" while the description contains the measure (e.g. 1 cup).
    </p>
  </div>
</div>

<style>
  .subpage-container {
    padding-bottom: var(--spacing-xl);
  }

  .mb-sm {
    margin-bottom: var(--spacing-sm);
  }
  .mb-md {
    margin-bottom: var(--spacing-md);
  }

  .text-xl {
    font-size: 1.25rem;
  }
  .text-lg {
    font-size: 1.125rem;
  }

  .font-bold {
    font-weight: 700;
  }

  .inline-flex {
    display: inline-flex;
  }
  .items-center {
    align-items: center;
  }
</style>
