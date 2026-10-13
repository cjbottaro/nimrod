//! Native backstop for links that bypass DOM click handlers (notably WebKit's
//! context-menu Open Link action). External content never replaces Nimrod.
use tauri::Emitter;
use url::Url;

#[derive(Clone)]
struct NavigationPolicy {
    app_bases: Vec<Url>,
}

#[derive(Debug, PartialEq)]
enum Destination {
    App,
    Browser,
    Blocked,
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
        && a.username() == b.username()
        && a.password() == b.password()
}

impl NavigationPolicy {
    fn destination(&self, url: &Url) -> Destination {
        for base in &self.app_bases {
            if same_origin(base, url) {
                // Only the app entry document may load/reload. Do not treat
                // arbitrary same-origin resources as navigable app pages.
                return if url.path() == base.path()
                    || (matches!(url.path(), "" | "/") && matches!(base.path(), "" | "/"))
                    || base
                        .join("index.html")
                        .is_ok_and(|entry| entry.path() == url.path())
                {
                    Destination::App
                } else {
                    Destination::Blocked
                };
            }
        }
        if matches!(url.scheme(), "http" | "https") {
            Destination::Browser
        } else {
            Destination::Blocked
        }
    }

    fn navigate(&self, url: &Url, new_window: bool, open: impl FnOnce(Url)) -> bool {
        match self.destination(url) {
            Destination::App => !new_window,
            Destination::Browser => {
                open(url.clone());
                false
            }
            Destination::Blocked => false,
        }
    }
}

fn open_browser(app: tauri::AppHandle, label: String, url: Url) {
    // Never block the UI/navigation delegate, and cancel navigation regardless
    // of whether the OS opener succeeds. No fallback to loading the webview.
    tauri::async_runtime::spawn(async move {
        let result = tauri::async_runtime::spawn_blocking(move || {
            open::that(url.as_str()).map_err(|error| error.to_string())
        })
        .await
        .unwrap_or_else(|error| Err(error.to_string()));
        if let Err(error) = result {
            let message = format!("Could not open link in your browser: {error}");
            if let Err(error) = app.emit_to(
                tauri::EventTarget::webview_window(label),
                "nimrod-link-error",
                message,
            ) {
                eprintln!("Nimrod link error delivery: {error}");
            }
        }
    });
}

pub fn guard<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
    app: &tauri::AppHandle,
    label: &str,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let builder = crate::window_appearance::prepare(builder);
    // Match Tauri's local protocol defaults. This app does not use
    // use_https_scheme or a remote frontendDist. Development also permits its
    // exact configured dev server; production never trusts that HTTP origin.
    let local = if cfg!(target_os = "windows") {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    let mut app_bases = vec![Url::parse(local).unwrap()];
    if tauri::is_dev()
        && let Some(dev_url) = &app.config().build.dev_url
    {
        app_bases.push(dev_url.clone());
    }
    let policy = NavigationPolicy { app_bases };
    let navigation_policy = policy.clone();
    let navigation_app = app.clone();
    let navigation_label = label.to_owned();
    let popup_app = app.clone();
    let popup_label = label.to_owned();
    builder
        .on_navigation(move |url| {
            navigation_policy.navigate(url, false, |url| {
                open_browser(navigation_app.clone(), navigation_label.clone(), url);
            })
        })
        .on_new_window(move |url, _features| {
            policy.navigate(&url, true, |url| {
                open_browser(popup_app.clone(), popup_label.clone(), url);
            });
            tauri::webview::NewWindowResponse::Deny
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy(base: &str) -> NavigationPolicy {
        NavigationPolicy {
            app_bases: vec![Url::parse(base).unwrap()],
        }
    }

    #[test]
    fn app_entry_reload_popout_and_fragments_remain_local_on_each_platform() {
        for base in [
            "tauri://localhost/",
            "http://tauri.localhost/",
            "http://127.0.0.1:1420/",
        ] {
            let policy = policy(base);
            for path in [
                "",
                "index.html",
                "index.html?popout",
                "index.html?popout#heading",
                "#heading",
            ] {
                let url = Url::parse(base).unwrap().join(path).unwrap();
                assert!(
                    policy.navigate(&url, false, |_| panic!("app opened externally")),
                    "{url}"
                );
                assert!(!policy.navigate(&url, true, |_| panic!("app popup opened externally")));
            }
        }
    }

    #[test]
    fn context_menu_navigation_and_new_window_requests_open_browser_once_and_cancel() {
        let policy = policy("tauri://localhost/");
        for raw in [
            "https://example.test/page?q=1#heading",
            "http://example.test/",
        ] {
            for new_window in [false, true] {
                let url = Url::parse(raw).unwrap();
                let mut opened = vec![];
                assert!(!policy.navigate(&url, new_window, |url| opened.push(url)));
                assert_eq!(opened, vec![url]);
            }
        }
    }

    #[test]
    fn unsupported_schemes_and_non_document_app_resources_never_navigate_or_open() {
        let policy = policy("tauri://localhost/");
        for raw in [
            "javascript:alert(1)",
            "data:text/html,test",
            "file:///tmp/test.html",
            "about:blank",
            "mailto:a@example.test",
            "tauri://other/index.html",
            "tauri://localhost/assets/test.js",
            "tauri://user@localhost/index.html",
        ] {
            for new_window in [false, true] {
                assert!(
                    !policy.navigate(&Url::parse(raw).unwrap(), new_window, |_| panic!(
                        "unsupported opener invoked"
                    )),
                    "{raw}"
                );
            }
        }
    }

    #[test]
    fn development_origin_is_exact_and_not_trusted_in_production() {
        let dev = policy("http://127.0.0.1:1420/");
        assert_eq!(
            dev.destination(&Url::parse("http://127.0.0.1:1420/index.html").unwrap()),
            Destination::App
        );
        for raw in [
            "http://127.0.0.1:1421/",
            "https://127.0.0.1:1420/",
            "http://127.0.0.1.example.test:1420/",
            "http://user@127.0.0.1:1420/",
        ] {
            assert_eq!(
                dev.destination(&Url::parse(raw).unwrap()),
                Destination::Browser
            );
        }
        assert_eq!(
            policy("tauri://localhost/")
                .destination(&Url::parse("http://127.0.0.1:1420/").unwrap()),
            Destination::Browser
        );
    }

    #[test]
    fn every_app_window_creation_path_installs_the_native_guard() {
        let projects = include_str!("workspace_windows.rs");
        assert_eq!(projects.matches("WebviewWindowBuilder::").count(), 2);
        assert_eq!(projects.matches("webview_navigation::guard(").count(), 2);
        let popouts = include_str!("popouts.rs");
        assert_eq!(popouts.matches("WebviewWindowBuilder::").count(), 1);
        assert_eq!(popouts.matches("webview_navigation::guard(").count(), 1);
    }
}
