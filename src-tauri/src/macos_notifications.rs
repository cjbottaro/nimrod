//! macOS notifications use UserNotifications directly, not the plugin's legacy
//! NSUserNotificationCenter / bundle-identity swizzling / fire-and-forget path.
//! Unit tests deliberately never initialize the real notification center.

use block2::{DynBlock, RcBlock};
use objc2::{
    ClassType, MainThreadMarker, define_class, msg_send, rc::Retained, runtime::ProtocolObject,
};
use objc2_app_kit::NSApplication;
use objc2_foundation::{NSBundle, NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAlertStyle, UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSetting, UNNotificationSettings,
    UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use std::{
    cell::OnceCell,
    ptr::NonNull,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::oneshot;

use super::NotificationDispatch;

static FOREGROUND_CALLS: AtomicU64 = AtomicU64::new(0);
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

fn presentation_options() -> UNNotificationPresentationOptions {
    UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "NimrodNotificationDelegate"]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            // Session/focus policy has already selected this alert. No sound/badge,
            // navigation or override of OS styles/Focus. Always finish the callback.
            FOREGROUND_CALLS.fetch_add(1, Ordering::Relaxed);
            completion.call((presentation_options(),));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn respond(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            // SAFETY: Apple's immutable exported action identifier.
            let open =
                &*response.actionIdentifier() == unsafe { UNNotificationDefaultActionIdentifier };
            let identifier = response.notification().request().identifier().to_string();
            completion.call(());
            if open && let Some(app) = APP.get() {
                super::clicked(app, &identifier);
            }
        }
    }
);

// UNUserNotificationCenter.delegate is weak. Retain our delegate for
// the app lifetime, on the main thread where every center operation is scheduled.
thread_local! {
    static DELEGATE: OnceCell<Retained<NotificationDelegate>> = const { OnceCell::new() };
}

fn center(identifier: &str) -> Result<Retained<UNUserNotificationCenter>, String> {
    // currentNotificationCenter can raise an Objective-C exception outside an
    // application bundle. Fail explicitly rather than posing as Terminal/Finder.
    let bundle = NSBundle::mainBundle()
        .bundleIdentifier()
        .map(|id| id.to_string());
    if bundle.as_deref() != Some(identifier) {
        return Err("macOS notifications require the packaged Nimrod.app; this process has no matching application bundle".into());
    }
    let center = UNUserNotificationCenter::currentNotificationCenter();
    DELEGATE.with(|slot| -> Result<(), String> {
        let delegate = slot.get_or_init(|| {
            // SAFETY: NSObject's new initializes our stateless NSObject subclass.
            unsafe { msg_send![NotificationDelegate::class(), new] }
        });
        let expected = ProtocolObject::from_ref(&**delegate);
        if let Some(existing) = center.delegate() {
            if !std::ptr::eq(&*existing, expected) {
                return Err("macOS notification center has an unexpected delegate; refusing to replace its callbacks".into());
            }
        } else {
            center.setDelegate(Some(expected));
        }
        Ok(())
    })?;
    Ok(center)
}

/// Install before application launch finishes, not only after the first request.
/// Unbundled dev executables remain usable; attempts still report the bundle requirement.
pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = APP.set(app.clone());
    let identifier = app.config().identifier.as_str();
    if NSBundle::mainBundle()
        .bundleIdentifier()
        .map(|id| id.to_string())
        .as_deref()
        == Some(identifier)
    {
        center(identifier)?;
    }
    Ok(())
}

fn settings_summary(
    status: UNAuthorizationStatus,
    style: UNAlertStyle,
    alerts: UNNotificationSetting,
    list: UNNotificationSetting,
    active: bool,
    calls: u64,
) -> String {
    let authorization = match status {
        UNAuthorizationStatus::Authorized => "authorized",
        UNAuthorizationStatus::NotDetermined => "not requested",
        UNAuthorizationStatus::Denied => "denied",
        UNAuthorizationStatus::Provisional => "provisional (quiet)",
        UNAuthorizationStatus::Ephemeral => "ephemeral",
        _ => "unknown",
    };
    let style = match style {
        UNAlertStyle::None => "none",
        UNAlertStyle::Banner => "temporary",
        UNAlertStyle::Alert => "persistent",
        _ => "unknown",
    };
    let setting = |value| match value {
        UNNotificationSetting::Enabled => "enabled",
        UNNotificationSetting::Disabled => "disabled",
        _ => "unsupported/unknown",
    };
    format!(
        "macOS: {authorization}; desktop alerts: {}; style: {style}; Notification Center: {}; app active: {}; foreground handler calls: {calls} (requests Banner + List).",
        setting(alerts),
        setting(list),
        if active { "yes" } else { "no" }
    )
}

