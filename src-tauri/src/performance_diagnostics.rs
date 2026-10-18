//! Timing-only reports. No session discovery, process scans or provider work.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_SAMPLES: usize = 4096;
const MAX_BYTES: usize = 1024 * 1024;
const MAX_REPORTS: usize = 20;
const MAX_WORK_SAMPLES: usize = 2048;
static WRITER: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Kind {
    FrameSummary,
    FrameGap,
    TimerDelay,
    InputDelay,
    InputHandler,
    InputNextFrame,
    KeyDelay,
    WheelDelay,
    ScrollDelay,
    ComposerLayout,
    TranscriptRender,
    Snapshot,
    Enabled,
    Visible,
    Hidden,
    Focused,
    Blurred,
    Capture,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sample {
    at_ms: f64,
    kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<bool>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum WorkKind {
    PiEvent,
    StateReduction,
    TimelineProjection,
    SnapshotDelivery,
    ShellSessionUpdate,
    SidebarRowUpdate,
    SidebarReconcile,
    BookkeepingPrepare,
    SidebarRows,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkSample {
    at_ms: f64,
    started_at_ms: f64,
    kind: WorkKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<WorkKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    active: Option<bool>,
    count: u64,
    total_ms: f64,
    self_ms: f64,
    max_ms: f64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Area {
    Window,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum EffectiveArea {
    Off,
    Window,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Appearance {
    background_opacity: u8,
    frosted_background: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    background_blur: Option<u8>,
    area: Area,
    effective_area: EffectiveArea,
    effective_background_opacity: u8,
    reduced_transparency: bool,
    frost_supported: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Environment {
    user_agent: String,
    field_sizing: bool,
    zoom: f64,
    device_pixel_ratio: f64,
    hardware_concurrency: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    appearance: Option<Appearance>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    version: u8,
    time_origin_ms: f64,
    marker_ms: f64,
    start_ms: f64,
    end_ms: f64,
    dropped_samples: u64,
    environment: Environment,
    environment_at_start: Environment,
    samples: Vec<Sample>,
    work: Vec<WorkSample>,
    dropped_work_samples: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedReport {
    app_version: &'static str,
    source_revision: &'static str,
    source_dirty: Option<bool>,
    built_at_unix_ms: Option<u128>,
    webview_version: Option<String>,
    os: &'static str,
    architecture: &'static str,
    debug_build: bool,
    saved_at_unix_ms: u128,
    report: Report,
}

fn finite(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

fn validate(report: &Report) -> Result<(), String> {
    if report.version != 2
        || report.samples.len() > MAX_SAMPLES
        || report.work.len() > MAX_WORK_SAMPLES
        || !finite(report.time_origin_ms)
        || !finite(report.start_ms)
        || !finite(report.marker_ms)
        || !finite(report.end_ms)
        || report.start_ms > report.marker_ms
        || report.marker_ms > report.end_ms
        || report.marker_ms - report.start_ms > 60_001.0
        || report.environment.user_agent.len() > 512
        || !finite(report.environment.zoom)
        || !(75.0..=200.0).contains(&report.environment.zoom)
        || !finite(report.environment.device_pixel_ratio)
        || report.environment.device_pixel_ratio > 16.0
    {
        return Err("Invalid or oversized performance report".into());
    }
    for environment in [&report.environment, &report.environment_at_start] {
        if environment.user_agent.len() > 512
            || !finite(environment.zoom)
            || !(75.0..=200.0).contains(&environment.zoom)
            || !finite(environment.device_pixel_ratio)
            || environment.device_pixel_ratio > 16.0
            || environment.appearance.as_ref().is_some_and(|appearance| {
                appearance.background_opacity > 100
                    || appearance.effective_background_opacity > 100
                    || appearance.background_blur.is_some_and(|value| value > 40)
            })
        {
            return Err("Invalid performance environment".into());
        }
    }
    let mut previous = report.start_ms;
    for sample in &report.samples {
        if !finite(sample.at_ms)
            || sample.at_ms < previous
            || sample.at_ms > report.end_ms
            || sample.duration_ms.is_some_and(|n| !finite(n))
            || sample.max_ms.is_some_and(|n| !finite(n))
        {
            return Err("Invalid performance timing sample".into());
        }
        previous = sample.at_ms;
    }
    previous = report.start_ms;
    for sample in &report.work {
        if !finite(sample.at_ms)
            || sample.at_ms < previous
            || sample.at_ms > report.end_ms
            || !finite(sample.started_at_ms)
            || sample.started_at_ms > sample.at_ms
            || !finite(sample.total_ms)
            || !finite(sample.self_ms)
            || !finite(sample.max_ms)
            || sample.self_ms > sample.total_ms
            || sample.max_ms > sample.total_ms
            || sample.count > 1_000_000_000_000
        {
            return Err("Invalid performance work aggregate".into());
        }
        previous = sample.at_ms;
    }
    Ok(())
}

fn report_timestamp(name: &str) -> Option<i64> {
    let body = name.strip_suffix(".json")?;
    if body.len() != 24 {
        return None;
    }
    let time = chrono::NaiveDateTime::parse_from_str(body, "%Y-%m-%d_%H-%M-%S%.3fZ").ok()?;
    // Recognize our exact fixed-width UTC names, not loosely parseable user files.
    if time.format("%Y-%m-%d_%H-%M-%S%.3fZ").to_string() != body {
        return None;
    }
    Some(time.and_utc().timestamp_millis())
}
fn report_name(name: &str) -> bool {
    report_timestamp(name).is_some()
}

fn write_report(directory: &Path, report: Report) -> Result<PathBuf, String> {
    validate(&report)?;
    let _guard = WRITER
        .lock()
        .map_err(|_| "Performance report writer unavailable")?;
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let bytes = serde_json::to_vec_pretty(&SavedReport {
        app_version: env!("CARGO_PKG_VERSION"),
        source_revision: option_env!("NIMROD_SOURCE_REVISION").unwrap_or("unknown"),
        source_dirty: option_env!("NIMROD_SOURCE_DIRTY").and_then(|value| value.parse().ok()),
        built_at_unix_ms: option_env!("NIMROD_BUILT_AT_MS").and_then(|value| value.parse().ok()),
        webview_version: tauri::webview_version().ok(),
        os: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        debug_build: cfg!(debug_assertions),
        saved_at_unix_ms: saved_at,
        report,
    })
    .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Performance report exceeds 1 MiB".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    // tempfile creates a private file and commits it without exposing a partial JSON report.
    let mut staged = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut staged, &bytes).map_err(|e| e.to_string())?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    let mut timestamp =
        i64::try_from(saved_at).map_err(|_| "Performance timestamp out of range")?;
    // Monotonic names make latest unambiguous even with same-ms captures/backwards clocks.
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Some(existing) = entry.file_name().to_str().and_then(report_timestamp) {
            timestamp = timestamp.max(
                existing
                    .checked_add(1)
                    .ok_or("Performance timestamp out of range")?,
            );
        }
    }
    let destination = loop {
        let time = chrono::DateTime::from_timestamp_millis(timestamp)
            .ok_or("Performance timestamp out of range")?;
        let name = format!("{}.json", time.format("%Y-%m-%d_%H-%M-%S%.3fZ"));
        if !report_name(&name) {
            return Err("Performance timestamp out of range".into());
        }
        let destination = directory.join(name);
        match staged.persist_noclobber(&destination) {
            Ok(_) => break destination,
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                staged = error.file;
                timestamp = timestamp
                    .checked_add(1)
                    .ok_or("Performance timestamp out of range")?;
            }
            Err(error) => return Err(error.to_string()),
        }
    };

    let mut reports = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.file_name().to_str().is_some_and(report_name)
        {
            reports.push(entry.path());
        }
    }
    // Fixed-width UTC timestamp names sort oldest first.
    reports.sort();
    let excess = reports.len().saturating_sub(MAX_REPORTS);
    for old in reports
        .into_iter()
        .filter(|path| *path != destination)
        .take(excess)
    {
        fs::remove_file(&old).map_err(|e| {
            format!(
                "Saved {}, but could not prune {}: {e}",
                destination.display(),
                old.display()
            )
        })?;
    }
    Ok(destination)
}

fn report_directory(snapshot: crate::preferences::Snapshot) -> Result<PathBuf, String> {
    if crate::preferences::jsonc(&snapshot.text)?
        .get("diagnostics.performance")
        .and_then(serde_json::Value::as_bool)
        != Some(true)
    {
        return Err("Performance diagnostics are disabled".into());
    }
    Ok(snapshot
        .state_path
        .parent()
        .ok_or("Missing Nimrod state directory")?
        .join("performance-captures"))
}

#[tauri::command]
pub async fn write_performance_report(
    preferences: tauri::State<'_, crate::preferences::Preferences>,
    report: Report,
) -> Result<String, String> {
    let directory = report_directory(preferences.snapshot())?;
    tauri::async_runtime::spawn_blocking(move || write_report(&directory, report))
        .await
        .map_err(|e| e.to_string())?
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> serde_json::Value {
        let environment = json!({ "userAgent": "fixture WebKit", "fieldSizing": true, "zoom": 125,
            "devicePixelRatio": 2, "hardwareConcurrency": 8 });
        json!({ "version": 2, "timeOriginMs": 1700000000000_f64, "markerMs": 60000,
            "startMs": 0, "endMs": 65000, "droppedSamples": 0,
            "environment": environment, "environmentAtStart": environment,
            "work": [], "droppedWorkSamples": 0,
            "samples": [{ "atMs": 60000, "kind": "transcript-render", "durationMs": 2, "active": false }] })
    }

    #[test]
    fn storage_uses_native_state_root_and_requires_explicit_enablement() {
        let root = tempfile::tempdir().unwrap();
        let preferences = crate::preferences::Preferences::isolated(root.path());
        let mut snapshot = preferences.snapshot();
        assert!(report_directory(snapshot.clone()).is_err());
        for text in [
            "{\"diagnostics.performance\":false}",
            "{\"diagnostics.performance\":\"true\"}",
        ] {
            snapshot.text = text.into();
            assert!(report_directory(snapshot.clone()).is_err());
        }
        snapshot.text = "// explicit opt-in\n{\"diagnostics.performance\":true}".into();
        assert_eq!(
            report_directory(snapshot).unwrap(),
            root.path().join("state/performance-captures")
        );
    }

    #[test]
    fn saves_private_bounded_reports_without_touching_other_files() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("performance-captures");
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("notes.json"), "keep").unwrap();
        fs::write(directory.join("performance-not-a-report.json"), "keep").unwrap();
        let mut latest = PathBuf::new();
        for _ in 0..23 {
            latest = write_report(&directory, serde_json::from_value(fixture()).unwrap()).unwrap();
        }
        assert!(latest.exists());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), MAX_REPORTS + 2);
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&latest).unwrap()).unwrap();
        assert_eq!(saved["report"]["samples"][0]["active"], false);
        assert_eq!(saved["os"], std::env::consts::OS);
        assert_eq!(saved["appVersion"], env!("CARGO_PKG_VERSION"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(latest).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn timestamp_only_names_are_unique_sortable_and_do_not_overwrite_existing_entries() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("performance-captures");
        fs::create_dir_all(&directory).unwrap();
        let reserved = "2099-01-01_00-00-00.000Z.json";
        fs::write(directory.join(reserved), "preserve").unwrap();
        let first = write_report(&directory, serde_json::from_value(fixture()).unwrap()).unwrap();
        let second = write_report(&directory, serde_json::from_value(fixture()).unwrap()).unwrap();
        assert!(first < second);
        assert!(first.file_name().unwrap().to_str().unwrap() > reserved);
        assert!(report_name(second.file_name().unwrap().to_str().unwrap()));
        assert_eq!(
            fs::read_to_string(directory.join(reserved)).unwrap(),
            "preserve"
        );
        assert!(!report_name("performance-1700000000000-anything.json"));
        assert!(!report_name("latest.json"));
        #[cfg(unix)]
        {
            let target = root.path().join("unrelated");
            fs::write(&target, "keep").unwrap();
            let link = directory.join("2099-01-01_00-00-00.999Z.json");
            std::os::unix::fs::symlink(&target, &link).unwrap();
            let next =
                write_report(&directory, serde_json::from_value(fixture()).unwrap()).unwrap();
            assert_ne!(next, link);
            assert_eq!(fs::read_to_string(target).unwrap(), "keep");
            assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
        }
    }

    #[test]
    fn work_aggregates_and_appearance_are_bounded_typed_and_content_free() {
        let mut raw = fixture();
        raw["work"] = json!([{ "atMs": 60000, "startedAtMs": 59000, "kind": "pi-event", "count": 12,
            "totalMs": 50, "selfMs": 10, "maxMs": 9, "active": false }]);
        raw["environment"]["appearance"] = json!({ "backgroundOpacity": 85, "frostedBackground": true,
            "area": "window", "effectiveArea": "window", "effectiveBackgroundOpacity": 85,
            "reducedTransparency": false, "frostSupported": true });
        assert!(validate(&serde_json::from_value(raw.clone()).unwrap()).is_ok());
        for (key, value) in [
            ("selfMs", 51.0),
            ("maxMs", 51.0),
            ("totalMs", -1.0),
            ("startedAtMs", 60001.0),
        ] {
            let mut invalid = raw.clone();
            invalid["work"][0][key] = json!(value);
            assert!(validate(&serde_json::from_value(invalid).unwrap()).is_err());
        }
        let mut invalid = raw.clone();
        invalid["work"][0]["parent"] = json!("prompt-text");
        assert!(serde_json::from_value::<Report>(invalid).is_err());
        let mut invalid = raw.clone();
        invalid["work"][0]["label"] = json!("project path");
        assert!(serde_json::from_value::<Report>(invalid).is_err());
        let mut invalid = raw.clone();
        invalid["environment"]["appearance"]["backgroundOpacity"] = json!(101);
        assert!(validate(&serde_json::from_value(invalid).unwrap()).is_err());
        raw["work"] = json!(vec![raw["work"][0].clone(); MAX_WORK_SAMPLES + 1]);
        assert!(validate(&serde_json::from_value(raw).unwrap()).is_err());
    }

    #[test]
    fn rejects_content_unknown_metrics_oversize_and_invalid_timings() {
        let mut raw = fixture();
        raw["samples"][0]["text"] = json!("never persist content");
        assert!(serde_json::from_value::<Report>(raw).is_err());
        let mut raw = fixture();
        raw["samples"][0]["kind"] = json!("prompt");
        assert!(serde_json::from_value::<Report>(raw).is_err());
        for (key, value) in [("atMs", -1.0), ("atMs", 70000.0), ("durationMs", -2.0)] {
            let mut raw = fixture();
            raw["samples"][0][key] = json!(value);
            assert!(validate(&serde_json::from_value(raw).unwrap()).is_err());
        }
        let mut raw = fixture();
        raw["samples"] = json!(vec![
            json!({ "atMs": 1, "kind": "snapshot" });
            MAX_SAMPLES + 1
        ]);
        assert!(validate(&serde_json::from_value(raw).unwrap()).is_err());
        let mut raw = fixture();
        raw["environment"]["userAgent"] = json!("x".repeat(513));
        assert!(validate(&serde_json::from_value(raw).unwrap()).is_err());
        let mut raw = fixture();
        raw["samples"] =
            json!([{ "atMs": 10, "kind": "snapshot" }, { "atMs": 9, "kind": "snapshot" }]);
        assert!(validate(&serde_json::from_value(raw).unwrap()).is_err());
    }
}
