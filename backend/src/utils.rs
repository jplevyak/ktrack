// In backend/src/utils.rs
use crate::models::{Day, Favorites, History, Profile, Item};
use std::collections::{HashMap, HashSet}; // Keep these for merge functions later
use chrono::{DateTime, Utc, TimeZone, Datelike, Weekday, NaiveDate, Duration};

pub const MERGE_HISTORY_LIMIT: usize = 10;

fn current_timestamp_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn make_today() -> Day {
    let now_utc: DateTime<Utc> = Utc::now();
    Day {
        updated: now_utc.timestamp_millis(),
        year: now_utc.year(),
        month: now_utc.month0() as i32, // month0 for 0-11 index
        date: now_utc.day() as i32,
        day: now_utc.weekday().num_days_from_sunday() as i32, // Sunday is 0
        items: Vec::new(),
    }
}

pub fn make_historical_day(current_day_struct: &Day, days_ago: i64) -> Day {
    // Ensure month is valid for NaiveDate by adding 1 (1-12 range)
    let current_naive_date = NaiveDate::from_ymd_opt(
        current_day_struct.year,
        (current_day_struct.month + 1) as u32,
        current_day_struct.date as u32,
    )
    .unwrap_or_else(|| {
        // Fallback for invalid date components, perhaps log an error too
        NaiveDate::from_ymd_opt(1970, 1, 1).unwrap()
    });

    let historical_naive_date = current_naive_date - Duration::days(days_ago);

    // Calculate the timestamp for the start of the historical date in UTC
    let historical_date_start_of_day_ts = Utc.from_utc_date(&historical_naive_date)
        .and_hms_opt(0,0,0)
        .unwrap() // Assuming valid NaiveDate will always convert
        .timestamp_millis();

    // The original JS logic for 'updated' field seems to be a bit specific,
    // creating a timestamp that is even further in the past than the historical date itself.
    // updated = the_date.getTime() - (days_ago + 2) * 24 * 3600 * 1000
    // This might be to ensure it's older than any potentially conflicting real data.
    // We will replicate this logic. 'historical_date_start_of_day_ts' is 'the_date.getTime()' equivalent.
    let updated_ms = historical_date_start_of_day_ts - (days_ago + 2) * 24 * 3600 * 1000;

    Day {
        updated: updated_ms,
        year: historical_naive_date.year(),
        month: historical_naive_date.month0() as i32, // month0 for 0-11
        date: historical_naive_date.day() as i32,
        day: historical_naive_date.weekday().num_days_from_sunday() as i32,
        items: Vec::new(),
    }
}

pub fn make_favorites() -> Favorites {
    Favorites {
        updated: current_timestamp_ms(),
        items: Vec::new(),
    }
}

pub fn make_history() -> History {
    History {
        updated: current_timestamp_ms(),
        items: Vec::new(),
    }
}

pub fn make_profile() -> Profile {
    Profile {
        username: String::new(),
        password: String::new(),
        old_password: None,
        message: "unauthenticated".to_string(),
        authenticated: None,
    }
}

pub fn finalize_profile(profile: &mut Profile) {
    profile.password.clear();
    profile.old_password = None;
}

// Compares two Day structs based on their date components.
pub fn compare_date(d1: &Day, d2: &Day) -> std::cmp::Ordering {
    let date1 = NaiveDate::from_ymd_opt(d1.year, (d1.month + 1) as u32, d1.date as u32);
    let date2 = NaiveDate::from_ymd_opt(d2.year, (d2.month + 1) as u32, d2.date as u32);
    date1.cmp(&date2)
}

// Generates a timestamp representing the start of the day in UTC for a given Day struct.
// This is used as a key for sorting/identifying unique days in history.
pub fn date_key(day: &Day) -> i64 {
    NaiveDate::from_ymd_opt(day.year, (day.month + 1) as u32, day.date as u32)
        .and_then(|d| Utc.from_utc_date(&d).and_hms_opt(0, 0, 0))
        .map_or(0, |dt| dt.timestamp_millis()) // Fallback to 0 if date is invalid
}

// Calculates the total 'mcg * servings' for items in a Day that are not marked as deleted.
pub fn get_total(day: &Day) -> f64 {
    day.items
        .iter()
        .filter(|item| item.del.is_none() || !item.del.unwrap()) // Consider item not deleted if 'del' is None or false
        .map(|item| item.mcg.unwrap_or(0.0) * item.servings.unwrap_or(0.0))
        .sum()
}

