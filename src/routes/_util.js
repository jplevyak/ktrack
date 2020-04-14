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

export function compare_date(d1, d2) {
  if (d1.year > d2.year) return 1;
  if (d1.year < d2.year) return -1;
  if (d1.month > d2.month) return 1;
  if (d1.month < d2.month) return -1;
  if (d1.date > d2.date) return 1;
  if (d1.date < d2.date) return -1;
  return 0;
};

export function get_total(day) {
  let n = 0.0;
  for (let f of day.items) {
    if (f.mcg != undefined) {
      n += f.mcg * f.servings;
    }
  }
  return n;
}

export function load_async(url, callback, options = { async: true, defer: true }) {
  const tag = document.createElement('script')
  tag.src = url;
  tag.async = options.async;
  tag.defer = options.defer;
  tag.onload = callback;
  document.body.appendChild(tag)
}

export function make_today() {
  let the_date = new Date();
  return {
    updated: Date.now(),
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
    items: []
  };
};

export function make_favorites() {
  return {
    updated: Date.now(),
    items: []
  }
}

export function make_history() {
  return {
    updated: Date.now(),
    items: []
  }
}

export function make_profile() {
  return {
    username: "",
    password: "",
    old_password: "",
    message: "unauthenticated"
  }
}

export function merge_profile(l1, l2) {
  l1 = {...l1}; // shallow copy
  l1.message = "";
  l1.message = "";
  delete l1.authenticated;
  delete l2.authenticated;
  l2.username = l1.username;
  if (l1.username == "" || l1.password == "") {
    l2.message = "profile created, authenticated";
    l2.authenticated = Date.now();
    l2.updated = Date.now();
    return l2;
  }
  if (l2.password != "" && l2.old_password != "" && l2.old_password != undefined) {
    if (l2.old_password != l1.password) {
      l1.message = "old password mismatch, not authenticated";
      l1.updated = Date.now();
      return l1;
    }
    l2.message = "new password saved, authenticated";
    l2.authenticated = Date.now();
    l2.updated = Date.now();
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

// merge l1 and l2, set the updated to be the greater and update if the output is different than l1.
export function merge_items(l1, l2) {
  var l = {
    items: [],
    updated: l1.updated
  }
  if (l2.updated != undefined && l2.updated > l1.updated) {
    l.updated = l2.updated;
  }
  var changed = false;
  var all = new Set();
  for (let x of l1.items) {
    if (all.has(x.name))
      continue;
    all.add(x.name)
    var found = false
    for (let y of l2.items) {
      if (x.name == y.name) {
        found = true;
        if (x.updated >= y.updated) {
          l.items.push(x);
        } else {
          changed = true;
          l.items.push(y);
        }
        break;
      }
    }
    if (!found) {
      l.items.push(x);
    }
  }
  for (let x of l2.items) {
    if (all.has(x.name))
      continue;
    all.add(x.name)
    var found = false;
    for (let y of l.items)
      if (x.name == y.name) {
        found = true;
        continue;
      }
    if (!found) {
      changed = true;
      l.items.push(x);
    }
  }
  if (changed || l.updated == undefined) {
    console.log("changed", changed, l.updated);
    l.updated = Date.now();
  }
  return l;
}

export function merge_day(l1, l2) {
  let c = compare_date(l1, l2);
  if (c > 0)
    return l1;
  if (c < 0)
    return l2;
  let t = merge_items(l1, l2);
  t.year = l1.year;
  t.month = l1.month;
  t.date = l1.date;
  t.day = l1.day;
  return t;
}

export function cleanup_history(h) {
  // remove duplicates
  for (let i in h.items) {
    for (let j in h.items) {
      if (h.items[j].year == undefined)
        console.log("bad dup", h);
      if (i != j && compare_date(h.items[i], h.items[j]) == 0)
        h.items.splice(j, 1);
    }
  }
  for (let i in h.items)
    if (h.items[i].year == undefined)
      h.items.splice(i, 1);
  return h;
}

// merge l1 and l2, set the updated t  be the greater and update if the output is different than l1.
// only merge the most recent month.
export function merge_history(l1, l2) {
  var l = {
    items: [],
    updated: l1.updated,
  }
  if (l2.updated != undefined && (l1.updated == undefined || l2.updated > l1.updated)) {
    l.updated = l2.updated;
  }
  var changed = false;
  for (let x of l1.items) {
    var found = false
    for (let y of l2.items.slice(0, merge_history_limit)) {
      if (compare_date(x, y) == 0) {
        found = true;
        let m = merge_day(x, y);
        if (m.updated != x.updated) {
          console.log("m1", m, x);
          changed = true;
        }
        l.items.push(m);
        break;
      }
    }
    if (!found) {
      l.items.push(x);
    }
  }
  for (let x of l2.items.slice(0, merge_history_limit)) {
    var found = false;
    for (let y of l.items)
      if (compare_date(x, y) ==  0) {
        found = true;
        continue;
      }
    if (!found) {
      console.log("m2", x);
      changed = true;
      l.items.push(x);
    }
  }
  if (changed || l.updated == undefined) {
    console.log("merge_history", changed, l.updated);
    l.updated = Date.now();
  }
  cleanup_history(l);
  console.log("1", l);
  l.items.sort((x, y) => compare_date(y, x));
  console.log("2", l);
  return l;
}
