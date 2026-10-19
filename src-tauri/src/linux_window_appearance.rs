//! Window-local GTK chrome tinting, without desktop/compositor policy or custom controls.
use gtk::prelude::*;
use std::{cell::RefCell, collections::HashMap};

#[derive(Clone)]
struct Chrome {
    class: String,
    provider: gtk::CssProvider,
}

thread_local! {
    // Accessed only by window_appearance's main-thread dispatch. GTK objects never
    // cross threads or retain their window; destroy removes the screen provider.
    static CHROME: RefCell<HashMap<usize, Chrome>> = RefCell::new(HashMap::new());
}

fn stylesheet(class: &str, background: [u8; 4], foreground: [u8; 4]) -> String {
    let [r, g, b, a] = background;
    let [fr, fg, fb, _] = foreground;
    include_str!("linux_window_appearance.css")
        .replace("$scope", class)
        .replace(
            "$background",
            &format!("rgba({r}, {g}, {b}, {})", f64::from(a) / 255.0),
        )
        .replace("$foreground", &format!("rgb({fr}, {fg}, {fb})"))
        .replace("$hover", &format!("rgba({fr}, {fg}, {fb}, 0.15)"))
        .replace("$active", &format!("rgba({fr}, {fg}, {fb}, 0.25)"))
        .replace("$disabled", &format!("rgba({fr}, {fg}, {fb}, 0.45)"))
}

pub fn tint(
    window: &tauri::WebviewWindow,
    background: [u8; 4],
    foreground: [u8; 4],
) -> Result<(), String> {
    let native = window.gtk_window().map_err(|error| error.to_string())?;
    let screen = gtk::prelude::GtkWindowExt::screen(&native).ok_or("GTK screen is unavailable")?;
    let key = native.as_ptr() as usize;
    let existing = CHROME.with(|chrome| chrome.borrow().get(&key).cloned());
    let state = existing.clone().unwrap_or_else(|| Chrome {
        class: format!("nimrod-chrome-{}", uuid::Uuid::new_v4().simple()),
        provider: gtk::CssProvider::new(),
    });
    state
        .provider
        .load_from_data(stylesheet(&state.class, background, foreground).as_bytes())
        .map_err(|error| error.to_string())?;
    if existing.is_none() {
        native.style_context().add_class(&state.class);
        gtk::StyleContext::add_provider_for_screen(
            &screen,
            &state.provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
        CHROME.with(|chrome| chrome.borrow_mut().insert(key, state));
        native.connect_destroy(move |_| {
            let state = CHROME.with(|chrome| chrome.borrow_mut().remove(&key));
            if let Some(state) = state {
                gtk::StyleContext::remove_provider_for_screen(&screen, &state.provider);
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_is_window_scoped_and_preserves_foreground_at_every_opacity() {
        for alpha in [0, 64, 128, 255] {
            let css = stylesheet("nimrod-chrome-fixture", [18, 52, 86, alpha], [210, 220, 230, 128]);
            assert!(!css.contains('$'));
            assert!(css.contains(&format!("rgba(18, 52, 86, {})", f64::from(alpha) / 255.0)));
            assert!(css.contains("rgb(210, 220, 230)"));
            assert!(!css.contains("theme_bg_color"));
            assert!(!css.contains("opacity:"));
            for line in css
                .lines()
                .filter(|line| line.contains('{') || line.trim_end().ends_with(','))
            {
                assert!(line.starts_with("window.nimrod-chrome-fixture"), "{line}");
            }
        }
    }
}
