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

export function make_today(days_ago = 0) {
  let the_date = new Date();
  return {
    updated: the_date.getTime(),
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
    items: [],
  };
}

export function make_historical_day(d, days_ago) {
  let the_date = new Date(d.year, d.month, d.date);
  the_date = new Date(the_date.getTime() - days_ago * 24 * 3600 * 1000);
  // Ensure that historical days do not overwrite actual history.
  let updated = new Date(
    the_date.getTime() - (days_ago + 2) * 24 * 3600 * 1000
  );
  return {
    updated: updated.getTime(),
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
    items: [],
  };
}

export function make_favorites() {
  return {
    updated: Date.now(),
    items: [],
  };
}

export function make_history() {
  return {
    updated: Date.now(),
    items: [],
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

export function limit_date(date, max_date) {
  if (max_date != undefined) {
    return Math.min(date, max_date);
  }
  return date;
}

// Merge the profile provided by the user on the server.
// max_date is unused because this function is not used on the client.
export function merge_profile(profile, update, unused_max_date = undefined) {
  profile = { ...profile }; // shallow copy
  profile.message = "";
  delete profile.authenticated;
  update.username = profile.username;
  update.authenticated = Date.now();
  update.updated = update.authenticated;
  if (profile.username == "" || profile.password == "") {
    update.message = "profile created, authenticated";
    return update;
  }
  if (
    update.password != "" &&
    update.old_password != "" &&
    update.old_password != undefined
  ) {
    if (update.old_password != profile.password) {
      profile.message = "old password mismatch, not authenticated";
      profile.updated = Date.now();
      return profile;
    }
    update.message = "new password saved, authenticated";
    return update;
  }
  if (profile.password == update.password) {
    update.message = "profile in sync, authenticated";
    return update;
  }
  profile.message = "incorrect password, not authenticated";
  profile.updated = Date.now();
  return profile;
}

// merge base and update, set the updated to be the greater and update if the output is different than base.
// max_date is set only on the server to prevent clients who are ahead in time from setting updates in the future.
export function merge_items(base, update, max_date = undefined) {
  var d = { items: [], updated: base.updated };
  if (update.updated != undefined) {
    update.updated = limit_date(update.updated, max_date);
    if (update.updated > base.updated) {
      d.updated = update.updated;
    }
  }
  var changed = false;
  var all = new Set();
  for (let x of base.items) {
    if (all.has(x.name)) continue;
    all.add(x.name);
    var found = false;
    for (let y of update.items) {
      if (x.name == y.name) {
        found = true;
        if (x.updated >= y.updated) {
          d.items.push(x);
        } else {
          changed = true;
          d.items.push(y);
        }
        break;
      }
    }
    if (!found) {
      d.items.push(x);
    }
  }
  for (let x of update.items) {
    if (all.has(x.name)) continue;
    all.add(x.name);
    var found = false;
    for (let y of d.items)
      if (x.name == y.name) {
        found = true;
        continue;
      }
    if (!found) {
      changed = true;
      d.items.push(x);
    }
  }
  if (changed || d.updated == undefined) {
    d.updated = limit_date(Date.now(), max_date);
  }
  return d;
}

// merge base and update, set the updated to be the greater and update if the output is different than base.
// max_date is set only on the server to prevent clients who are ahead in time from setting updates in the future.
export function merge_day(base, update, max_date = undefined) {
  let c = compare_date(base, update);
  if (c > 0) return base;
  if (c < 0) return update;
  let d = merge_items(base, update, max_date);
  d.year = base.year;
  d.month = base.month;
  d.date = base.date;
  d.day = base.day;
  return d;
}

function date_key(i) {
  return new Date(i.year, i.month, i.date).getTime();
}

// merge base and update, set the updated time be the greater and update if the output is different than base.
// only merge the most recent month.
// max_date is set only on the server to prevent clients who are ahead in time from setting updates in the future.
export function merge_history(base, update, max_date = undefined) {
  var updated = base.updated;
  if (update.updated != undefined) {
    update.updated = limit_date(update.updated, max_date);
  }
  if (updated == undefined || update.updated > updated) {
    updated = update.updated;
  }
  var changed = false;
  var map = new Map();
  for (let x of base.items) map.set(date_key(x), x);
  for (let y of update.items.slice(0, merge_history_limit)) {
    var k = date_key(y);
    var x = map.get(k);
    if (x == undefined) {
      map.set(k, y);
      changed = true;
    } else {
      var m = merge_day(x, y);
      if (m.updated != x.updated) {
        map.set(k, m);
        changed = true;
      }
    }
  }
  map = new Map([...map.entries()].sort().reverse()); // sort
  var l = {
    items: [...map.values()],
    updated: updated,
  };
  if (changed || l.updated == undefined) {
    l.updated = limit_date(Date.now(), max_date);
  }
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
