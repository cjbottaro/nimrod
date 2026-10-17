#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod acp;
mod card_plugins;
mod cli;
mod command_usage;
mod copilot;
mod drafts;
mod keybindings;
mod links;
#[cfg(target_os = "macos")]
mod macos_window_appearance;
mod native_menu;
mod notifications;
mod performance_diagnostics;
mod plugin_compiler;
mod popout_store;
mod popout_windows;
mod popouts;
mod preferences;
mod process;
mod project_preferences;
mod session_catalog;
mod session_deletion;
mod session_files;
#[cfg(test)]
mod session_smoke;
mod sessions;
mod settings_window;
#[cfg(any(target_os = "macos", all(test, unix)))]
mod single_instance;
mod tool_capture;
mod webview_navigation;
mod window_appearance;
mod window_presentation;
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
    home: Option<String>,
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
async fn runtime_defaults(app: tauri::AppHandle) -> Defaults {
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
        home: app.path().home_dir().ok().map(|home| {
            std::fs::canonicalize(&home)
                .unwrap_or(home)
                .to_string_lossy()
                .into_owned()
        }),
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
    // A pending deletion is not a global launch restriction. Corrupt persisted
    // safety state still prevents saved resumes, not fresh conversations.
    if matches!(config.mode, LaunchMode::Resume) {
        if let Some(error) = app
            .state::<session_deletion::SessionDeletion>()
            .snapshot()
            .error
        {
            return Err(error);
        }
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
    let session_name = sessions::validate_launch_name(config.mode, config.session_name.as_deref())?;
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
            return Err(
                "On Windows, select Pi's dist/cli.js rather than the npm .cmd wrapper.".into(),
            );
        }
        Command::new(pi)
    };
    command
        .args(["--mode", "rpc", "--offline", "--extension"])
        .arg(resource(&app, "pi-model-scope.ts")?);
    sessions::launch_args(&mut command, config.mode, selected.as_ref(), session_name);
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