/// Read-only: never requests permission or posts a notification. Counts are per
/// running app, not an assertion that the latest accepted request was presented.
pub async fn diagnostics(app: &tauri::AppHandle) -> Result<String, String> {
    let identifier = app.config().identifier.clone();
    on_main(
        app,
        "diagnostics",
        Duration::from_secs(10),
        move |completion| {
            let center = center(&identifier)?;
            let mtm = MainThreadMarker::new()
                .ok_or("Notification diagnostics must run on the main thread")?;
            let active = NSApplication::sharedApplication(mtm).isActive();
            let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: the framework supplies this object for the callback duration.
                let settings = unsafe { settings.as_ref() };
                finish(
                    &completion,
                    Ok(settings_summary(
                        settings.authorizationStatus(),
                        settings.alertStyle(),
                        settings.alertSetting(),
                        settings.notificationCenterSetting(),
                        active,
                        FOREGROUND_CALLS.load(Ordering::Relaxed),
                    )),
                );
            });
            center.getNotificationSettingsWithCompletionHandler(&callback);
            Ok(())
        },
    )
    .await
}

type Completion<T> = Arc<Mutex<Option<oneshot::Sender<Result<T, String>>>>>;

fn finish<T>(completion: &Completion<T>, result: Result<T, String>) {
    if let Some(sender) = completion.lock().unwrap().take() {
        // A timeout/closed window may have dropped the receiver. Never resend.
        let _ = sender.send(result);
    }
}

async fn wait<T>(
    receiver: oneshot::Receiver<Result<T, String>>,
    phase: &str,
    timeout: Duration,
) -> Result<T, String> {
    tokio::time::timeout(timeout, receiver)
        .await
        .map_err(|_| format!("macOS notification {phase} timed out; nothing will be retried"))?
        .map_err(|_| format!("macOS notification {phase} callback was lost"))?
}

async fn on_main<T: Send + 'static>(
    app: &tauri::AppHandle,
    phase: &'static str,
    timeout: Duration,
    start: impl FnOnce(Completion<T>) -> Result<(), String> + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = oneshot::channel();
    let completion = Arc::new(Mutex::new(Some(sender)));
    app.run_on_main_thread(move || {
        if completion
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|sender| sender.is_closed())
        {
            return; // A timed-out main-thread task must not start a late submission.
        }
        if let Err(error) = start(Arc::clone(&completion)) {
            finish(&completion, Err(error));
        }
    })
    .map_err(|e| e.to_string())?;
    wait(receiver, phase, timeout).await
}

fn authorization_required(status: UNAuthorizationStatus) -> Result<bool, String> {
    match status {
        UNAuthorizationStatus::NotDetermined => Ok(true),
        UNAuthorizationStatus::Authorized | UNAuthorizationStatus::Provisional | UNAuthorizationStatus::Ephemeral => Ok(false),
        UNAuthorizationStatus::Denied => Err("macOS denied notification authorization for Nimrod. Check System Settings → Notifications → Nimrod.".into()),
        _ => Err(format!("Unknown macOS notification authorization status: {}", status.0)),
    }
}

fn native_error(error: *mut NSError, phase: &str) -> Result<(), String> {
    // SAFETY: framework callback arguments are valid for the callback's duration.
    // Only an owned error description crosses into the async Rust task.
    match unsafe { error.as_ref() } {
        Some(error) => Err(format!(
            "macOS notification {phase}: {} ({} / {})",
            error.localizedDescription(),
            error.domain(),
            error.code()
        )),
        None => Ok(()),
    }
}

/// Called before the shell's final focus/selection/lifecycle revalidation. A first
/// authorization prompt must not cause a stale alert after selection or Close.
pub async fn prepare(app: &tauri::AppHandle) -> Result<(), String> {
    // Serialize first-time authorization across sessions/project windows.
    static AUTHORIZATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = AUTHORIZATION.lock().await;
    let identifier = app.config().identifier.clone();
    let status = on_main(
        app,
        "settings lookup",
        Duration::from_secs(10),
        move |completion| {
            let center = center(&identifier)?;
            let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: the framework supplies a non-null settings object for this callback.
                let status = unsafe { settings.as_ref() }.authorizationStatus();
                finish(&completion, Ok(status));
            });
            center.getNotificationSettingsWithCompletionHandler(&callback);
            Ok(())
        },
    )
    .await?;
    if authorization_required(status)? {
        let identifier = app.config().identifier.clone();
        on_main(app, "authorization", Duration::from_secs(120), move |completion| {
            let center = center(&identifier)?;
            let callback = RcBlock::new(move |granted: objc2::runtime::Bool, error: *mut NSError| {
                let result = native_error(error, "authorization").and_then(|()| if granted.as_bool() { Ok(()) } else {
                    Err("macOS denied notification authorization for Nimrod. Check System Settings → Notifications → Nimrod.".into())
                });
                finish(&completion, result);
            });
            center.requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert, &callback);
            Ok(())
        }).await?;
    }
    Ok(())
}

