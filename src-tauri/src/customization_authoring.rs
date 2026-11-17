//! Installed-app authoring context for an explicit user customization request.
use std::path::PathBuf;
use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringContext {
    project_directory: PathBuf,
    ui_directory: PathBuf,
    card_plugins_directory: PathBuf,
    reference_directory: PathBuf,
    cli_executable: PathBuf,
    version: String,
    platform: &'static str,
}

const REFERENCES: &[&str] = &[
    "docs/ui-templates.md",
    "docs/card-plugins.md",
    "docs/card-plugin-api.md",
    "docs/cli-actions.md",
    "src/card-plugin-api.ts",
    "src/ui-templates/layout.html",
    "src/ui-templates/layout.css",
    "src/ui-templates/project-bar.html",
    "src/ui-templates/project-bar.css",
    "examples/card-plugins/acp-shell/plugin.ts",
];

fn verify_references(directory: &std::path::Path) -> Result<(), String> {
    for file in REFERENCES {
        if !directory.join(file).is_file() {
            return Err(format!(
                "Bundled customization reference is missing: {}. Use a complete Nimrod installation.",
                directory.join(file).display()
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn customization_authoring_context(window: tauri::Window) -> Result<AuthoringContext, String> {
    let app = window.app_handle();
    let project_directory = app
        .state::<crate::workspace_windows::WorkspaceWindows>()
        .directories
        .lock()
        .map_err(|_| "Project ownership lock poisoned")?
        .get(window.label())
        .cloned()
        .ok_or("Customization requests require a project window")?;
    if app
        .state::<crate::ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    let snapshot = app.state::<crate::preferences::Preferences>().snapshot();
    let directory = snapshot
        .settings_path
        .parent()
        .ok_or("Missing global settings directory")?;
    let reference_directory = app
        .path()
        .resolve(
            "resources/customization",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|error| error.to_string())?;
    verify_references(&reference_directory)?;
    let cli_executable = std::env::current_exe()
        .map_err(|error| format!("Cannot locate Nimrod executable: {error}"))?;
    if !cli_executable.is_file() {
        return Err("The running Nimrod executable is no longer available. Restart the updated app before requesting customization.".into());
    }
    Ok(AuthoringContext {
        project_directory,
        ui_directory: directory.join("ui"),
        card_plugins_directory: directory.join("card-plugins"),
        reference_directory,
        cli_executable,
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requires_installed_references_without_using_a_project_checkout() {
        let installation = tempfile::tempdir().unwrap();
        let references = installation.path().join("App resources/customization");
        for file in REFERENCES {
            let path = references.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "fixture reference").unwrap();
        }
        verify_references(&references).unwrap();
        std::fs::remove_file(references.join("src/card-plugin-api.ts")).unwrap();
        assert!(
            verify_references(&references)
                .unwrap_err()
                .contains("card-plugin-api.ts")
        );
    }
}
