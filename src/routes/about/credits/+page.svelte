<svelte:head>
  <title>KTrack - Credits</title>
</svelte:head>

<div class="subpage-container">
  <div class="mb-md">
    <a href="/about" class="btn btn-outline inline-flex items-center gap-xs">
      <span class="text-lg">‹</span> Back
    </a>
  </div>

  <div class="card">
    <h1 class="text-xl font-bold mb-md">Credits</h1>

    <p class="mb-lg">John Plevyak (jplevyak@gmail.com)</p>

    <h2 class="text-lg font-bold mb-sm">Data Sources, retrieved 2019-12-17</h2>
    <ul class="list-disc pl-md mb-lg">
      <li>
        EFSA: <a
          href="https://www.efsa.europa.eu/en/microstrategy/food-composition-data"
          class="text-primary hover:underline"
          >https://www.efsa.europa.eu/en/microstrategy/food-composition-data</a
        >
      </li>
      <li>
        McCance:
        <a
          href="https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid"
          class="text-primary hover:underline"
          >https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid</a
        >
      </li>
      <li>
        USDA: <a href="https://fdc.nal.usda.gov/FoodData" class="text-primary hover:underline"
          >https://fdc.nal.usda.gov/FoodData</a
        >
      </li>
    </ul>

    <h2 class="text-lg font-bold mb-sm">Code</h2>
    <ul class="list-disc pl-md">
      <li>
        Search: <a href="http://elasticlunr.com" class="text-primary hover:underline"
          >http://elasticlunr.com</a
        >
      </li>
      <li>
        Framework: <a href="https://svelte.dev" class="text-primary hover:underline"
          >https://svelte.dev</a
        >
      </li>
    </ul>
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
  .mb-lg {
    margin-bottom: var(--spacing-lg);
  }
  .pl-md {
    padding-left: var(--spacing-md);
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

  .list-disc {
    list-style-type: disc;
  }

  .text-primary {
    color: var(--color-primary);
  }
  .hover\:underline:hover {
    text-decoration: underline;
  }

  .inline-flex {
    display: inline-flex;
  }
  .items-center {
    align-items: center;
  }
</style>
