import {writable as internal} from 'svelte/store';
import {compare_date, merge_items, merge_day, merge_history_limit, cleanup_history, merge_history, make_today, make_favorites, make_history, make_historical_day, make_profile} from './_util.js';

const check_backup_interval = 5 * 1000;  // 5 seconds.

export function local_writable(key, initialValue) {
  const store = internal(initialValue)
  const {subscribe, set, update} = store
  var json = undefined;
  if (typeof window != 'undefined') json = localStorage.getItem(key)
    if (json) {
      try {
        set(JSON.parse(json));
      } catch (e) {
        set(initialValue);
      }
    }
  return {
    set(value) {
      if (typeof window != 'undefined') localStorage.setItem(key, JSON.stringify(value));
      set(value)
    }
    , update(cb) {
      let v;
      update(function(x) {
        v = cb(x);
        return v;
      });
      if (typeof window != 'undefined') localStorage.setItem(key, JSON.stringify(v));
    }
    , subscribe
  }
}

export function save_history(day, profile) {
  if (day == undefined) return;
  var h = {updated: day.updated, items: [day, make_historical_day(day, 1)]};
  history_store.update(function(history) {
    let new_history = merge_history(history, h);
    if (new_history != history) {
      backup_history(new_history, profile);
    }
    return new_history;
  });
}

export const today_store = local_writable('today', make_today());
export const favorites_store = local_writable('favorites', make_favorites());
export const history_store = local_writable('history', make_history());
export const profile_store = local_writable('profile', make_profile());
export const edit_store = local_writable('edit', undefined);
export const index_store = internal(undefined);

export function add_item(item, today, edit, profile) {
  if (edit != undefined) {
    if (Date.now() - edit.start_edit > 10 * 60 * 1000) {  // 10 min.
      edit_store.set(undefined);
      edit = undefined;
    }
    edit.start_edit = Date.now();
  }
  let store = (edit != undefined) ? edit_store : today_store;
  if (edit == undefined) {
    today = check_for_new_day(today);
  }
  store.update(function(day) {
    if (day == undefined) day = make_today();
    for (let i of day.items) {
      if (i.name == item.name) {
        if (i.del == undefined) return day;
        delete i.del;
        i.updated = Date.now();
        save_history(day, profile);
        return day;
      }
    }
    item = {...item};
    item.updated = Date.now();
    delete item.del;
    if (item.servings == undefined) item.servings = 1.0;
    day = {...day};
    day.items.push(item);
    day.updated = Date.now();
    save_history(day, profile);
    return day;
  });
}

export function save_today(today, profile) {
  today_store.set(today);
  backup_today(today, profile);
  save_history(today, profile);
}

function backup_internal(l, name, store, merge, profile, item_limit = undefined, update = false) {
  if (profile == undefined || profile.authenticated == undefined) {
    return;
  }
  var data = {username: profile.username, password: profile.password, updated: l.updated};
  if (update) {
    let ll = l;
    if (ll.items != undefined && item_limit) {
      if (item_limit != undefined) {
        ll = {...l};  // shallow copy
        ll.items = ll.items.slice(0, item_limit);
      }
    }
    data.value = ll;
  }
  fetch(name, {method: 'POST', body: JSON.stringify(data), headers: {'Content-Type': 'application/json'}})
      .then(r => {
        if (!r.ok) return;
        r.json()
            .then(data => {
              if (data.err) {
                console.log(data.err);
                return;
              }
              let backup = data.value;
              if (backup == undefined) return;
              let merged = merge(l, backup);
              merged.server_checked = l.server_checked;
              merged.server_synced = Date.now();
              if (merged.updated != l.updated) {
                store.set(merged);
              }
              if (backup.updated == undefined || merged.updated != backup.updated) {
                if (update) {
                  return;
                }
                backup_internal(merged, name, store, merge, profile, item_limit, true);
              }
            })
            .catch(err => {console.log('JSON error', err.message)});
      })
      .catch(err => {console.log('POST error', err.message)})
}

export function backup_today(today, profile) {
  if (today.server_checked == undefined) today.server_checked = Date.now() - check_backup_interval;
  if (Date.now() - today.server_checked < check_backup_interval) return;
  today.server_checked = Date.now();
  backup_internal(today, 'today', today_store, merge_day, profile);
}

export function backup_favorites(favorites, profile) {
  if (favorites.server_checked == undefined) favorites.server_checked = Date.now() - check_backup_interval;
  if (Date.now() - favorites.server_checked < check_backup_interval) return;
  favorites.server_checked = Date.now();
  backup_internal(favorites, 'favorites', favorites_store, merge_items, profile);
}

export function backup_history(history, profile) {
  if (history.server_checked == undefined) history.server_checked = Date.now() - check_backup_interval;
  if (history.items.length > 0) {
    history.updated = history.items[0].updated;
  }
  if (Date.now() - history.server_checked <= check_backup_interval) {
    return;
  }
  history.server_checked = Date.now();
  backup_internal(history, 'history', history_store, merge_history, profile, merge_history_limit);
}

export function save_profile(profile) {
  if (profile.password == '') {
    profile_store.set(profile);
    return;
  }
  let name = 'profile';
  let data = {username: profile.username, password: profile.password, value: profile};
  fetch(name, {method: 'POST', body: JSON.stringify(data), headers: {'Content-Type': 'application/json'}})
      .then(r => {
        if (!r.ok) {
          profile_store.set(profile);
          return;
        }
        r.json()
            .then(data => {
              if (data.err) {
                console.log(data.err);
                profile_store.set(profile);
                return;
              }
              let p = data.value;
              if (!p) {
                profile.message = 'authenticated';
                profile.authenticated = Date.now();
                profile.old_password = '';
              } else {
                profile.message = p.message;
                profile.old_password = '';
              }
              profile_store.set(profile);
            })
            .catch(err => {
              console.log('JSON error', err.message)
              profile_store.set(profile);
            });
      })
      .catch(err => {
        console.log('POST error', err.message)
        profile_store.set(profile);
      })
}

export function save_favorite(item, profile, replace_index) {
  favorites_store.update(function(favorites) {
    if (favorites == undefined) favorites = make_favorites();
    item = {...item};
    item.updated = Date.now();
    favorites.updated = item.updated;
    if (replace_index != undefined) {
      if (replace_index >= favorites.items.length) {
        console.log('bad replace_index', replace_index);
        return favorites;
      }
      favorites.items.splice(replace_index, 1, item);
      return favorites;
    }
    for (let i in favorites.items) {
      if (favorites.items[i].name == item.name) {
        favorites.items.splice(i, 1, item);
        backup_favorites(favorites, profile);
        return favorites;
      }
    }
    if (item.servings == undefined) item.servings = 1.0;
    favorites.items.push(item);
    backup_favorites(favorites, profile);
    return favorites;
  });
}

export function reset_data() {
  today_store.set(make_today());
  favorites_store.set(make_favorites());
  history_store.set(make_history());
}

export function check_for_new_day(t) {
  let new_day = make_today();
  if (t.year == undefined || compare_date(t, new_day) < 0) {
    save_today(new_day, profile);
    return new_day;
  }
  return t;
}
