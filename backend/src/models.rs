use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Item {
    pub name: String,
    pub mcg: Option<f64>, // Assuming mcg can be optional
    pub servings: Option<f64>, // Assuming servings can be optional
    pub updated: Option<i64>, // Timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub del: Option<bool>, // Optional delete marker
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Day {
    pub updated: i64, // Timestamp
    pub year: i32,
    pub month: i32, // 0-11 like JavaScript's getMonth()
    pub date: i32,
    pub day: i32, // 0-6 like JavaScript's getDay()
    pub items: Vec<Item>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Favorites {
    pub updated: i64, // Timestamp
    pub items: Vec<Item>,
}

// HistoryItem is essentially a Day, but we might give it a distinct type for clarity if needed.
// For now, let's alias or wrap Day if specific History item logic diverges.
// Given merge_history processes Day-like structures, we'll use Day directly for items in History.

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct History {
    pub updated: i64, // Timestamp
    pub items: Vec<Day>, // History items are Day structures
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct Profile {
    pub username: String,
    #[serde(default)] // Ensure password is not missing during deserialization if not provided
    pub password: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_password: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authenticated: Option<i64>, // Timestamp
}
