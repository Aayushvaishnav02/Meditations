use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, State,
};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Port the sidecar listens on (None in dev: the backend runs via ./dev.sh).
struct BackendState {
    port: Option<u16>,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn backend_port(state: State<'_, BackendState>) -> Option<u16> {
    state.port
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn spawn_backend(app: &tauri::AppHandle, port: u16) -> Option<CommandChild> {
    let db_dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&db_dir);
    let db_path = db_dir.join("journal.db");

    // one-time, non-destructive import of a legacy dev database
    if !db_path.exists() {
        if let Ok(legacy) = std::env::var("MEDITATIONS_LEGACY_DB") {
            if let Err(err) = std::fs::copy(&legacy, &db_path) {
                log::warn!("legacy db import failed: {err}");
            }
        }
    }

    let result = tauri::async_runtime::block_on(async {
        app.shell()
            .sidecar("meditations-backend")?
            .env("MEDITATIONS_PORT", port.to_string())
            .env("JOURNAL_DB_PATH", db_path.to_string_lossy().to_string())
            .spawn()
    });
    match result {
        Ok((mut rx, child)) => {
            // drain sidecar output into the log so its stdout pipe never fills
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stdout(line) | CommandEvent::Stderr(line) = event {
                        log::info!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                    }
                }
            });
            Some(child)
        }
        Err(err) => {
            log::warn!("backend sidecar failed to spawn: {err}");
            None
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // log in release builds too — the sidecar/tray/shortcut warnings
            // below must be visible when a packaged app misbehaves
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // sidecar backend on a free loopback port; dev uses ./dev.sh on :8000
            let (port, child) = if cfg!(dev) {
                (None, None)
            } else {
                let port = TcpListener::bind(("127.0.0.1", 0))
                    .expect("bind loopback")
                    .local_addr()
                    .expect("local addr")
                    .port();
                let child = spawn_backend(app.handle(), port);
                if !wait_for_port(port, Duration::from_secs(15)) {
                    log::warn!("backend not reachable on :{port} after 15s");
                }
                (Some(port), child)
            };
            app.manage(BackendState {
                port,
                child: Mutex::new(child),
            });

            // system tray: show/quit — non-fatal: on desktops without an
            // appindicator runtime the tray can't be created, and that must
            // not keep the app from starting
            let show = MenuItem::with_id(app, "show", "Show Meditations", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            if let Err(err) = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Meditations")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)
            {
                log::warn!("system tray unavailable: {err}");
            }

            // Super+Shift+A: quick add — focus the app from anywhere
            if let Err(err) = app.handle().plugin(
                ShortcutBuilder::new()
                    .with_shortcuts(["super+shift+a"])?
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            show_main(app);
                        }
                    })
                    .build(),
            ) {
                log::warn!("global shortcut unavailable: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_port])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Ok(mut guard) = state.child.lock() {
                        if let Some(child) = guard.take() {
                            let _ = tauri::async_runtime::block_on(child.kill());
                        }
                    }
                }
            }
        });
}
