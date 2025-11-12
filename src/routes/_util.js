import foods from "./_foods.json";
import { CollabArray } from './_crdt.js';

export const merge_history_limit = 10;

export const weekdays = new Array(7);
weekdays[0] = "Sunday";
weekdays[1] = "Monday";
weekdays[2] = "Tuesday";
weekdays[3] = "Wednesday";
weekdays[4] = "Thursday";
weekdays[5] = "Friday";
weekdays[6] = "Saturday";

export const months = new Array(12);
months[0] = "January";
months[1] = "February";
months[2] = "March";
months[3] = "April";
months[4] = "May";
months[5] = "June";
months[6] = "July";
months[7] = "August";
months[8] = "September";
months[9] = "October";
months[10] = "November";
months[11] = "December";

var name2food = {};

for (let f in foods) {
  name2food[foods[f].name] = f;
}

export function compare_date(d1, d2) {
  if (d1.year > d2.year) return 1;
  if (d1.year < d2.year) return -1;
  if (d1.month > d2.month) return 1;
  if (d1.month < d2.month) return -1;
  if (d1.date > d2.date) return 1;
  if (d1.date < d2.date) return -1;
  return 0;
}

export function get_total(day) {
  let n = 0.0;
  for (let f of day.items) {
    if (f.del == undefined && f.mcg != undefined) {
      n += f.mcg * f.servings;
    }
  }
  return n;
}

export function get_total_fiber(day) {
  let n = 0.0;
  let unknown = false;
  for (let f of day.items) {
    if (f.del == undefined && f.mcg != undefined) {
      if (f.hasOwnProperty('fiber') && f.fiber != "") {
          n += f.fiber * f.servings;
      } else {
        unknown = true;
      }
    }
  }
  return [n, unknown];
}

export function load_async(
  url,
  callback,
  options = {
    async: true,
    defer: true,
  }
) {
  const tag = document.createElement("script");
  tag.src = url;
  tag.async = options.async;
  tag.defer = options.defer;
  tag.onload = callback;
  document.body.appendChild(tag);
}

function get_updated_time(the_time, reset) {
  if (!reset) {
     // It was updated a long time in the past (so that it will not overwrite anything on the server.
     return the_time - 1000 * 24 * 3600 * 1000;
  } else {
     // It was updated now so that it will overwrite the server data.
     return the_time;
  }
}

export function make_today() {
  let the_date = new Date();
  let items = new CollabArray();
  return {
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
    items,
    updated: items.clock,
    synced: 0,
  };
}

export function make_historical_day(d, days_ago) {
  let the_date = new Date(d.year, d.month, d.date);
  the_date = new Date(the_date.getTime() - days_ago * 24 * 3600 * 1000);
  let items = new CollabArray();
  return {
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
    items,
    updated: items.clock,
    synced: 0,
  };
}

export function make_favorites() {
  let items = new CollabArray();
  return {
    items,
    updated: items.clock,
    synced: 0,
  };
}

export function make_history() {
  let the_date = new Date();
  return {
    items,
    updated: items.clock,
    synced: 0,
  };
}

export function make_profile() {
  return {
    username: "",
    password: "",
    old_password: "",
    message: "unauthenticated",
  };
}

export function merge_profile(l1, l2) {
  l1 = { ...l1 }; // shallow copy
  l1.message = "";
  delete l1.authenticated;
  l2.username = l1.username;
  l2.authenticated = Date.now();
  l2.updated = l2.authenticated;
  if (l1.username == "" || l1.password == "") {
    l2.message = "profile created, authenticated";
    return l2;
  }
  if (
    l2.password != "" &&
    l2.old_password != "" &&
    l2.old_password != undefined
  ) {
    if (l2.old_password != l1.password) {
      l1.message = "old password mismatch, not authenticated";
      l1.updated = Date.now();
      return l1;
    }
    l2.message = "new password saved, authenticated";
    return l2;
  }
  if (l1.password == l2.password) {
    l2.message = "profile in sync, authenticated";
    return l2;
  }
  l1.message = "incorrect password, not authenticated";
  l1.updated = Date.now();
  return l1;
}

// merge d2 ops into d1
export function merge_items(d, ops) {
  for (op in ops) {
    d.items.applyOp(op);
    d.synced = Math.max(d1.synced, op.timestamp);
  }
  d1.updated = d.items.clock;
}

export function merge_day(d1, d2) {
  let c = compare_date(d1, d2);
  if (c > 0) return d1;
  if (c < 0) return d2;
  let d = merge_items(d1, d2);
  d.year = d1.year;
  d.month = d1.month;
  d.date = d1.date;
  d.day = d1.day;
  return d;
}

function date_key(i) {
  return new Date(i.year, i.month, i.date).getTime();
}

// merge only the most recent month.
export function merge_history(l1, l2) {
  var updated = l1.updated > l2.updated ? l1.updated : l2.updated;
  var changed = false;
  var map = new Map();
  for (let x of l1.items)
    map.set(date_key(x), x);
  for (let y of l2.items.slice(0, merge_history_limit)) {
    var k = date_key(y);
    var x = map.get(k);
    if (x == undefined) {
      map.set(k, y);
      changed = true;
    } else {
      var m = merge_day(x, y);
      if (m.items.clock != x.items.clock) {
        map.set(k, m);
        changed = true;
        updated = Math.max(updated, m.items.clock);
      }
    }
  }
  map = new Map([...map.entries()].sort().reverse()); // sort
  var l = {
    items: [...map.values()],
    updated: updated,
    synced: l2.updated;
  };
  return l;
}

export function compute_averages(h) {
  var result = [0, 0, 0];
  if (h == undefined) return result;
  var a = 0.0;
  var n = 0;
  for (let i in h.items) {
    a += get_total(h.items[i]);
    n += 1;
    if (n > 1 && n % 2 == 1) {
      result[(n - 3) / 2] = a / n;
    }
    if (n >= 7) break;
  }
  return result;
}
