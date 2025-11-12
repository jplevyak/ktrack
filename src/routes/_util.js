import foods from "./_foods.json";
import { CollabJSON } from './_crdt.js';

export const merge_history_limit = 50;

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

function _get_date_info(day) {
    if (!day || !day.getData) return null;
    const items = day.getData();
    if (!items || items.length === 0) return null;
    // Assume date info is an item that has a 'year' property and no 'mcg' property.
    return items.find(item => typeof item.year !== 'undefined' && typeof item.mcg === 'undefined');
}

export function compare_date(d1, d2) {
  const d1_info = _get_date_info(d1);
  const d2_info = _get_date_info(d2);

  if (!d1_info || !d2_info) {
    if (d1_info === d2_info) return 0;
    return d1_info ? 1 : -1;
  }

  if (d1_info.year > d2_info.year) return 1;
  if (d1_info.year < d2_info.year) return -1;
  if (d1_info.month > d2_info.month) return 1;
  if (d1_info.month < d2_info.month) return -1;
  if (d1_info.date > d2_info.date) return 1;
  if (d1_info.date < d2_info.date) return -1;
  return 0;
}

export function get_total(day) {
  let n = 0.0;
  if (!day || !day.getData) return n;
  for (let f of day.getData()) {
    if (f.del == undefined && f.mcg != undefined) {
      n += f.mcg * f.servings;
    }
  }
  return n;
}

export function get_total_fiber(day) {
  let n = 0.0;
  let unknown = false;
  if (!day || !day.getData) return [n, unknown];
  for (let f of day.getData()) {
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

export function make_today() {
  let the_date = new Date();
  const doc = new CollabJSON();
  doc.addItem([0], {
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
  });
  return doc;
}

export function make_historical_day(d, days_ago) {
  const d_info = _get_date_info(d);
  if (!d_info) {
    // Cannot create a historical day from a document without date info.
    // Return an empty doc as a fallback.
    return new CollabJSON();
  }
  let the_date = new Date(d_info.year, d_info.month, d_info.date);
  the_date = new Date(the_date.getTime() - days_ago * 24 * 3600 * 1000);
  const doc = new CollabJSON();
  doc.addItem([0], {
    year: the_date.getFullYear(),
    month: the_date.getMonth(),
    date: the_date.getDate(),
    day: the_date.getDay(),
  });
  return doc;
}

export function make_favorites() {
  return new CollabJSON();
}

export function make_history() {
  return new CollabJSON();
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

export function date_key(i) {
  const date_info = _get_date_info(i);
  if (!date_info) return 0;
  return new Date(date_info.year, date_info.month, date_info.date).getTime();
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