#[tauri::command]
async fn open_card_link(
    window: tauri::Window,
    workspaces: tauri::State<'_, WorkspaceWindows>,
    href: String,
) -> Result<(), String> {
    let cwd = workspaces
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or("Card links require an owned project window")?;
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
        if window.label() == settings_window::LABEL {
            continue;
        }
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
        let store = app.state::<drafts::Drafts>().inner().clone();
        if let Err(error) = tauri::async_runtime::spawn_blocking(move || store.flush(None, false))
            .await
            .unwrap_or_else(|error| Err(error.to_string()))
        {
            eprintln!("Draft shutdown flush: {error}");
        }
        let host = app.state::<WorkspaceHost>();
        let compiler = app.state::<plugin_compiler::Compiler>();
        let acp = app.state::<acp::AcpHost>();
        let copilot = app.state::<copilot::CopilotHost>();
        let (result, acp_result, copilot_result, ()) = tokio::join!(
            host.shutdown(),
            acp.shutdown(),
            copilot.shutdown(),
            compiler.shutdown()
        );
        if let Err(error) = copilot_result {
            eprintln!("Nimrod Copilot shutdown: {error}");
        }
        if let Err(error) = acp_result {
            eprintln!("Nimrod ACP shutdown: {error}");
        }
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
    let context = tauri::generate_context!();
    #[cfg(target_os = "macos")]
    let primary = match single_instance::start(&context.config().identifier) {
        Ok(Some(primary)) => Arc::new(primary),
        Ok(None) => return, // Forwarded before creating any native runtime/UI.
        Err(error) => {
            eprintln!("nimrod: Cannot establish single-instance ownership: {error}");
            std::process::exit(2);
        }
    };
    let builder = tauri::Builder::default()
        .manage(WorkspaceHost::default())
        .manage(acp::AcpHost::default())
        .manage(copilot::CopilotHost::default())
        .manage(WorkspaceWindows::default())
        .manage(project_preferences::ProjectPreferences::default())
        .manage(settings_window::SettingsWindow::default())
        .manage(window_state::WindowStates::default())
        .manage(ExitState::default())
        .manage(popouts::Popouts::default())
        .manage(native_menu::ProjectPickerRequests::default())
        .manage(cli::CliRequests::default());
    // Keep the existing Linux/Windows integration. macOS elects/binds above,
    // rather than using the plugin's racy connect/unlink/asynchronous-bind path.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let request = cli::parse(args.into_iter().skip(1).map(Into::into), Path::new(&cwd))
            .unwrap_or_else(cli::Request::Error);
        app.state::<cli::CliRequests>().enqueue(app, request);
    }));
    #[cfg(target_os = "macos")]
    let launch_listener = primary.clone();
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            launch_listener.listen(app.handle())?;
            if let Err(error) = notifications::initialize(app.handle()) {
                // Notification integration must not prevent normal app startup;
                // subsequent prepare/diagnostics commands report the same failure.
                eprintln!("Notifications initialization: {error}");
            }
            native_menu::install(app.handle())?;
            let home = app.path().home_dir()?;
            let preferences = preferences::Preferences::new(&home);
            app.manage(session_deletion::SessionDeletion::new(&preferences));
            app.manage(drafts::Drafts::new(
                preferences
                    .snapshot()
                    .state_path
                    .parent()
                    .unwrap()
                    .join("drafts"),
            ));
            app.manage(plugin_compiler::Compiler::bundled(
                preferences::directory(
                    &home,
                    std::env::var_os("XDG_CACHE_HOME").map(Into::into),
                    ".cache",
                )
                .join("card-plugins"),
            ));
            app.manage(preferences);
            drafts::watch(app.handle());
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
            drafts::drafts_load,
            drafts::drafts_stage,
            drafts::drafts_flush,
            drafts::drafts_references,
            runtime_defaults,
            window_appearance::window_appearance_capabilities,
            window_appearance::apply_window_appearance,
            window_appearance::tint_window_titlebar,
            card_plugins::read_card_plugin,
            card_plugins::read_card_plugin_module,
            card_plugins::load_personal_card_plugins,
            session_deletion::delete_session_tree,
            session_deletion::deletion_snapshot,
            session_deletion::acknowledge_deletion,
            session_deletion::confirm_session_deletion,
            session_deletion::recover_deletion_session,
            notifications::prepare_notifications,
            notifications::notify_session,
            notifications::focus_notification_window,
            notifications::test_notification,
            notifications::notification_diagnostics,
            popouts::open_code_popout,
            popouts::sync_popout_sessions,
            popouts::code_popout_snapshot,
            popouts::open_popout_link,
            performance_diagnostics::write_performance_report,
            tool_capture::append_tool_capture,
            tool_capture::tool_capture_directory,
            preferences::preferences_snapshot,
            project_preferences::scoped_preferences_snapshot,
            project_preferences::project_preferences_settings,
            settings_window::open_global_settings,
            settings_window::settings_window_ready,
            settings_window::window_opacity_preview_snapshot,
            settings_window::preview_window_opacity,
            settings_window::open_owned_project_settings,
            settings_window::take_project_settings_request,
            settings_window::take_settings_category,
            project_preferences::list_project_overrides,
            preferences::preferences_settings,
            preferences::preferences_state,
            preferences::record_command_usage,
            preferences::preferences_migrate,
            open_workspace,
            workspace_windows::list_projects,
            workspace_windows::open_project_directory,
            native_menu::take_project_picker_request,
            window_workspace,
            list_workspace_sessions,
            inspect_workspace_session,
            start_pi,
            acp::start_acp,
            acp::write_acp,
            acp::stop_acp,
            copilot::start_copilot,
            copilot::write_copilot,
            copilot::stop_copilot,
            session_file_info,
            write_pi,
            stop_pi,
            open_link,
            open_card_link
        ])
        .on_menu_event(|app, event| {
            if native_menu::is_quit(event.id().as_ref()) {
                request_exit(app);
            } else if event.id().as_ref() == native_menu::SETTINGS_ID {
                if let Err(error) = settings_window::open(app, None) {
                    eprintln!("Open Settings: {error}");
                }
            } else if event.id().as_ref() == native_menu::PROJECT_SETTINGS_ID {
                native_menu::open_project_settings(app);
            } else if native_menu::is_open_project(event.id().as_ref()) {
                native_menu::open_project(app);
            } else if event.id().as_ref() == native_menu::OPEN_RECENT_PROJECT_ID {
                native_menu::open_recent_project(app);
            } else if event.id().as_ref() == native_menu::MINIMIZE_ID {
                if let Some(window) = app
                    .webview_windows()
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                {
                    let _ = window.minimize();
                }
            } else if event.id().as_ref() == native_menu::CLOSE_WINDOW_ID {
                if let Some(window) = app
                    .webview_windows()
                    .values()
                    .find(|w| w.is_focused().unwrap_or(false))
                {
                    let _ = window.close();
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label() == settings_window::LABEL {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    settings_window::destroyed(window.app_handle());
                }
                // Settings is app-owned: native close must not run project teardown
                // or save its geometry under the welcome/project window's key.
                return;
            }
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
                    app.state::<copilot::CopilotHost>()
                        .retire_window(window.label())
                        .await;
                    popouts::close_project(app, window.label()).await;
                    let store = app.state::<drafts::Drafts>().inner().clone();
                    if let Err(error) =
                        tauri::async_runtime::spawn_blocking(move || store.flush(None, false))
                            .await
                            .unwrap_or_else(|error| Err(error.to_string()))
                    {
                        eprintln!("Draft window flush: {error}");
                    }
                    let pi = app.state::<WorkspaceHost>();
                    let acp = app.state::<acp::AcpHost>();
                    let copilot = app.state::<copilot::CopilotHost>();
                    let (pi_result, acp_result, copilot_result) = tokio::join!(
                        pi.close_window(window.label()),
                        acp.stop_window(window.label(), None, true),
                        copilot.stop_window(window.label(), None, true),
                    );
                    if let Err(error) = pi_result {
                        eprintln!("Nimrod window shutdown: {error}");
                    }
                    if let Err(error) = acp_result {
                        eprintln!("Nimrod ACP window shutdown: {error}");
                    }
                    if let Err(error) = copilot_result {
                        eprintln!("Nimrod Copilot window shutdown: {error}");
                    }
                    let store = app.state::<drafts::Drafts>().inner().clone();
                    if let Err(error) =
                        tauri::async_runtime::spawn_blocking(move || store.flush(None, false))
                            .await
                            .unwrap_or_else(|error| Err(error.to_string()))
                    {
                        eprintln!("Final draft window flush: {error}");
                    }
                    if let Some(cwd) = app
                        .state::<WorkspaceWindows>()
                        .directories
                        .lock()
                        .unwrap()
                        .remove(window.label())
                    {
                        app.state::<project_preferences::ProjectPreferences>()
                            .forget(&cwd);
                    }
                    window_state::forget(&window);
                    let _ = window.destroy();
                });
            }
        })
        .build(context)
        .expect("Could not start Nimrod")
        .run(move |app, event| {
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Exit) {
                primary.shutdown();
            }
            match event {
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
            }
        });
}
