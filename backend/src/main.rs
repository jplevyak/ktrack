// In backend/src/main.rs
mod models;
mod utils;
mod db;
mod handlers;

use axum::{
    routing::post,
    Router,
};
use tower_http::cors::{Any, CorsLayer}; // Corrected import path for CorsLayer and Any
use std::net::SocketAddr;
use handlers::ApiState; // Make sure ApiState is public or pub(crate) in handlers.rs

#[tokio::main]
async fn main() {
    // Setup CORS
    let cors = CorsLayer::new()
        .allow_origin(Any) // Allow any origin
        .allow_methods(Any) // Allow any method
        .allow_headers(Any); // Allow any header

    // Initialize ApiState (database connections)
    let api_state = match ApiState::new().await {
        Ok(state) => state,
        Err(e) => {
            eprintln!("Failed to initialize API state: {:?}", e);
            return;
        }
    };

    // Define the application routes
    let app = Router::new()
        .route("/api/profile", post(handlers::profile_handler))
        .route("/api/favorites", post(handlers::favorites_handler))
        .route("/api/history", post(handlers::history_handler))
        .route("/api/today", post(handlers::today_handler))
        .with_state(api_state) // Share state with handlers
        .layer(cors); // Apply CORS middleware

    // Define the server address
    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    println!("Rust backend listening on {}", addr);

    // Start the server
    if let Err(e) = axum::Server::bind(&addr) // Corrected: axum::Server::bind
        .serve(app.into_make_service())
        .await
    {
        eprintln!("Server error: {:?}", e);
    }
}
