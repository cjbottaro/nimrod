//! Terminal routing and a separate, narrow action-client argument path. Never starts sessions.
use std::{
    collections::VecDeque,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub const HELP: &str = "Usage: nimrod [DIRECTORY]\n       nimrod -- DIRECTORY\n       nimrod --action reload-customizations [--project DIRECTORY] [--json]\n\nOpen or focus a project. No session is started.\nThe terminal launcher defaults DIRECTORY to the current directory.\nActions target an already-open project (default: current directory), wait for completion,\nand never launch the app, open/focus a window or resume a session.\n";

#[derive(Debug, PartialEq)]
pub enum Request {
    Focus,
    Workspace(PathBuf),
    Action(crate::cli_actions::ActionRequest, bool),
    Help,
    Error(String),
}

pub fn parse(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Result<Request, String> {
    let args: Vec<_> = args.into_iter().collect();
    if args.first().is_none_or(|arg| arg != "--")
        && args
            .iter()
            .any(|arg| arg == "--action" || arg == "--project" || arg == "--json")
    {
        return parse_action(&args, cwd);
    }
    let path = match args.as_slice() {
        [] => return Ok(Request::Focus),
        [arg] if arg == "--help" || arg == "-h" => return Ok(Request::Help),
        [arg] if arg.to_string_lossy().starts_with("-psn_") => return Ok(Request::Focus),
        [flag, path] if flag == "--workspace" || flag == "--" => path,
        [path] if !path.to_string_lossy().starts_with('-') => path,
        _ => return Err("Expected one project directory. Use nimrod --help for usage.".into()),
    };
    let path = PathBuf::from(path);
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot open project {}: {e}", path.display()))?;
    if !path.is_dir() {
        return Err(format!("Project is not a directory: {}", path.display()));
    }
    Ok(Request::Workspace(path))
}

fn parse_action(args: &[OsString], cwd: &Path) -> Result<Request, String> {
    let mut action = None;
    let mut project = None;
    let mut json = false;
    let mut args = args.iter();
    while let Some(flag) = args.next() {
        match flag.to_str() {
            Some("--action") if action.is_none() => {
                let value = args.next().ok_or("--action requires a name")?;
                if value != "reload-customizations" {
                    return Err(
                        "Unsupported action; only reload-customizations is available".into(),
                    );
                }
                action = Some(crate::cli_actions::Action::ReloadCustomizations);
            }
            Some("--project") if project.is_none() => {
                project = Some(PathBuf::from(
                    args.next().ok_or("--project requires a directory")?,
                ))
            }
            Some("--json") if !json => json = true,
            _ => return Err("Invalid or repeated action argument. Use nimrod --help.".into()),
        }
    }
    let action = action.ok_or("--project and --json require --action")?;
    let project = project.unwrap_or_else(|| cwd.to_path_buf());
    if project.as_os_str().is_empty() {
        return Err("--project requires a nonempty directory".into());
    }
    let project = if project.is_absolute() {
        project
    } else {
        cwd.join(project)
    };
    let project = project
        .canonicalize()
        .map_err(|error| format!("Cannot resolve project {}: {error}", project.display()))?;
    if !project.is_dir() {
        return Err("Project is not a directory".into());
    }
    Ok(Request::Action(
        crate::cli_actions::ActionRequest {
            version: 1,
            action,
            project,
        },
        json,
    ))
}

#[derive(Default)]
struct Queue {
    ready: bool,
    running: bool,
    requests: VecDeque<Request>,
}
impl Queue {
    fn start(&mut self) -> bool {
        if !self.ready || self.running || self.requests.is_empty() {
            return false;
        }
        self.running = true;
        true
    }
    fn next(&mut self) -> Option<Request> {
        let request = self.requests.pop_front();
        if request.is_none() {
            self.running = false;
        }
        request
    }
}

#[derive(Default)]
pub struct CliRequests(Mutex<Queue>);
impl CliRequests {
    pub fn enqueue(&self, app: &tauri::AppHandle, request: Request) {
        if matches!(request, Request::Action(..)) {
            eprintln!("CLI actions require the request/reply endpoint, not launch forwarding");
            return;
        }
        let start = {
            let mut queue = self.0.lock().unwrap();
            queue.requests.push_back(request);
            queue.start()
        };
        if start {
            self.drain(app);
        }
    }
    pub fn ready(&self, app: &tauri::AppHandle) {
        let start = {
            let mut queue = self.0.lock().unwrap();
            queue.ready = true;
            queue.start()
        };
        if start {
            self.drain(app);
        }
    }
    fn drain(&self, app: &tauri::AppHandle) {
        let app = app.clone();
        // Window creation must not block the main/UI thread. One worker preserves
        // received order; startup requests wait until initial workspace binding.
        tauri::async_runtime::spawn(async move {
            loop {
                let request = app.state::<CliRequests>().0.lock().unwrap().next();
                let Some(request) = request else {
                    break;
                };
                let result = match request {
                    Request::Workspace(path) => {
                        crate::workspace_windows::route_workspace(&app, None, path).map(|_| ())
                    }
                    Request::Focus => crate::window_presentation::focus_existing(&app),
                    Request::Help => Ok(()),
                    Request::Action(..) => {
                        unreachable!("Action requests never enter the launch queue")
                    }
                    Request::Error(error) => Err(error),
                };
                if let Err(error) = result {
                    report(&app, error);
                }
            }
        });
    }
}

pub fn report(app: &tauri::AppHandle, error: String) {
    eprintln!("Nimrod: {error}");
    app.dialog()
        .message(error)
        .title("Could not open project")
        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
        .show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(args: &[&str], cwd: &Path) -> Result<Request, String> {
        parse(args.iter().map(OsString::from), cwd)
    }
    #[test]
    fn parses_terminal_paths_and_rejects_invalid_invocations() {
        assert!(HELP.contains("Open or focus a project"));
        assert!(!HELP.contains("workspace"));
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().canonicalize().unwrap();
        std::fs::create_dir(cwd.join("with spaces")).unwrap();
        std::fs::create_dir(cwd.join("-leading-dash")).unwrap();
        std::fs::write(cwd.join("file"), "fixture").unwrap();
        assert_eq!(request(&[], &cwd).unwrap(), Request::Focus);
        assert_eq!(request(&["--help"], &cwd).unwrap(), Request::Help);
        assert_eq!(
            request(&["."], &cwd).unwrap(),
            Request::Workspace(cwd.clone())
        );
        assert_eq!(
            request(&["--workspace", "with spaces"], &cwd).unwrap(),
            Request::Workspace(cwd.join("with spaces"))
        );
        assert_eq!(
            request(&["--", "-leading-dash"], &cwd).unwrap(),
            Request::Workspace(cwd.join("-leading-dash"))
        );
        assert!(
            request(&["file"], &cwd)
                .unwrap_err()
                .starts_with("Project is not a directory:")
        );
        assert!(
            request(&["missing"], &cwd)
                .unwrap_err()
                .starts_with("Cannot open project ")
        );
        for args in [
            &["--workspace"][..],
            &["a", "b"],
            &["--unknown"],
            &["missing"],
            &["file"],
        ] {
            assert!(request(args, &cwd).is_err());
        }
    }
    #[test]
    fn action_arguments_are_explicit_bounded_and_do_not_become_launch_requests() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().canonicalize().unwrap();
        std::fs::create_dir(cwd.join("project with spaces")).unwrap();
        assert_eq!(
            request(&["--action", "reload-customizations"], &cwd).unwrap(),
            Request::Action(
                crate::cli_actions::ActionRequest {
                    version: 1,
                    action: crate::cli_actions::Action::ReloadCustomizations,
                    project: cwd.clone()
                },
                false
            )
        );
        assert_eq!(
            request(
                &[
                    "--json",
                    "--project",
                    "project with spaces",
                    "--action",
                    "reload-customizations"
                ],
                &cwd
            )
            .unwrap(),
            Request::Action(
                crate::cli_actions::ActionRequest {
                    version: 1,
                    action: crate::cli_actions::Action::ReloadCustomizations,
                    project: cwd.join("project with spaces")
                },
                true
            )
        );
        for args in [
            vec!["--action"],
            vec!["--action", "delete"],
            vec!["--json"],
            vec!["--project", "."],
            vec!["--action", "reload-customizations", "--project", ""],
            vec!["--action", "reload-customizations", "--json", "--json"],
            vec![
                "--action",
                "reload-customizations",
                "--action",
                "reload-customizations",
            ],
            vec!["--action", "reload-customizations", "--project", "missing"],
            vec!["--action", "reload-customizations", "."],
        ] {
            assert!(request(&args, &cwd).is_err(), "{args:?}");
        }
        std::fs::create_dir(cwd.join("--action")).unwrap();
        assert_eq!(
            request(&["--", "--action"], &cwd).unwrap(),
            Request::Workspace(cwd.join("--action"))
        );
    }
    #[cfg(unix)]
    #[test]
    fn canonical_aliases_resolve_to_the_same_workspace_identity() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("project")).unwrap();
        std::os::unix::fs::symlink(temp.path().join("project"), temp.path().join("alias")).unwrap();
        assert_eq!(
            request(&["alias"], temp.path()).unwrap(),
            request(&["project/../project"], temp.path()).unwrap()
        );
    }
    #[test]
    fn forwarded_requests_wait_for_setup_and_have_one_ordered_worker() {
        let mut queue = Queue::default();
        queue.requests.push_back(Request::Focus);
        assert!(!queue.start());
        queue.ready = true;
        assert!(queue.start());
        queue
            .requests
            .push_back(Request::Workspace("/fixture".into()));
        assert!(!queue.start());
        assert_eq!(queue.next(), Some(Request::Focus));
        assert_eq!(queue.next(), Some(Request::Workspace("/fixture".into())));
        assert_eq!(queue.next(), None);
        queue.requests.push_back(Request::Focus);
        assert!(queue.start());
    }
}
