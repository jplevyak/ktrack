<script>
  import { onDestroy } from 'svelte';
  import { page } from '$app/stores'
	import Nav from '../components/Nav.svelte';

	export let segment;

  const unsubscribe = page.subscribe(value => { segment = value.url.pathname.slice(1); });
  onDestroy(unsubscribe);
</script>

<style>
	main {
		position: relative;
		background-color: white;
		padding: 2em;
		margin: 0 auto;
		box-sizing: border-box;
	}
</style>

<Nav {segment}/>

<main>
	<slot></slot>
</main>
