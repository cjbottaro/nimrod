use font_kit::source::SystemSource;

#[derive(Clone, serde::Serialize)]
pub struct InstalledFont {
    family: String,
    monospace: bool,
}

fn catalog() -> Result<Vec<InstalledFont>, String> {
    let source = SystemSource::new();
    let mut families = source.all_families().map_err(|error| error.to_string())?;
    families.sort();
    families.dedup();
    let fonts: Vec<_> = families
        .into_iter()
        .filter(|family| {
            !family.starts_with('.')
                && family.chars().count() <= 200
                && family.trim() == family
                && !family.is_empty()
                && !family.chars().any(char::is_control)
        })
        .map(|family| {
            let monospace = source
                .select_family_by_name(&family)
                .map_err(|error| error.to_string())
                .and_then(|faces| {
                    faces
                        .fonts()
                        .first()
                        .ok_or_else(|| "No font faces".to_string())?
                        .load()
                        .map(|font| font.is_monospace())
                        .map_err(|error| error.to_string())
                })
                .unwrap_or_else(|error| {
                    eprintln!("Could not classify installed font {family}: {error}");
                    false
                });
            InstalledFont { family, monospace }
        })
        .collect();
    if fonts.is_empty() {
        return Err(
            "No installed font families were found. System default remains available.".into(),
        );
    }
    Ok(fonts)
}

#[tauri::command]
pub async fn installed_fonts(window: tauri::WebviewWindow) -> Result<Vec<InstalledFont>, String> {
    if window.label() != crate::settings_window::LABEL {
        return Err("Installed fonts can only be requested by global Settings".into());
    }
    tauri::async_runtime::spawn_blocking(catalog)
        .await
        .map_err(|error| error.to_string())?
}
