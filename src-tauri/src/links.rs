use std::path::{Path, PathBuf};
use url::Url;

#[derive(Debug, PartialEq)]
pub enum Link {
    Web(String),
    File {
        path: PathBuf,
        line: Option<u32>,
        column: Option<u32>,
    },
}

pub fn parse_link(raw: &str, cwd: &Path) -> Result<Link, String> {
    if raw.is_empty()
        || raw.len() > 8192
        || raw.chars().any(char::is_control)
        || raw.starts_with('#')
        || raw.starts_with("//")
    {
        return Err("Unsupported link".into());
    }
    if let Ok(url) = Url::parse(raw) {
        match url.scheme() {
            "http" | "https" => return Ok(Link::Web(url.to_string())),
            "file" => {
                if url
                    .host_str()
                    .is_some_and(|h| !h.is_empty() && h != "localhost")
                {
                    return Err("Remote file links are unsupported".into());
                }
                let (line, column) = fragment_position(url.fragment());
                let path = url.to_file_path().map_err(|_| "Invalid file URL")?;
                return Ok(Link::File { path, line, column });
            }
            _ => {
                // Drive-letter paths and README.md:12 are files, not URL schemes.
                let drive = raw.len() >= 3
                    && raw.as_bytes()[1] == b':'
                    && matches!(raw.as_bytes()[2], b'\\' | b'/');
                let file_position = url.scheme().contains('.')
                    && raw.split_once(':').is_some_and(|(_, suffix)| {
                        suffix.split(':').all(|n| n.parse::<u32>().is_ok())
                    });
                if !drive && !file_position {
                    return Err("Unsupported link scheme".into());
                }
            }
        }
    }
    let (path, fragment) = raw
        .split_once('#')
        .map_or((raw, None), |(p, f)| (p, Some(f)));
    let (mut line, mut column) = fragment_position(fragment);
    let mut path = path.to_string();
    // Accept path:line[:column], without confusing a Windows drive colon.
    if let Some((prefix, suffix)) = path.rsplit_once(':') {
        if let Ok(last) = suffix.parse::<u32>() {
            let mut prefix = prefix.to_owned();
            line = Some(last.max(1));
            if let Some((p, l)) = prefix.rsplit_once(':') {
                if let Ok(l) = l.parse::<u32>() {
                    column = Some(last.max(1));
                    line = Some(l.max(1));
                    prefix = p.to_owned();
                }
            }
            path = prefix;
        }
    }
    if path.is_empty() || path.starts_with('~') {
        return Err("Use an absolute or project-relative file path".into());
    }
    let decoded = percent_encoding::percent_decode_str(&path)
        .decode_utf8()
        .map_err(|_| "Invalid path encoding")?;
    if decoded.chars().any(char::is_control)
        || decoded.starts_with("//")
        || decoded.starts_with("\\\\")
    {
        return Err("Unsupported file path".into());
    }
    let path = PathBuf::from(decoded.as_ref());
    Ok(Link::File {
        path: if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        },
        line,
        column,
    })
}

fn fragment_position(fragment: Option<&str>) -> (Option<u32>, Option<u32>) {
    let Some(fragment) = fragment.and_then(|s| s.strip_prefix('L')) else {
        return (None, None);
    };
    let (line, column) = fragment
        .split_once('C')
        .map_or((fragment, None), |(l, c)| (l, c.parse().ok()));
    (line.parse::<u32>().ok().map(|n| n.max(1)), column)
}

pub fn editor_args(link: Link) -> Result<Vec<String>, String> {
    let Link::File { path, line, column } = link else {
        return Err("Not a file link".into());
    };
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot open file: {e}"))?;
    if !path.is_file() {
        return Err("Link is not a file".into());
    }
    let target = match line {
        Some(line) => format!("{}:{line}:{}", path.display(), column.unwrap_or(1)),
        None => path.to_string_lossy().into_owned(),
    };
    // Absolute path in a separate argument; never interpolate into a shell command.
    Ok(vec!["--reuse-window".into(), "--goto".into(), target])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_http_and_local_positions_but_not_commands() {
        let cwd = Path::new("/project");
        assert_eq!(
            parse_link("README.md:1", cwd).unwrap(),
            Link::File {
                path: cwd.join("README.md"),
                line: Some(1),
                column: None
            }
        );
        assert_eq!(
            parse_link("src/a%20file.ts#L2", cwd).unwrap(),
            Link::File {
                path: cwd.join("src/a file.ts"),
                line: Some(2),
                column: None
            }
        );
        assert!(parse_link("src/a%00file.ts", cwd).is_err());
        assert_eq!(
            parse_link("src/a.ts:12:3", cwd).unwrap(),
            Link::File {
                path: cwd.join("src/a.ts"),
                line: Some(12),
                column: Some(3)
            }
        );
        assert_eq!(
            parse_link("src/a.ts#L12", cwd).unwrap(),
            Link::File {
                path: cwd.join("src/a.ts"),
                line: Some(12),
                column: None
            }
        );
        assert!(matches!(
            parse_link("https://example.com/x", cwd).unwrap(),
            Link::Web(_)
        ));
        for bad in [
            "javascript:alert(1)",
            "command:workbench.action",
            "vscode://file/etc/passwd",
            "file://remote/x",
            "//remote/x",
            "a\nb",
        ] {
            assert!(parse_link(bad, cwd).is_err(), "{bad}");
        }
    }
    #[test]
    fn file_args_are_separate_and_require_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a file;echo hi.ts");
        std::fs::write(&path, "test").unwrap();
        let args = editor_args(Link::File {
            path: path.clone(),
            line: Some(42),
            column: None,
        })
        .unwrap();
        assert_eq!(args.len(), 3);
        assert!(args[2].ends_with("a file;echo hi.ts:42:1"));
        std::fs::remove_file(path.clone()).unwrap();
        assert!(
            editor_args(Link::File {
                path,
                line: None,
                column: None
            })
            .is_err()
        );
    }
}
