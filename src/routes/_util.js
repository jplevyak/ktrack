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

export function get_date_info(day) {
  // Accept both a day object and a CollabJSON day.
  if (!day.timestamp) {
    if (!day || !day.getData)
      return null;
    day = day.getData();
  }
  if (!day.timestamp)
    return null;
  let date = new Date(day.timestamp);
  return {
    day: date.getDay(),
    date: date.getDate(),
    month: date.getMonth(),
    year: date.getFullYear(),
  };
}

export function compare_date(d1, d2) {
  const d1_info = get_date_info(d1);
  const d2_info = get_date_info(d2);

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

export function date_key(i) {
  const date_info = get_date_info(i);
  if (!date_info) return 0;
  return new Date(date_info.year, date_info.month, date_info.date).getTime();
}

export function compute_averages(h) {
  var result = [0, 0, 0];
  if (h == undefined) return result;
  var a = 0.0;
  var n = 0;
  for (let i in h) {
    a += get_total(h[i]);
    n += 1;
    if (n > 1 && n % 2 == 1) {
      result[(n - 3) / 2] = a / n;
    }
    if (n >= 7) break;
  }
  return result;
}

export function get_total(day) {
  let n = 0.0;
  if (!day)
    return n;
  for (let f of day.items) {
    if (f.mcg != undefined) {
      n += f.mcg * f.servings;
    }
  }
  return n;
}

export function get_total_fiber(day) {
  let n = 0.0;
  let unknown = false;
  if (!day)
    return [n, unknown];
  for (let f of day.items) {
    if (f.mcg != undefined) {
      if (f.hasOwnProperty('fiber') && f.fiber != "") {
          n += f.fiber * f.servings;
      } else {
        unknown = true;
      }
    }
  }
  return [n, unknown];
}

export function make_today() {
  const doc = new CollabJSON("{}");
  doc.updateItem(['timestamp'], Date.now());
  doc.updateItem(['items'], []);
  return doc;
}

export function make_favorites() {
  return new CollabJSON("[]");
}

export function make_history() {
  return new CollabJSON("[]");
}

export function make_profile() {
  return {
    username: "",
    password: "",
    old_password: "",
    message: "unauthenticated",
  };
}

export function prune_today(server_doc, clientSyncRequest) {
  const client_day_temp = CollabJSON.fromSyncRequest(clientSyncRequest);
  if (!client_day_temp) {
    return;
  }

  let client_day_temp_data = client_day_temp.getData();
  if (!client_day_temp_data.timestamp) {
    return; // Client ops don't contain a valid timestamp, so do nothing.
  }

  let server_data = server_doc.getData();
  const server_has_date = !!server_data.timestamp;

  // If server has no date, or client's date is newer, overwrite server state.
  if (!server_has_date || compare_date(client_day_temp, server_doc) > 0) {
    // Reset the server document's state. 
    // getSyncResponse will then build the new state from the client's operations.
    server_doc.clear();
  }
}

export function prune_history(history_doc) {
  const limit = merge_history_limit;
  // getData() returns items sorted by their fractional index, which should reflect date order.
  const items = history_doc.getData();
  if (items.length > limit) {
    // We delete items from the 'limit' index onwards to remove the oldest entries.
    const to_delete = items.length - limit;
    for (let i = 0; i < to_delete; i++) {
      // Always delete the item at the `limit` index because the list shrinks after each deletion.
      history_doc.deleteItem([limit]);
    }
  }
}
