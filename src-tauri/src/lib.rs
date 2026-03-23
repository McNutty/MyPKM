mod commands;
mod db;

use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
