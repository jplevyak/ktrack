<svelte:head>
  <title>KTrack - What is KTrack</title>
</svelte:head>

<div class="subpage-container">
  <div class="mb-md">
    <a href="/about" class="btn btn-outline inline-flex items-center gap-xs">
      <span class="text-lg">‹</span> Back
    </a>
  </div>

  <div class="card">
    <h1 class="text-xl font-bold mb-md">What is KTrack</h1>

    <p class="mb-sm">KTrack is a tool to help track your Vitamin K intake.</p>
    <p class="mb-md">
      It provides a collection of data from public sources (e.g. the US Department of Agriculture)
      about the estimated amount of Vitamin K in various foods.
    </p>

    <div class="p-sm bg-gray-50 border-l-4 border-amber-500 mb-md text-sm">
      <p class="font-bold text-amber-900">Disclaimer</p>
      <p class="italic text-amber-800">
        If used for medical purposes, users must verify any estimates and treatments with their
        physician.
      </p>
    </div>

    <p class="mb-sm font-medium">Features include:</p>
    <ul class="list-disc pl-md">
      <li>Record Daily intake.</li>
      <li>Store historical intake data.</li>
      <li>Search the data of foods.</li>
      <li>Add custom foods.</li>
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
  .p-sm {
    padding: var(--spacing-sm);
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
  .text-sm {
    font-size: 0.875rem;
  }

  .font-bold {
    font-weight: 700;
  }
  .font-medium {
    font-weight: 500;
  }
  .italic {
    font-style: italic;
  }

  .bg-gray-50 {
    background-color: #f9fafb;
  }
  .border-l-4 {
    border-left-width: 4px;
  }
  .border-amber-500 {
    border-color: #f59e0b;
  }
  .text-amber-900 {
    color: #78350f;
  }
  .text-amber-800 {
    color: #92400e;
  }

  .list-disc {
    list-style-type: disc;
  }

  .inline-flex {
    display: inline-flex;
  }
  .items-center {
    align-items: center;
  }
</style>