// merge d1 and d2, set the updated to be the greater and update if the output is different than d1.
pub fn merge_items(d1: &Favorites, d2: &Favorites) -> Favorites {
    let mut result_items_map: HashMap<String, Item> = HashMap::new();
    let mut changed = false;
    let mut latest_update_time = d1.updated;

    if d2.updated > d1.updated {
        latest_update_time = d2.updated;
    }

    for item1 in &d1.items {
        result_items_map.insert(item1.name.clone(), item1.clone());
    }

    for item2 in &d2.items {
        match result_items_map.get_mut(&item2.name) {
            Some(existing_item) => {
                if item2.updated.unwrap_or(0) > existing_item.updated.unwrap_or(0) {
                    *existing_item = item2.clone();
                    changed = true;
                }
            }
            None => {
                result_items_map.insert(item2.name.clone(), item2.clone());
                changed = true;
            }
        }
    }

    let mut result_items: Vec<Item> = result_items_map.values().cloned().collect();
    // The original JS code does not sort items here, so we won't either unless required.

    if changed {
        latest_update_time = current_timestamp_ms();
    }

    Favorites {
        updated: latest_update_time,
        items: result_items,
    }
}

pub fn merge_day(d1: &Day, d2: &Day) -> Day {
    match compare_date(d1, d2) {
        std::cmp::Ordering::Greater => return d1.clone(),
        std::cmp::Ordering::Less => return d2.clone(),
        std::cmp::Ordering::Equal => {
            // Dates are equal, merge items.
            // We need a temporary Favorites-like structure to reuse merge_items logic,
            // or adapt merge_items to be generic or handle Vec<Item> directly.
            // For now, let's adapt the item merging logic directly.

            let mut merged_items_map: HashMap<String, Item> = HashMap::new();
            let mut items_changed = false;
            let mut latest_item_update_time = d1.updated; // Start with d1's overall update time

            if d2.updated > d1.updated { // Consider d2's overall update time as well
                latest_item_update_time = d2.updated;
            }

            for item in &d1.items {
                merged_items_map.insert(item.name.clone(), item.clone());
            }

            for item2 in &d2.items {
                match merged_items_map.get_mut(&item2.name) {
                    Some(existing_item) => {
                        if item2.updated.unwrap_or(0) > existing_item.updated.unwrap_or(0) {
                            *existing_item = item2.clone();
                            items_changed = true;
                        }
                    }
                    None => {
                        merged_items_map.insert(item2.name.clone(), item2.clone());
                        items_changed = true;
                    }
                }
            }

            let final_updated_time = if items_changed {
                current_timestamp_ms()
            } else {
                // If items themselves didn't change, but d2 had a newer timestamp for the same day overall
                // use that, otherwise stick to d1's (or the greater of d1/d2 if no items changed)
                std::cmp::max(d1.updated, d2.updated)
            };

            Day {
                updated: final_updated_time,
                year: d1.year,
                month: d1.month,
                date: d1.date,
                day: d1.day,
                items: merged_items_map.values().cloned().collect(),
            }
        }
    }
}

// merge l1 and l2, set the updated time be the greater and update if the output is different than l1.
// only merge the most recent items (up to MERGE_HISTORY_LIMIT from l2).
pub fn merge_history(h1: &History, h2: &History) -> History {
    let mut updated_ts = h1.updated;
    if h2.updated > updated_ts {
        updated_ts = h2.updated;
    }

    let mut changed = false;
    let mut day_map: HashMap<i64, Day> = HashMap::new(); // Keyed by date_key

    for day_item in &h1.items {
        day_map.insert(date_key(day_item), day_item.clone());
    }

    // Process items from h2, limited by MERGE_HISTORY_LIMIT
    for day_item_h2 in h2.items.iter().take(MERGE_HISTORY_LIMIT) {
        let k = date_key(day_item_h2);
        match day_map.get(&k) {
            Some(existing_day_h1) => {
                let merged_day = merge_day(existing_day_h1, day_item_h2);
                // Check if merge_day actually changed anything or updated the timestamp
                if merged_day.updated != existing_day_h1.updated ||
                   merged_day.items.len() != existing_day_h1.items.len() || // Quick check for item changes
                   merged_day.items.iter().zip(&existing_day_h1.items).any(|(a,b)| a.updated != b.updated) // More thorough
                {
                    day_map.insert(k, merged_day);
                    changed = true;
                }
            }
            None => {
                day_map.insert(k, day_item_h2.clone());
                changed = true;
            }
        }
    }

    let mut result_items: Vec<Day> = day_map.values().cloned().collect();
    // Sort by date descending (most recent first)
    result_items.sort_by(|a, b| date_key(b).cmp(&date_key(a)));


    if changed || result_items.is_empty() && (!h1.items.is_empty() || !h2.items.is_empty()) {
        // also consider changed if result is empty but inputs were not, or vice versa
        updated_ts = current_timestamp_ms();
    } else if !changed && h1.items.len() != result_items.len() {
        // If lengths differ after merge (e.g. new items added from h2 but no individual item conflicts)
        // this is also a change.
        updated_ts = current_timestamp_ms();
    }


    History {
        items: result_items,
        updated: updated_ts,
    }
}


