// In backend/src/db.rs
use rocksdb::{DB, Options, Error as RocksDbError};
use serde::{de::DeserializeOwned, Serialize, de::Error as SerdeError}; // Import SerdeError
use std::sync::Arc; // To safely share DB instance across threads if needed by Axum

// Define a custom error type for database operations
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("RocksDB error: {0}")]
    RocksDb(#[from] RocksDbError),
    #[error("Serialization/Deserialization error: {0}")]
    Serde(#[from] serde_json::Error), // Changed to Serde from Serialize
    #[error("UTF-8 conversion error: {0}")]
    Utf8(#[from] std::string::FromUtf8Error),
    #[error("Path conversion error or I/O error creating directory: {0}")]
    PathIo(String),
}

// A wrapper around the RocksDB instance for easier use
#[derive(Clone)] // Cloneable for Axum state sharing
pub struct AppDb {
    db: Arc<DB>,
}

impl AppDb {
    pub fn new(path: &str) -> Result<Self, DbError> {
        let mut opts = Options::default();
        opts.create_if_missing(true);

        let db_path = std::path::Path::new(path);
        // Ensure parent directory exists if db_path is something like "data/profile"
        if let Some(parent_dir) = db_path.parent() {
            std::fs::create_dir_all(parent_dir)
                .map_err(|e| DbError::PathIo(format!("Failed to create parent directory {}: {}", parent_dir.display(), e)))?;
        }

        let db = DB::open(&opts, db_path).map_err(DbError::RocksDb)?;
        Ok(AppDb { db: Arc::new(db) })
    }

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, DbError> {
        match self.db.get(key.as_bytes())? {
            Some(value_bytes) => {
                // Convert bytes to string first
                let value_str = String::from_utf8(value_bytes)?;
                // Then deserialize from string
                let deserialized = serde_json::from_str(&value_str)?;
                Ok(Some(deserialized))
            }
            None => Ok(None),
        }
    }

    pub fn put<T: Serialize>(&self, key: &str, value: &T) -> Result<(), DbError> {
        let serialized_value = serde_json::to_string(value)?;
        self.db.put(key.as_bytes(), serialized_value.as_bytes())?;
        Ok(())
    }

    pub fn delete(&self, key: &str) -> Result<(), DbError> {
        self.db.delete(key.as_bytes())?;
        Ok(())
    }
}

pub fn get_db_path(name: &str) -> Result<String, DbError> {
    let base_path = std::env::current_dir()
        .map_err(|e| DbError::PathIo(format!("Failed to get current directory: {}", e)))?;

    // Path for the specific database file, e.g., backend/data/profile.db
    let db_file_path = base_path.join("backend").join("data").join(format!("{}.db", name));

    // Ensure the 'backend/data' directory exists
    if let Some(parent_dir) = db_file_path.parent() {
        std::fs::create_dir_all(parent_dir)
            .map_err(|e| DbError::PathIo(format!("Failed to create data directory {}: {}", parent_dir.display(), e)))?;
    }

    db_file_path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| DbError::PathIo(format!("Failed to convert path {} to string", db_file_path.display())))
}

// Example of how one might initialize specific DBs.
// These will be created in main and passed as state.
// pub fn open_profile_db() -> Result<AppDb, DbError> {
//     AppDb::new(&get_db_path("profile")?)
// }
// pub fn open_favorites_db() -> Result<AppDb, DbError> {
//     AppDb::new(&get_db_path("favorites")?)
// }
// etc.
