export function writable(value, start) {
  let subscribers = [];
  let stop = null;

  function set(newValue) {
    value = newValue;
    subscribers.forEach((run) => run(value));
  }

  function update(fn) {
    set(fn(value));
  }

  function subscribe(run) {
    subscribers.push(run);
    run(value);
    if (start && subscribers.length === 1) {
      stop = start(set);
    }
    return () => {
      subscribers = subscribers.filter((s) => s !== run);
      if (stop && subscribers.length === 0) {
        stop();
        stop = null;
      }
    };
  }

  return { set, update, subscribe };
}

export function readable(value, start) {
  return writable(value, start);
}

export function get(store) {
  let value;
  store.subscribe((v) => (value = v))();
  return value;
}