pub async fn send(
    app: &tauri::AppHandle,
    window: tauri::Window,
    selected: bool,
    title: String,
    body: String,
    click_identifier: Option<String>,
) -> Result<NotificationDispatch, String> {
    // The router holds its registry while waiting for main-thread window creation.
    // Validate immutable window/project ownership here, never lock it on the main thread.
    super::project(app, &window)?;
    let identifier = app.config().identifier.clone();
    let app_guard = app.clone();
    on_main(
        app,
        "submission",
        Duration::from_secs(10),
        move |completion| {
            // Recheck native eligibility on the actual dispatch thread, after any
            // authorization wait. Nothing is posted for a closing/disabled window.
            if super::suppressed(&app_guard, &window, selected)? {
                finish(&completion, Ok(NotificationDispatch::Suppressed));
                return Ok(());
            }
            let center = center(&identifier)?;
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&title));
            content.setBody(&NSString::from_str(&body));
            // Routing lives in the opaque request identifier, never the banner body.
            // A unique event ID allows multiple alerts for the same runtime session.
            let identifier = click_identifier.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&identifier),
                &content,
                None,
            );
            let callback = RcBlock::new(move |error: *mut NSError| {
                finish(
                    &completion,
                    native_error(error, "submission").map(|()| NotificationDispatch::Submitted),
                );
            });
            center.addNotificationRequest_withCompletionHandler(&request, Some(&callback));
            Ok(())
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::sel;

    #[test]
    fn foreground_delegate_requests_banner_and_list_without_sound() {
        let options = presentation_options();
        assert!(options.contains(UNNotificationPresentationOptions::Banner));
        assert!(options.contains(UNNotificationPresentationOptions::List));
        assert!(!options.contains(UNNotificationPresentationOptions::Sound));
        assert!(
            NotificationDelegate::class()
                .instance_method(
                    sel!(userNotificationCenter:willPresentNotification:withCompletionHandler:)
                )
                .is_some()
        );
    }

    #[test]
    fn delegate_registers_notification_click_callback() {
        assert!(NotificationDelegate::class().instance_method(
            sel!(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:)
        ).is_some());
    }

    #[test]
    fn diagnostics_distinguish_center_only_policy_and_foreground_calls() {
        let center_only = settings_summary(
            UNAuthorizationStatus::Authorized,
            UNAlertStyle::None,
            UNNotificationSetting::Disabled,
            UNNotificationSetting::Enabled,
            true,
            0,
        );
        assert!(
            center_only
                .contains("desktop alerts: disabled; style: none; Notification Center: enabled")
        );
        assert!(center_only.contains("app active: yes; foreground handler calls: 0"));
        let banner = settings_summary(
            UNAuthorizationStatus::Authorized,
            UNAlertStyle::Banner,
            UNNotificationSetting::Enabled,
            UNNotificationSetting::Enabled,
            true,
            2,
        );
        assert!(banner.contains("style: temporary"));
        assert!(banner.contains("foreground handler calls: 2"));
        let provisional = settings_summary(
            UNAuthorizationStatus::Provisional,
            UNAlertStyle::Alert,
            UNNotificationSetting::Enabled,
            UNNotificationSetting::Enabled,
            false,
            0,
        );
        assert!(provisional.contains("provisional (quiet)"));
        assert!(provisional.contains("app active: no"));
    }

    #[test]
    fn authorization_denial_and_unknown_states_are_not_success() {
        assert_eq!(
            authorization_required(UNAuthorizationStatus::NotDetermined),
            Ok(true)
        );
        assert_eq!(
            authorization_required(UNAuthorizationStatus::Authorized),
            Ok(false)
        );
        assert!(
            authorization_required(UNAuthorizationStatus::Denied)
                .unwrap_err()
                .contains("denied")
        );
        assert!(authorization_required(UNAuthorizationStatus(99)).is_err());
    }

    #[tokio::test]
    async fn callbacks_propagate_errors_and_timeouts_without_retrying() {
        let (sender, receiver) = oneshot::channel::<Result<(), String>>();
        let completion = Arc::new(Mutex::new(Some(sender)));
        finish(&completion, Err("fixture native error".into()));
        finish(&completion, Ok(())); // Duplicate callback cannot replace the error.
        assert_eq!(
            wait(receiver, "fixture", Duration::from_secs(1)).await,
            Err("fixture native error".into())
        );
        let (sender, receiver) = oneshot::channel::<Result<(), String>>();
        assert!(
            wait(receiver, "fixture", Duration::ZERO)
                .await
                .unwrap_err()
                .contains("timed out")
        );
        drop(sender);
        assert!(native_error(std::ptr::null_mut(), "fixture").is_ok());
        // Only NSError construction: never initializes the center or sends an alert.
        // SAFETY: valid domain/code and no userInfo objects with thread-safety constraints.
        let error = unsafe {
            NSError::errorWithDomain_code_userInfo(
                &NSString::from_str("NimrodFixtureError"),
                42,
                None,
            )
        };
        assert!(
            native_error(&*error as *const NSError as *mut NSError, "fixture")
                .unwrap_err()
                .contains("42")
        );
    }
}
