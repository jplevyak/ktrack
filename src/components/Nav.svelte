<script>
	export let segment;


</script>

<style>
	nav {
		border-bottom: 1px solid rgba(255,62,0,0.1);
		font-weight: 500;
		padding: 0 1em;
    width: 100%;
    font-size: 3.2vmin;
	}

	ul {
		margin: 0;
		padding: 0;
	}

	/* clearfix */
	ul::after {
		content: '';
		display: block;
		clear: both;
	}

	li {
		display: block;
		float: left;
	}

	[aria-current] {
		position: relative;
		display: inline-block;
	}

	[aria-current]::after {
		position: absolute;
		content: '';
		width: calc(100% - 1em);
		height: 2px;
		background-color: rgb(255,62,0);
		display: block;
		bottom: -1px;
	}

	a {
		text-decoration: none;
		padding: 1em 0.5em;
		display: block;
	}
</style>

<nav>
	<ul>
		<li><a aria-current='{segment === undefined ? "page" : undefined}' href='.'>Today</a></li>
		<li><a aria-current='{segment === "favorites" ? "page" : undefined}' href='favorites'>Favorites</a></li>
		<li><a aria-current='{segment === "search" ? "page" : undefined}' href='search'>Search</a></li>
		<li><a aria-current='{segment === "history" ? "page" : undefined}' href='history'>History</a></li>
		<li><a aria-current='{segment === "about" ? "page" : undefined}' href='about'>KTrack</a></li>
	</ul>
</nav>
