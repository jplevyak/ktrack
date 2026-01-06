import { CollabJSON } from "./_crdt.js";

export const merge_history_limit = 25;

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
  },
) {
  if (typeof document === "undefined") return;
  const tag = document.createElement("script");
  tag.src = url;
  tag.async = options.async;
  tag.defer = options.defer;
  tag.onload = callback;
  document.body.appendChild(tag);
}

export function get_date_info(day) {
  const parts = day.timestamp.split("-");
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10) - 1,
    date: parseInt(parts[2], 10),
    day: parseInt(parts[3], 10),
  };
}

export function compare_date(d1, d2) {
  const d1_timestamp = d1.getData(["timestamp"]);
  const d2_timestamp = d2.getData(["timestamp"]);

  if (d1_timestamp > d2_timestamp) return 1;
  if (d1_timestamp < d2_timestamp) return -1;
  return 0;
}

export function compute_averages(h) {
  var result = [0, 0, 0];
  var a = 0.0;
  var n = 0;
  for (let i = 0; i < 7; i++) {
    if (i < h.length && h[i]) a += get_total(h[i].items);
    n += 1;
    if (n > 1 && n % 2 == 1) {
      result[(n - 3) / 2] = a / n;
    }
  }
  return result;
}

export function get_total(items) {
  let n = 0.0;
  for (let f of items) {
    if (f.mcg != undefined) {
      n += f.mcg * f.servings;
    }
  }
  return n;
}

export function get_total_fiber(items) {
  let n = 0.0;
  let unknown = false;
  for (let f of items) {
    if (f.mcg != undefined) {
      if (f.hasOwnProperty("fiber") && f.fiber != "") {
        n += f.fiber * f.servings;
      } else {
        unknown = true;
      }
    }
  }
  return [n, unknown];
}

export function make_today(t = null) {
  const doc = new CollabJSON("{}");
  const now = t ? new Date(t): new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const day = now.getDay();
  doc.updateItem(["timestamp"], `${y}-${m}-${d}-${day}`);
  doc.updateItem(["items"], []);
  return doc;
}

export function make_favorites() {
  return new CollabJSON("[]", {
    idGenerator: (item) => item.name || item.id,
  });
}

export function make_history() {
  return new CollabJSON("[]", {
    idGenerator: (item) => item.timestamp,
    sortKeyGenerator: (item, path) =>
      item.timestamp ? -parseInt(item.timestamp.replace(/-/g, "").slice(0, 8)) : null,
  });
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
  if (!server_has_date || client_day_temp_data.timestamp > server_data.timestamp) {
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
