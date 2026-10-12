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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Environment {
    user_agent: String,
    field_sizing: bool,
    zoom: f64,
    device_pixel_ratio: f64,
    hardware_concurrency: u32,
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
    samples: Vec<Sample>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedReport {
    app_version: &'static str,
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
    if report.version != 1
        || report.samples.len() > MAX_SAMPLES
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
    Ok(())
}

fn report_name(name: &str) -> bool {
    let Some(body) = name
        .strip_prefix("performance-")
        .and_then(|n| n.strip_suffix(".json"))
    else {
        return false;
    };
    let Some((timestamp, id)) = body.split_once('-') else {
        return false;
    };
    timestamp.parse::<u128>().is_ok() && uuid::Uuid::parse_str(id).is_ok()
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
    let destination = directory.join(format!(
        "performance-{saved_at}-{}.json",
        uuid::Uuid::new_v4()
    ));
    staged
        .persist_noclobber(&destination)
        .map_err(|e| e.to_string())?;

    let mut reports = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_file()
            && entry.file_name().to_str().is_some_and(report_name)
        {
            reports.push(entry.path());
        }
    }
    // Timestamp names sort oldest first (epoch milliseconds are currently equal-width).
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
        .join("performance"))
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
        json!({ "version": 1, "timeOriginMs": 1700000000000_f64, "markerMs": 60000,
            "startMs": 0, "endMs": 65000, "droppedSamples": 0,
            "environment": { "userAgent": "fixture WebKit", "fieldSizing": true, "zoom": 125,
                "devicePixelRatio": 2, "hardwareConcurrency": 8 },
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
            root.path().join("state/performance")
        );
    }

    #[test]
    fn saves_private_bounded_reports_without_touching_other_files() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("performance");
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