pub fn merge_profile(p_local: &Profile, p_remote: &Profile) -> Profile {
    let mut result_profile = p_local.clone(); // Start with local profile data
    result_profile.message = String::new(); // Clear message
    result_profile.authenticated = None; // Reset authenticated status

    // p_remote is the incoming data from the request (data.value in JS)
    // p_local is the currently stored profile (value in JS)

    // The JS logic:
    // l1 = { ...l1 }; // shallow copy (p_local in our case, this is result_profile)
    // l1.message = "";
    // delete l1.authenticated;
    // l2.username = l1.username; // (p_remote.username = result_profile.username) - This seems off, username should come from remote if it's a login/creation attempt.
                                  // Let's assume username is fixed or taken from p_remote if p_local is empty.
                                  // For merging, username is usually the key and shouldn't change.
    // l2.authenticated = Date.now();
    // l2.updated = l2.authenticated;

    // The JS `do_post_internal` `data` parameter holds `username`, `password`, `value (Profile)`, `updated (timestamp of value)`.
    // `value` from `do_post_internal` is `p_local` (current DB state).
    // `data.value` from `do_post_internal` is `p_remote` (new state from client).

    let timestamp_now = current_timestamp_ms();
    result_profile.updated = timestamp_now; // Default update to now

    // Scenario 1: Profile creation (local username is empty, remote password might be empty or not)
    // Or, simple login attempt (local username exists, remote password provided)
    if p_remote.username.is_empty() || p_remote.password.is_empty() {
        // This condition in JS leads to "profile created, authenticated" if local password is also empty.
        // This is more like an initial fetch or a specific state.
        // If p_local.password is empty, it means it's a new profile.
        if p_local.password.is_empty() { // New profile being created essentially
             result_profile.username = p_remote.username.clone(); // take username from remote
             result_profile.password = p_remote.password.clone(); // take password from remote
             result_profile.message = "profile created, authenticated".to_string();
             result_profile.authenticated = Some(timestamp_now);
        } else {
            // This case is tricky without full context of how p_remote (data.value in JS) is structured when username/password are empty.
            // Assuming this means a fetch or a state where remote sends minimal data.
            // If local password is not empty, but remote data is minimal. This might be a sync/status check.
            // The JS returns `l2` (p_remote) modified.
            // Let's adjust based on JS: if (l1.username == "" || l1.password == "")
            // This means the *submitted data* (p_remote) has empty username or password
            if result_profile.password.is_empty() { // If the stored password is empty (new profile)
                 result_profile.username = p_remote.username.clone(); // This was l2.username = l1.username, so current profile username
                 result_profile.password = p_remote.password.clone(); // This was effectively l2.password = l1.password
                 result_profile.message = "profile created, authenticated".to_string();
                 result_profile.authenticated = Some(timestamp_now);
                 result_profile.updated = timestamp_now;

            } else if p_remote.password == p_local.password { // Password matches
                 result_profile.message = "profile in sync, authenticated".to_string();
                 result_profile.authenticated = Some(timestamp_now);
                 result_profile.updated = timestamp_now; // or keep p_local.updated if no actual change
            } else {
                 result_profile.message = "incorrect password, not authenticated".to_string();
                 // result_profile.updated is already timestamp_now
            }
        }
        return result_profile;
    }


    // Scenario 2: Password change (old_password is provided in p_remote)
    if let Some(old_pass) = &p_remote.old_password {
        if !old_pass.is_empty() {
            if *old_pass != p_local.password {
                result_profile.message = "old password mismatch, not authenticated".to_string();
                // result_profile.updated is already timestamp_now
                return result_profile;
            }
            // Old password matches, update to new password
            result_profile.password = p_remote.password.clone();
            result_profile.message = "new password saved, authenticated".to_string();
            result_profile.authenticated = Some(timestamp_now);
            // result_profile.updated is already timestamp_now
            return result_profile;
        }
    }

    // Scenario 3: Standard login/sync (p_remote has username and password, no old_password)
    if p_remote.password == p_local.password {
        result_profile.message = "profile in sync, authenticated".to_string();
        result_profile.authenticated = Some(timestamp_now);
        // If passwords match, and nothing else changed, we might not need to update timestamp.
        // However, JS sets l2.updated = l2.authenticated.
        result_profile.updated = timestamp_now;
    } else {
        result_profile.message = "incorrect password, not authenticated".to_string();
        // result_profile.updated is already timestamp_now
    }

    result_profile
}
