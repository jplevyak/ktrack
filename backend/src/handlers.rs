// In backend/src/handlers.rs
use crate::models::{Profile, Favorites, History, Day, Item};
use crate::db::{AppDb, DbError};
use crate::utils; // Assuming all utils are needed

use axum::{
    extract::State, // For sharing database connections
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc; // For AppDb state

// --- Common Error Type for Handlers ---
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("Database error: {0}")]
    Db(#[from] DbError),
    #[error("Serialization/Deserialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Authentication failed: {0}")]
    Auth(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Internal server error: {0}")]
    Internal(String), // For other kinds of errors
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Db(db_err) => {
                eprintln!("Database error: {:?}", db_err); // Log for server visibility
                (StatusCode::INTERNAL_SERVER_ERROR, format!("Database error: {}", db_err))
            }
            ApiError::Serde(serde_err) => {
                eprintln!("Serialization/Deserialization error: {:?}", serde_err);
                (StatusCode::BAD_REQUEST, format!("Data handling error: {}", serde_err))
            }
            ApiError::Auth(msg) => (StatusCode::UNAUTHORIZED, msg),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Internal(msg) => {
                eprintln!("Internal server error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg)
            }
        };
        (status, Json(ErrorResponse { error: error_message })).into_response()
    }
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// --- Common Request Structures ---

// Generic request body for most POST requests, mirroring `do_post`
#[derive(Deserialize, Debug)]
pub struct GenericRequest<T> {
    username: Option<String>, // Optional because profile POST might not have it in the same way
    password: Option<String>, // Optional for same reason
    updated: Option<i64>,   // Timestamp of the client's 'value'
    value: Option<T>,       // The actual data payload (e.g., Favorites, History, Day)
}

// Specific request for profile as it's handled by `do_post_internal`
// and its `data` object is directly the Profile structure.
// However, the JS `do_post_internal` takes `data` (the profile from request.json())
// and `username` (also from data.username).
// Let's make a unified request structure for profile.
#[derive(Deserialize, Debug)]
pub struct ProfileRequest {
    // Profile fields directly, matching the structure sent by client
    pub username: String,
    pub password: Option<String>, // Password might be empty for some operations
    pub old_password: Option<String>,
    // 'message' and 'authenticated' are usually server-set, not client-sent in this context.
    // 'value' and 'updated' from GenericRequest are not directly applicable here as Profile itself is the value.
    // We might need a wrapper if the client sends { value: Profile, updated: timestamp } for profile too.
    // The JS `let data = await req.request.json()` for profile implies `data` IS the profile object.
    // Let's assume the client sends the Profile object directly for the `/api/profile` route.
    // For consistency with `do_post_internal` which has `data` (the profile) and `username` (from data.username),
    // it's simpler if the request body is just the Profile model.
    // The `username` field within the Profile model will be used.
    // `data.username` in `do_post_internal(req, data, data.username, ...)`
    // means `data` is the Profile object itself.
}


// --- Common Response Structure ---
#[derive(Serialize, Debug)]
pub struct ApiResponse<T> {
    value: Option<T>, // Optional because sometimes we send nothing ("")
    // error: Option<String>, // Errors are handled by ApiError and IntoResponse
}

// Placeholder for now, handlers will be added next.
// pub async fn profile_handler() {}
// pub async fn favorites_handler() {}
// pub async fn history_handler() {}
// pub async fn today_handler() {}

// --- Generic Handler Logic (similar to do_post in JS) ---
async fn generic_item_handler<T, FMake, FMerge>(
    State(state): State<ApiState>, // Full ApiState
    db_instance: AppDb,            // Specific DB for this item type (e.g., favorites_db)
    Json(req_data): Json<GenericRequest<T>>, // Generic request with username, password, value
    make_fn: FMake,                // Function to create a new T if DB is empty (e.g., utils::make_favorites)
    merge_fn: FMerge,              // Function to merge T with T (e.g., utils::merge_items)
) -> Result<Json<ApiResponse<T>>, ApiError>
where
    T: Serialize + for<'de> Deserialize<'de> + Clone + Default + Send + 'static, // Ensure T is Default
    FMake: Fn() -> T,
    FMerge: Fn(&T, &T) -> T,
{
    let username = req_data.username.ok_or_else(|| ApiError::BadRequest("Username is required".to_string()))?;
    let password = req_data.password.ok_or_else(|| ApiError::BadRequest("Password is required".to_string()))?;

    if username.is_empty() {
        return Err(ApiError::BadRequest("Username cannot be empty".to_string()));
    }
    if password.is_empty() {
        return Err(ApiError::BadRequest("Password cannot be empty".to_string()));
    }

    // --- Authentication Step (copied from JS do_post) ---
    let profile_opt: Option<models::Profile> = state.profile_db.get(&username)?;
    match profile_opt {
        Some(p) => {
            if p.username != username || p.password != password {
                return Err(ApiError::Auth("Incorrect username or password".to_string()));
            }
            // Check if profile itself indicates non-authenticated state from merge_profile
            if p.message.contains("not authenticated") || p.authenticated.is_none() {
                 // If merge_profile decided it's not authenticated, even if password matched initially.
                 // This can happen if e.g. old_password mismatch during a change attempt.
                 // However, for generic_item_handler, a simple password check against stored one should be enough.
                 // The complex auth logic is more for profile_handler itself.
                 // For other data types, if username/password in DB matches, proceed.
            }
        }
        None => {
            return Err(ApiError::Auth("Profile not found".to_string()));
        }
    }
    // --- End Authentication ---

    let existing_data_opt: Option<T> = db_instance.get(&username)?;
    let mut result_to_send: Option<T> = None;

    match req_data.value {
        Some(client_value) => { // Client sent data (`data.value != undefined` in JS)
            let merged_data = match existing_data_opt {
                Some(stored_data) => {
                    // If client data `updated` is older or same as stored, and client sends actual data,
                    // we should still merge. The merge function itself should handle timestamps.
                    // The JS code: `result = merge(value, data.value)`
                    merge_fn(&stored_data, &client_value)
                }
                None => client_value, // No existing data, take client's data as is
            };

            // Check if data actually changed by comparing. This is tricky for complex objects.
            // The JS `result.updated != value.updated` is a good heuristic.
            // If T has an `updated` field, we could try to access it generically, but that's complex.
            // For now, we save if client sent data and there was existing data (implying a potential merge)
            // or if there was no existing data (implying a new save).
            // A more robust check would involve serializing and comparing, or specific `is_changed` methods.
            // Let's assume merge_fn updates timestamp if actual change occurs.

            let mut should_save = false;
            if let Some(ref stored_data_inner) = existing_data_opt {
                // This requires T to have an `updated` field accessible, which is not guaranteed by trait bounds.
                // We'll rely on the merge function to set the timestamp appropriately if changed.
                // The JS `do_post_internal` uses `result.updated != value.updated`.
                // We need a way to compare `merged_data` with `stored_data_inner` or check `updated` field.
                // For now, let's save if client sent value. The merge function should be idempotent for timestamps.
                // A better approach is for merge_fn to return a tuple: (T, bool_changed)
                // Or, T needs a get_updated_ts() method.
                // For now, we save if client sent data.
                should_save = true;
            } else {
                should_save = true; // No existing data, so save the new client data.
            }

            if should_save {
                db_instance.put(&username, &merged_data)?;
            }

            // Determine what to send back.
            // JS: `if (value != undefined && result.updated == value.updated) { result = ""; }`
            // Meaning if there was old data, and after merge the timestamp is the same, send nothing.
            let mut send_data = true;
            if let Some(stored_data_inner) = existing_data_opt {
                 // This comparison is still an issue without accessing 'updated' field or better change detection.
                 // Let's assume for now that if data was sent, we send the merged version back.
                 // The client can then diff if needed.
                 // A more accurate port of the JS "send nothing" needs T to expose its timestamp.
                 // For now, we send merged_data if client_value was present.
            }
            if send_data {
                result_to_send = Some(merged_data);
            }

        }
        None => { // Client did not send data (`data.value == undefined` in JS) - treat as a fetch request.
            match existing_data_opt {
                Some(stored_data) => {
                    // Client's local data might be outdated if req_data.updated differs.
                    // JS: `if (data.updated != value.updated) { result = value; }`
                    if req_data.updated.is_none() || req_data.updated.unwrap_or(0) == 0 || req_data.updated != get_updated_from_t(&stored_data) {
                        result_to_send = Some(stored_data);
                    } else {
                        // Client is up to date, send nothing.
                        result_to_send = None;
                    }
                }
                None => { // No data in DB, and client sent no data. Make new and send.
                    result_to_send = Some(make_fn());
                }
            }
        }
    }

    Ok(Json(ApiResponse { value: result_to_send }))
}

// Helper to attempt to get 'updated' field. This is a hack.
// A better way is a trait `Timestamped` for T.
fn get_updated_from_t<T: Serialize>(data: &T) -> Option<i64> {
    serde_json::to_value(data).ok().and_then(|v| {
        v.get("updated").and_then(|ts_val| ts_val.as_i64())
    })
}


// --- Specific Handlers ---
pub async fn favorites_handler(
    State(state): State<ApiState>,
    req: Json<GenericRequest<models::Favorites>>,
) -> Result<Json<ApiResponse<models::Favorites>>, ApiError> {
    let db = state.favorites_db.clone(); // Clone AppDb for this handler instance
    generic_item_handler(
        State(state), // Pass the original full state for profile_db access
        db,
        req,
        utils::make_favorites,
        utils::merge_items, // merge_items is for Favorites
    )
    .await
}

pub async fn history_handler(
    State(state): State<ApiState>,
    req: Json<GenericRequest<models::History>>,
) -> Result<Json<ApiResponse<models::History>>, ApiError> {
    let db = state.history_db.clone();
    generic_item_handler(
        State(state),
        db,
        req,
        utils::make_history,
        utils::merge_history,
    )
    .await
}

pub async fn today_handler(
    State(state): State<ApiState>,
    req: Json<GenericRequest<models::Day>>, // Today's data is a single Day object
) -> Result<Json<ApiResponse<models::Day>>, ApiError> {
    let db = state.today_db.clone();

    // `make_historical_day` needs the current day and days_ago.
    // `make_fn` in `generic_item_handler` has `Fn() -> T`.
    // The JS `make_historical_day(today, 10000)` for "today" route is odd.
    // It implies the "today" key in leveldb stores a *historical* version of today if it's new?
    // Or `make_historical_day(some_ref_day_struct, 0)` would be `make_today`.
    // Let's assume for "today" route, if it's "made", it's just `utils::make_today()`.
    // The special `make_historical_day(today, 10000)` in JS `POST` for `/today` route was:
    // `() => make_historical_day(today, 10000)` where `today` was `new Level("./today")`.
    // This suggests `make_historical_day` was to be used with the DB instance, not a Day struct.
    // This is quite different.
    // Let's simplify: for the "today" route, the "make" function is `utils::make_today`.
    // The merge function is `utils::merge_day`.

    generic_item_handler(
        State(state),
        db,
        req,
        utils::make_today, // If creating "today" from scratch
        utils::merge_day,  // Merging new today data with existing
    )
    .await
}


// Represents the shared state for Axum handlers
#[derive(Clone)]
pub struct ApiState {
    profile_db: AppDb,
    favorites_db: AppDb,
    history_db: AppDb,
    today_db: AppDb,
}

// Constructor for ApiState - to be called in main.rs
impl ApiState {
    pub async fn new() -> Result<Self, DbError> {
        let profile_db = AppDb::new(&crate::db::get_db_path("profile")?)?;
        let favorites_db = AppDb::new(&crate::db::get_db_path("favorites")?)?;
        let history_db = AppDb::new(&crate::db::get_db_path("history")?)?;
        let today_db = AppDb::new(&crate::db::get_db_path("today")?)?;
        Ok(Self { profile_db, favorites_db, history_db, today_db })
    }
}


pub async fn profile_handler(
    State(state): State<ApiState>, // Use the specific AppDb for profiles
    Json(req_profile_data): Json<models::Profile>, // The client sends the full Profile object as JSON
) -> Result<Json<ApiResponse<models::Profile>>, ApiError> {
    // `req_profile_data` is equivalent to `data` in `do_post_internal`
    // `username_key` is equivalent to `username` in `do_post_internal`
    let username_key = req_profile_data.username.clone();

    if username_key.is_empty() {
        return Err(ApiError::BadRequest("Username cannot be empty".to_string()));
    }

    // Equivalent to `db.get(username)`
    let existing_profile_opt: Option<models::Profile> = state.profile_db.get(&username_key)?;

    // This logic mirrors `do_post_internal`
    // `data.value == undefined` in JS is tricky. In Rust, if client sends a Profile, all fields are there.
    // The JS `if (data.value == undefined)` part seems to be for a "status request" or initial fetch.
    // This is not directly mapped if the client *always* sends a full (or partial) Profile object.
    // Let's assume `req_profile_data` *is* the "value" being sent.
    // The JS code structure:
    // if (data.value == undefined) { // data here is the { username, password, updated, value } wrapper
    //   if (value == undefined) result = make() -> client wants full, db empty
    //   else if (data.updated != value.updated) result = value -> client outdated, send db version
    //   else result = "" -> client up to date
    // } else { // data.value != undefined, client is sending an update
    //   if (value != undefined) result = merge(value, data.value) -> merge client into db
    //   else result = data.value -> db empty, take client value
    //   // ... then db.put if changed ...
    // }

    // For profile, `do_post_internal` is called with `data` being the profile from request.json().
    // There isn't an outer `data.value` vs `data.updated` for the profile route in the same way.
    // The `req_profile_data` IS the new state from the client.

    let mut result_profile_to_send: Option<models::Profile>;

    match existing_profile_opt {
        Some(mut stored_profile) => {
            // Stored profile exists, merge req_profile_data into it
            // The JS merge_profile(l1, l2) has l1 as current, l2 as new.
            // So, merge_profile(stored_profile, req_profile_data)
            let mut merged_profile = utils::merge_profile(&stored_profile, &req_profile_data);

            // `finalize_profile` mutates. It clears password and old_password.
            // It should be called on the version that might be sent back.
            // The JS `do_post_internal` calls finalize on `result` *before* sending.

            // If merged_profile.updated is different from stored_profile.updated, it means a change happened.
            // The JS logic for `put`: `if (value == undefined || result.updated != value.updated)`
            // `value` is `stored_profile`, `result` is `merged_profile`.
            if merged_profile.updated != stored_profile.updated || merged_profile.message.contains("saved") || merged_profile.message.contains("created") {
                 // Also save if message indicates a persistent change like "saved" or "created"
                state.profile_db.put(&username_key, &merged_profile)?;
            }

            // The JS logic for what to send back:
            // `if (value != undefined && result.updated == value.updated) { result = ""; }`
            // This means if after merge, the `updated` timestamp is the same as before the merge (and profile existed),
            // send nothing. This implies no effective change was made that needs to be echoed back.
            if merged_profile.updated == stored_profile.updated && !merged_profile.message.contains("authenticated") {
                 // If not authenticated and no change in `updated`, send nothing.
                 // Or if message indicates no change for an existing profile.
                 // However, if merge_profile results in "authenticated", we should send the profile.
                result_profile_to_send = None;
            } else {
                // Something changed, or it's an auth message.
                utils::finalize_profile(&mut merged_profile); // Finalize before sending
                result_profile_to_send = Some(merged_profile);
            }
        }
        None => {
            // No profile in DB for this username. Treat `req_profile_data` as a new profile.
            // This corresponds to `value == undefined` in the JS.
            // `result = make()` if `data.value == undefined` (not this path for profile)
            // `result = data.value` if `data.value != undefined` (this path for profile)
            let mut new_profile = req_profile_data; // This is `data.value`

            // Before calling make_profile, we need to ensure we are not overwriting valid incoming data.
            // The JS `make_profile` is usually for the case where `value` (from DB) is undefined AND `data.value` (from client) is also undefined.
            // Here, `req_profile_data` IS `data.value`. So we use it.
            // We might need to adjust its `updated` and `message` fields based on `make_profile` if it's truly "new".

            if new_profile.username.is_empty() { // Should have been caught earlier, but as a safeguard
                 return Err(ApiError::BadRequest("Username for new profile is empty".to_string()));
            }
            // If it's a new profile, its password should be set, message should be "profile created" etc.
            // The `utils::merge_profile` handles the "new profile" case if `stored_profile`'s password is empty.
            // Let's simulate an empty stored_profile for merge_profile to correctly initialize `new_profile`.
            let mut temp_empty_profile_for_merge = utils::make_profile();
            temp_empty_profile_for_merge.username = new_profile.username.clone(); // Ensure username is consistent

            let mut initialized_new_profile = utils::merge_profile(&temp_empty_profile_for_merge, &new_profile);

            state.profile_db.put(&username_key, &initialized_new_profile)?;
            utils::finalize_profile(&mut initialized_new_profile); // Finalize before sending
            result_profile_to_send = Some(initialized_new_profile);
        }
    }

    Ok(Json(ApiResponse { value: result_profile_to_send }))
}

// Placeholder for other handlers
// pub async fn favorites_handler() {}
// pub async fn history_handler() {}
// pub async fn today_handler() {}
