#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod cli;
mod delete_bridge;
mod links;
mod native_menu;
mod notifications;
mod popout_store;
mod popout_windows;
mod popouts;
mod preferences;
mod process;
mod session_catalog;
mod session_deletion;
#[cfg(test)]
mod session_smoke;
mod sessions;
mod window_state;
mod workspace_windows;
mod workspaces;
use workspace_windows::{
    WorkspaceWindows, inspect_workspace_session, list_workspace_sessions, open_workspace,
    window_workspace,
};

use sessions::{LaunchMode, SessionFile};

use process::Packet;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, ipc::Channel};
use tokio::process::Command;
use workspaces::WorkspaceHost;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LaunchConfig {
    cwd: PathBuf,
    pi: PathBuf,
    node: PathBuf,
    demo: bool,
    mode: LaunchMode,
    session_file: Option<PathBuf>,
    session_id: Option<String>,
    session_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchInfo {
    cwd: PathBuf,
    session: Option<SessionFile>,
}

#[derive(Serialize)]
struct Defaults {
    pi: String,
    node: String,
    cwd: String,
}

fn find_program(name: &str) -> Option<PathBuf> {
    which::which(name).ok().or_else(|| {
        // Finder/Dock launches don't inherit the user's interactive PATH.
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(name))
            .find(|p| p.is_file())
    })
}

#[tauri::command]
async fn runtime_defaults() -> Defaults {
    let node = if let Some(mise) = find_program("mise") {
        match tokio::time::timeout(
            std::time::Duration::from_secs(5),
            Command::new(mise).args(["which", "node"]).output(),
        )
        .await
        {
            Ok(Ok(output)) if output.status.success() => {
                PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
            }
            _ => find_program("node").unwrap_or_else(|| "node".into()),
        }
    } else {
        find_program("node").unwrap_or_else(|| "node".into())
    };
    Defaults {
        pi: find_program("pi")
            .unwrap_or_else(|| "pi".into())
            .to_string_lossy()
            .into_owned(),
        node: node.to_string_lossy().into_owned(),
        cwd: std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default(),
    }
}

fn executable(path: &Path) -> Result<PathBuf, String> {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        which::which(path).map_err(|_| {
            format!(
                "Executable not found: {}. Set its full path in Runtime paths.",
                path.display()
            )
        })?
    };
    if !path.is_file() {
        return Err(format!("Executable not found: {}", path.display()));
    }
    Ok(path)
}

