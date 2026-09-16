use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, ShortcutState};

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // log in release builds too — the tray/shortcut warnings below
            // must be visible when a packaged app misbehaves
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
