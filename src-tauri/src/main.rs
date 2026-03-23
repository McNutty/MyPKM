// Prevent a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;

use std::sync::Mutex;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize the SQLite database and store the connection in
            // Tauri managed state so all IPC commands can access it.
            let conn = db::init_db(app.handle())
                .expect("Failed to initialize Plectica database");

            app.manage(Mutex::new(conn));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_map_nodes,
            commands::create_node,
            commands::update_node_content,
            commands::update_node_layout,
            commands::delete_node,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running Plectica");
}