fn resource(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    app.path()
        .resolve(
            format!("resources/{name}"),
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_pi(
    app: tauri::AppHandle,
    host: tauri::State<'_, WorkspaceHost>,
    window: tauri::Window,
    config: LaunchConfig,
    token: String,
    on_event: Channel<Packet>,
) -> Result<LaunchInfo, String> {
    if app.state::<ExitState>().closing.load(Ordering::SeqCst) {
        return Err("Nimrod is shutting down".into());
    }
    if app
        .state::<session_deletion::SessionDeletion>()
        .snapshot()
        .pending
    {
        return Err("Session deletion is pending; new launches are blocked".into());
    }
    if token.is_empty() || token.len() > 128 {
        return Err("Invalid session token".into());
    }
    let cwd = config
        .cwd
        .canonicalize()
        .map_err(|e| format!("Invalid project directory: {e}"))?;
    if !cwd.is_dir() {
        return Err("Project must be a directory".into());
    }
    if app
        .state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        != Some(&cwd)
    {
        return Err("Open this directory as a project before starting a session".into());
    }
    if config.demo && config.mode != LaunchMode::Temporary {
        return Err("Demo must be temporary".into());
    }
    let session_name =
        sessions::validate_launch_name(config.mode, config.demo, config.session_name.as_deref())?;
    let selected = match (config.mode, config.session_file.as_deref()) {
        (LaunchMode::Resume, Some(path)) => {
            let path = path.to_owned();
            let project = cwd.clone();
            let info =
                tauri::async_runtime::spawn_blocking(move || sessions::inspect(&path, &project))
                    .await
                    .map_err(|e| e.to_string())??;
            if config
                .session_id
                .as_ref()
                .is_some_and(|id| id != &info.session_id)
            {
                return Err(
                    "The remembered session file was replaced with a different session".into(),
                );
            }
            if app
                .state::<session_deletion::SessionDeletion>()
                .blocked(&info.path)
            {
                return Err("Session is quarantined after deletion. Explicitly select it through Resume session to validate and recover it.".into());
            }
            Some(info)
        }
        (LaunchMode::Resume, None) => return Err("Resume requires an exact session file".into()),
        (_, Some(_)) => return Err("Only resume accepts a session file".into()),
        _ => None,
    };
    let node = executable(&config.node)?;
    let mut command = if config.demo {
        let mut command = Command::new(&node);
        command.arg(resource(&app, "demo.mjs")?);
        command
    } else {
        let pi = executable(&config.pi)?;
        let mut command = if pi
            .extension()
            .is_some_and(|e| e == "js" || e == "mjs" || e == "cjs")
        {
            let mut command = Command::new(&node);
            command.arg(pi);
            command
        } else {
            #[cfg(windows)]
            if pi.extension().is_some_and(|e| e == "cmd" || e == "bat") {
                return Err("For this PoC on Windows, select Pi's dist/cli.js rather than the npm .cmd wrapper.".into());
            }
            Command::new(pi)
        };
        command
            .args(["--mode", "rpc", "--offline", "--extension"])
            .arg(resource(&app, "pi-model-scope.ts")?);
        sessions::launch_args(&mut command, config.mode, selected.as_ref(), session_name);
        command
    };
    let mut paths = vec![node.parent().ok_or("Invalid Node path")?.to_path_buf()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    command.env(
        "PATH",
        std::env::join_paths(paths).map_err(|e| e.to_string())?,
    );
    host.start(
        window.label(),
        command,
        cwd.clone(),
        token,
        selected.as_ref().map(|info| info.path.clone()),
        Arc::new(move |packet| on_event.send(packet).map_err(|e| e.to_string())),
    )
    .await?;
    Ok(LaunchInfo {
        cwd,
        session: selected,
    })
}

#[tauri::command]
async fn session_file_info(
    host: tauri::State<'_, WorkspaceHost>,
    window: tauri::Window,
    token: String,
    path: PathBuf,
    session_id: String,
) -> Result<SessionFile, String> {
    let cwd = host.cwd(window.label(), &token).await?;
    let info = tauri::async_runtime::spawn_blocking(move || {
        sessions::reported_file(&path, &cwd, &session_id)
    })
    .await
    .map_err(|e| e.to_string())??;
    host.bind_file(window.label(), &token, info.path.clone())
        .await?;
    Ok(info)
}

#[tauri::command]
async fn write_pi(
    host: tauri::State<'_, WorkspaceHost>,
    window: tauri::Window,
    token: String,
    message: Value,
) -> Result<(), String> {
    host.write(window.label(), &token, message).await
}

#[tauri::command]
async fn stop_pi(
    host: tauri::State<'_, WorkspaceHost>,
    window: tauri::Window,
    token: Option<String>,
) -> Result<(), String> {
    host.stop_window(window.label(), token.as_deref()).await
}

#[tauri::command]
async fn open_link(
    host: tauri::State<'_, WorkspaceHost>,
    window: tauri::Window,
    token: String,
    href: String,
) -> Result<(), String> {
    let cwd = host.cwd(window.label(), &token).await?;
    open_link_at(&href, &cwd).await
}

async fn open_link_at(href: &str, cwd: &Path) -> Result<(), String> {
    match links::parse_link(href, cwd)? {
        links::Link::Web(url) => {
            tauri::async_runtime::spawn_blocking(move || open::that(url).map_err(|e| e.to_string()))
                .await
                .map_err(|e| e.to_string())?
        }
        file => {
            let args = links::editor_args(file)?;
            let editor = find_program("code")
                .or_else(|| {
                    let bundled = PathBuf::from(
                        "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
                    );
                    bundled.is_file().then_some(bundled)
                })
                .ok_or("Install VS Code's code launcher on PATH")?;
            // The CLI forwards to an already running editor; `open --args` does not.
            let mut command = Command::new(editor);
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                command.args(args).kill_on_drop(true).output(),
            )
            .await
            .map_err(|_| "Editor launch timed out")?
            .map_err(|e| e.to_string())?;
            if result.status.success() {
                Ok(())
            } else {
                Err("Could not open VS Code".into())
            }
        }
    }
}

#[derive(Default)]
struct ExitState {
    closing: AtomicBool,
    ready: AtomicBool,
}

fn request_exit(app: &tauri::AppHandle) {
    let exit = app.state::<ExitState>();
    if exit.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    for window in app.webview_windows().values() {
        if window.label().starts_with("popout-") {
            window_state::capture(&window.as_ref().window());
        } else {
            window_state::save(&window.as_ref().window());
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        app.state::<session_deletion::SessionDeletion>()
            .shutdown()
            .await;
        popouts::flush(&app).await;
        let result = app.state::<WorkspaceHost>().shutdown().await;
        if let Err(error) = result {
            eprintln!("Nimrod shutdown: {error}");
        }
        app.state::<ExitState>().ready.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

fn main() {
    let initial = match std::env::current_dir()
        .map_err(|e| e.to_string())
        .and_then(|cwd| cli::parse(std::env::args_os().skip(1), &cwd))
    {
        Ok(cli::Request::Help) => {
            print!("{}", cli::HELP);
            return;
        }
        Ok(request) => request,
        Err(error) => {
            eprintln!("nimrod: {error}");
            std::process::exit(2);
        }
    };
    tauri::Builder::default()
        .manage(WorkspaceHost::default())
        .manage(WorkspaceWindows::default())
        .manage(window_state::WindowStates::default())
        .manage(ExitState::default())
        .manage(popouts::Popouts::default())
        .manage(cli::CliRequests::default())
        // Register first: a second launch forwards its arguments and exits before creating UI.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let request = cli::parse(args.into_iter().skip(1).map(Into::into), Path::new(&cwd))
                .unwrap_or_else(cli::Request::Error);
            app.state::<cli::CliRequests>().enqueue(app, request);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            if let Err(error) = notifications::initialize(app.handle()) {
                // Notification integration must not prevent normal app startup;
                // subsequent prepare/diagnostics commands report the same failure.
                eprintln!("Notifications initialization: {error}");
            }
            native_menu::install(app.handle())?;
            let home = app.path().home_dir()?;
            let preferences = preferences::Preferences::new(&home);
            app.manage(session_deletion::SessionDeletion::new(&preferences));
            app.manage(preferences);
            preferences::watch(app.handle());
            let workspace = match &initial {
                cli::Request::Workspace(path) => Some(path.clone()),
                _ => None,
            };
            workspace_windows::open_initial_window(app.handle(), workspace)
                .map_err(std::io::Error::other)?;
            app.state::<cli::CliRequests>().ready(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_defaults,
            session_deletion::delete_session_tree,
            session_deletion::deletion_snapshot,
            session_deletion::acknowledge_deletion,
            session_deletion::confirm_session_deletion,
            session_deletion::recover_deletion_session,
            notifications::prepare_notifications,
            notifications::notify_session,
            notifications::test_notification,
            notifications::notification_diagnostics,
            popouts::open_code_popout,
            popouts::sync_popout_sessions,
            popouts::code_popout_snapshot,
            popouts::open_popout_link,
            preferences::preferences_snapshot,
            preferences::preferences_settings,
            preferences::preferences_state,
            preferences::preferences_migrate,
            open_workspace,
            window_workspace,
            list_workspace_sessions,
            inspect_workspace_session,
            start_pi,
            session_file_info,
            write_pi,
            stop_pi,
            open_link
        ])
        .on_menu_event(|app, event| {
            if native_menu::is_quit(event.id().as_ref()) {
                request_exit(app);
            } else if native_menu::is_open_project(event.id().as_ref()) {
                native_menu::open_project(app);
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                let app = window.app_handle();
                if app
                    .state::<popouts::Popouts>()
                    .on_focus(window.label(), *focused)
                {
                    if let Err(error) = popouts::hide_inactive(app) {
                        popouts::notify_error(app, error);
                    }
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = popouts::reconcile_visibility(&app).await {
                            popouts::notify_error(&app, error);
                        }
                    });
                }
            }
            if window.label().starts_with("popout-") {
                match event {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        window_state::capture(window)
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let window = window.clone();
                        tauri::async_runtime::spawn(async move {
                            popouts::close_popout(window).await;
                        });
                    }
                    tauri::WindowEvent::Destroyed => {
                        window
                            .app_handle()
                            .state::<popouts::Popouts>()
                            .forget_window(window.label());
                        window_state::forget(window);
                    }
                    _ => {}
                }
                return;
            }
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                window_state::capture(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window
                    .app_handle()
                    .state::<session_deletion::SessionDeletion>()
                    .cancel_owner(window.label());
                window
                    .app_handle()
                    .state::<popouts::Popouts>()
                    .retire(window.label());
                window_state::save(window);
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    let app = window.app_handle();
                    popouts::close_project(app, window.label()).await;
                    if let Err(error) = app
                        .state::<WorkspaceHost>()
                        .close_window(window.label())
                        .await
                    {
                        eprintln!("Nimrod window shutdown: {error}");
                    }
                    app.state::<WorkspaceWindows>()
                        .directories
                        .lock()
                        .unwrap()
                        .remove(window.label());
                    window_state::forget(&window);
                    let _ = window.destroy();
                });
            }
        })
        .build(tauri::generate_context!())
        .expect("Could not start Nimrod")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !app.state::<ExitState>().ready.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    request_exit(app);
                }
            }
            tauri::RunEvent::Exit if !app.state::<ExitState>().ready.load(Ordering::SeqCst) => {
                window_state::save_cached(app);
                popouts::save_cached(app);
            }
            _ => {}
        });
}
