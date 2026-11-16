use super::*;

fn success() -> ReloadResult {
    ReloadResult {
        ui_templates: TemplateResult {
            applied: true,
            error: None,
        },
        card_plugins: CardResult {
            report: Some(CardReport {
                personal_loaded: 2,
                cache_hits: 1,
                manifest_loaded: 0,
            }),
            error: None,
        },
    }
}

#[tokio::test]
async fn completion_is_bound_to_request_and_window_and_close_retires_waiters() {
    let host = CliActions::default();
    let (sender, receiver) = oneshot::channel();
    host.pending.lock().unwrap().insert(
        "fixture".into(),
        Pending {
            window: "project-a".into(),
            result: sender,
        },
    );
    assert!(host.complete("project-b", "fixture", success()).is_err());
    assert!(host.pending.lock().unwrap().contains_key("fixture"));
    host.complete("project-a", "fixture", success()).unwrap();
    assert!(receiver.await.unwrap().ok());
    assert!(host.complete("project-a", "fixture", success()).is_err());
    let (sender, receiver) = oneshot::channel();
    host.pending.lock().unwrap().insert(
        "closed".into(),
        Pending {
            window: "project-a".into(),
            result: sender,
        },
    );
    host.forget_window("project-b");
    assert!(host.pending.lock().unwrap().contains_key("closed"));
    host.forget_window("project-a");
    assert!(receiver.await.is_err());
}

#[test]
fn close_fences_late_readiness_without_affecting_other_windows() {
    let host = CliActions::default();
    host.mark_ready("project-a").unwrap();
    host.forget_window("project-a");
    assert!(host.mark_ready("project-a").is_err());
    host.mark_ready("project-b").unwrap();
    assert_eq!(host.ready.lock().unwrap().get("project-b"), Some(&true));
    host.shutdown();
    assert!(host.mark_ready("project-c").is_err());
}

#[test]
fn targets_exactly_one_project_without_falling_back_to_another_window() {
    let mut directories = HashMap::from([
        ("project-a".into(), PathBuf::from("/fixture/a")),
        ("project-b".into(), PathBuf::from("/fixture/b")),
    ]);
    assert_eq!(
        target_label(&directories, std::path::Path::new("/fixture/a")).unwrap(),
        "project-a"
    );
    assert!(target_label(&directories, std::path::Path::new("/fixture/missing")).is_err());
    directories.insert("duplicate".into(), PathBuf::from("/fixture/a"));
    assert!(target_label(&directories, std::path::Path::new("/fixture/a")).is_err());
}

#[test]
fn partial_failures_and_bounded_diagnostics_are_machine_readable() {
    let mut result = success();
    assert!(result.ok());
    result.ui_templates.applied = false;
    result.ui_templates.error = Some("bad template".into());
    assert!(!result.ok());
    let mut result = success();
    result.card_plugins.error = Some("bad plugin".into());
    assert!(!result.ok());
    result.card_plugins.error = Some("\u{0001}".repeat(50_000));
    result.ui_templates.error = Some("🦀".repeat(50_000));
    result.bound_errors();
    assert!(serde_json::to_vec(&result).unwrap().len() < 64 * 1024);
    assert!(result.card_plugins.error.unwrap().ends_with("[truncated]"));
    let request = r#"{"version":1,"action":"delete","project":"/fixture"}"#;
    assert!(serde_json::from_str::<ActionRequest>(request).is_err());
    let request = r#"{"version":1,"action":"reload-customizations","project":"/fixture","script":"anything"}"#;
    assert!(serde_json::from_str::<ActionRequest>(request).is_err());
}
