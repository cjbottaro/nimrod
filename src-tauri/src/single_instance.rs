//! macOS instance election happens before Tauri creates its runtime or UI.
//! Keep the existing plugin's endpoint/wire format for forwarding to older builds,
//! but never unlink or bind a socket without holding a lifetime ownership lock.
use nix::{
    errno::Errno,
    fcntl::{Flock, FlockArg},
    poll::{PollFd, PollFlags, PollTimeout, poll},
};
use std::{
    fs::{File, OpenOptions},
    io::{self, Read, Write},
    os::{
        fd::AsFd,
        unix::{
            fs::{OpenOptionsExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
    },
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
#[cfg(target_os = "macos")]
use tauri::Manager;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_REQUEST: usize = 1024 * 1024;

#[derive(Debug, PartialEq)]
struct Forwarded {
    args: Vec<String>,
    cwd: String,
}
impl Forwarded {
    fn encode(&self) -> io::Result<Vec<u8>> {
        if self.cwd.contains('\0') || self.args.iter().any(|arg| arg.contains('\0')) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "NUL in launch request",
            ));
        }
        let bytes = format!("{}\0\0{}", self.cwd, self.args.join("\0")).into_bytes();
        if bytes.len() > MAX_REQUEST {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Launch request is too large",
            ));
        }
        Ok(bytes)
    }
    fn decode(bytes: &[u8]) -> io::Result<Self> {
        if bytes.len() > MAX_REQUEST {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Launch request is too large",
            ));
        }
        let text = std::str::from_utf8(bytes)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let (cwd, args) = text.split_once("\0\0").ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "Malformed launch request")
        })?;
        if cwd.is_empty() || args.is_empty() || args.contains("\0\0") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Malformed launch request",
            ));
        }
        Ok(Self {
            cwd: cwd.into(),
            args: args.split('\0').map(String::from).collect(),
        })
    }
}

struct Endpoint {
    socket: PathBuf,
    lock: PathBuf,
}
impl Endpoint {
    #[cfg(target_os = "macos")]
    fn for_app(identifier: &str) -> Self {
        // The old plugin uses /tmp (not the longer macOS per-user temp directory).
        let name = identifier.replace(['.', '-'], "_");
        Self {
            socket: PathBuf::from(format!("/tmp/{name}_si.sock")),
            lock: PathBuf::from(format!("/tmp/{name}_si.lock")),
        }
    }
}

/// The lock file is deliberately never unlinked: removing it would allow a new
/// inode to be locked while another process still owns the old one.
pub struct Primary {
    _lock: Flock<File>,
    listener: UnixListener,
    socket: PathBuf,
    stopping: Arc<AtomicBool>,
}
impl Primary {
    pub fn shutdown(&self) {
        if self.stopping.swap(true, Ordering::AcqRel) {
            return;
        }
        // Only the elected owner reaches this path, still holding its lock.
        // Tauri exits directly, so RunEvent::Exit calls this as well as Drop.
        let _ = std::fs::remove_file(&self.socket);
    }
}
impl Drop for Primary {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn try_lock(path: &Path) -> io::Result<Option<Flock<File>>> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
        .open(path)?;
    match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
        Ok(lock) => Ok(Some(lock)),
        Err((_, Errno::EWOULDBLOCK)) => Ok(None),
        Err((_, error)) => Err(io::Error::from_raw_os_error(error as i32)),
    }
}

fn forward(socket: &Path, payload: &[u8]) -> io::Result<bool> {
    let mut stream = match UnixStream::connect(socket) {
        Ok(stream) => stream,
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            ) =>
        {
            return Ok(false);
        }
        Err(error) => return Err(error),
    };
    stream.set_nonblocking(true)?;
    // Once connected, a write failure has ambiguous acceptance. Return the error;
    // never retry this request or fall back to opening another app instance.
    let deadline = Instant::now() + IO_TIMEOUT;
    let mut remaining = payload;
    while !remaining.is_empty() {
        wait_for(&stream, PollFlags::POLLOUT, deadline)?;
        match stream.write(remaining) {
            Ok(0) => {
                return Err(io::Error::new(
                    io::ErrorKind::WriteZero,
                    "Launch request write stopped",
                ));
            }
            Ok(size) => remaining = &remaining[size..],
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error),
        }
    }
    stream.shutdown(std::net::Shutdown::Write)?;
    Ok(true)
}

// Use poll with one total deadline: macOS Unix sockets can reject SO_RCVTIMEO,
// and per-read timeouts alone allow a trickling sender to stall the queue forever.
fn wait_for(stream: &UnixStream, flags: PollFlags, deadline: Instant) -> io::Result<()> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "Launch request timed out",
            ));
        }
        let timeout = PollTimeout::try_from(remaining)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        match poll(&mut [PollFd::new(stream.as_fd(), flags)], timeout) {
            Ok(0) => continue,
            Ok(_) => return Ok(()),
            Err(Errno::EINTR) => continue,
            Err(error) => return Err(io::Error::from_raw_os_error(error as i32)),
        }
    }
}

fn claim(endpoint: &Endpoint, payload: &[u8], timeout: Duration) -> io::Result<Option<Primary>> {
    let deadline = Instant::now() + timeout;
    loop {
        let lock = try_lock(&endpoint.lock)?;
        // Also forward to an older running build, which does not hold our lock.
        // A secondary never removes anything, even when it acquired this lock.
        if forward(&endpoint.socket, payload)? {
            return Ok(None);
        }
        if let Some(lock) = lock {
            match std::fs::remove_file(&endpoint.socket) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
            // Bind synchronously under the lock, before allowing any UI startup.
            let listener = UnixListener::bind(&endpoint.socket)?;
            let primary = Primary {
                _lock: lock,
                listener,
                socket: endpoint.socket.clone(),
                stopping: Arc::new(AtomicBool::new(false)),
            };
            std::fs::set_permissions(&primary.socket, std::fs::Permissions::from_mode(0o600))?;
            return Ok(Some(primary));
        }
        if Instant::now() >= deadline {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "The existing Nimrod instance has not opened its forwarding listener",
            ));
        }
        // Wait only for a lock-holder's listener publication/exit, not a guessed
        // app-startup delay. A dead owner releases flock automatically.
        thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(target_os = "macos")]
pub fn start(identifier: &str) -> io::Result<Option<Primary>> {
    let args = std::env::args_os()
        .map(|arg| {
            arg.into_string().map_err(|_| {
                io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Launch arguments must be UTF-8",
                )
            })
        })
        .collect::<io::Result<Vec<_>>>()?;
    let cwd = std::env::current_dir()?
        .into_os_string()
        .into_string()
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "Launch directory must be UTF-8",
            )
        })?;
    let payload = Forwarded { args, cwd }.encode()?;
    claim(&Endpoint::for_app(identifier), &payload, STARTUP_TIMEOUT)
}

fn read_request(mut stream: UnixStream) -> io::Result<Forwarded> {
    stream.set_nonblocking(true)?;
    let deadline = Instant::now() + IO_TIMEOUT;
    let mut bytes = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        wait_for(&stream, PollFlags::POLLIN, deadline)?;
        let size = match stream.read(&mut buffer) {
            Ok(size) => size,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error),
        };
        if size == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..size]);
        if bytes.len() > MAX_REQUEST {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Launch request is too large",
            ));
        }
    }
    Forwarded::decode(&bytes)
}

impl Primary {
    /// The listener is already bound. Queued connections are consumed only after
    /// Tauri has registered managed state; CliRequests still gates routing on setup.
    #[cfg(target_os = "macos")]
    pub fn listen(&self, app: &tauri::AppHandle) -> io::Result<()> {
        let listener = self.listener.try_clone()?;
        listener.set_nonblocking(true)?;
        let app = app.clone();
        // Blocking request IO stays off the main thread and preserves receive order.
        // The worker is bounded by read time/size; its lock is owned by main, not
        // the thread, so a worker cannot outlive the application's ownership.
        let stopping = self.stopping.clone();
        thread::Builder::new()
            .name("nimrod-launches".into())
            .spawn(move || {
                while !stopping.load(Ordering::Acquire) {
                    // Low-frequency cancellation check; launch arrival wakes poll
                    // immediately. Shutdown never connects to a saturated backlog
                    // or waits for this worker on the application's UI thread.
                    match poll(
                        &mut [PollFd::new(listener.as_fd(), PollFlags::POLLIN)],
                        500u16,
                    ) {
                        Ok(0) | Err(Errno::EINTR) => continue,
                        Ok(_) => {}
                        Err(error) => {
                            eprintln!("Nimrod launch listener: {error}");
                            break;
                        }
                    }
                    match listener.accept() {
                        Ok((stream, _)) => {
                            if stopping.load(Ordering::Acquire) {
                                break;
                            }
                            match read_request(stream) {
                                Ok(request) => {
                                    if stopping.load(Ordering::Acquire) {
                                        break;
                                    }
                                    let request = crate::cli::parse(
                                        request.args.into_iter().skip(1).map(Into::into),
                                        Path::new(&request.cwd),
                                    )
                                    .unwrap_or_else(crate::cli::Request::Error);
                                    app.state::<crate::cli::CliRequests>()
                                        .enqueue(&app, request);
                                }
                                Err(error) => eprintln!("Nimrod launch request: {error}"),
                            }
                        }
                        Err(error)
                            if matches!(
                                error.kind(),
                                io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock
                            ) => {}
                        Err(error) => {
                            eprintln!("Nimrod launch listener: {error}");
                            break;
                        }
                    }
                }
            })?;
        // No worker-side socket cleanup or ownership lock.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn endpoint(dir: &Path) -> Endpoint {
        Endpoint {
            socket: dir.join("instance.sock"),
            lock: dir.join("instance.lock"),
        }
    }
    fn payload() -> Vec<u8> {
        Forwarded {
            args: vec![
                "nimrod".into(),
                "--workspace".into(),
                "/project with spaces".into(),
            ],
            cwd: "/cwd".into(),
        }
        .encode()
        .unwrap()
    }

    #[test]
    fn owner_binds_before_return_and_only_owner_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let primary = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        assert!(try_lock(&endpoint.lock).unwrap().is_none());
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_none()
        );
        assert!(endpoint.socket.exists());
        let (stream, _) = primary.listener.accept().unwrap();
        assert_eq!(read_request(stream).unwrap().encode().unwrap(), payload());
        drop(primary);
        assert!(!endpoint.socket.exists());
        assert!(endpoint.lock.exists());
        assert!(try_lock(&endpoint.lock).unwrap().is_some());
        let replacement = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        assert!(endpoint.socket.exists());
        drop(replacement);
    }

    #[test]
    fn legacy_instance_receives_compatible_wire_without_socket_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let legacy = UnixListener::bind(&endpoint.socket).unwrap();
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_none()
        );
        assert!(endpoint.socket.exists());
        let (mut stream, _) = legacy.accept().unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, payload());
        assert!(try_lock(&endpoint.lock).unwrap().is_some());
    }

    #[test]
    fn lock_holder_without_listener_times_out_without_becoming_primary() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let lock = try_lock(&endpoint.lock).unwrap().unwrap();
        let stale = UnixListener::bind(&endpoint.socket).unwrap();
        drop(stale);
        let error = claim(&endpoint, &payload(), Duration::ZERO).err().unwrap();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(
            endpoint.socket.exists(),
            "a secondary must not unlink even a stale endpoint"
        );
        drop(lock);
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn dead_owner_stale_socket_is_replaced_under_lock() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let stale = UnixListener::bind(&endpoint.socket).unwrap();
        drop(stale); // Abrupt exit leaves the pathname, but no listener/lock.
        let primary = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_none()
        );
        drop(primary);
    }

    #[test]
    fn malformed_and_oversized_requests_are_rejected() {
        assert!(Forwarded::decode(b"bad request").is_err());
        assert!(Forwarded::decode(b"\xff\0\0nimrod").is_err());
        assert!(Forwarded::decode(&vec![b'x'; MAX_REQUEST + 1]).is_err());
        assert_eq!(
            Forwarded::decode(&payload()).unwrap().encode().unwrap(),
            payload()
        );
    }

    #[test]
    fn explicit_exit_cleanup_keeps_ownership_until_process_exit() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let primary = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        primary.shutdown();
        primary.shutdown(); // RunEvent::Exit/Drop cleanup is idempotent.
        assert!(!endpoint.socket.exists());
        assert!(try_lock(&endpoint.lock).unwrap().is_none());
        assert_eq!(
            claim(&endpoint, &payload(), Duration::ZERO)
                .err()
                .unwrap()
                .kind(),
            io::ErrorKind::TimedOut
        );
        drop(primary);
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn connected_write_failure_never_retries_or_creates_another_instance() {
        let dir = tempfile::tempdir().unwrap();
        let endpoint = endpoint(dir.path());
        let primary = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        let socket = endpoint.socket.clone();
        let lock = endpoint.lock.clone();
        let writer = thread::spawn(move || {
            claim(
                &Endpoint { socket, lock },
                &vec![b'x'; MAX_REQUEST],
                STARTUP_TIMEOUT,
            )
        });
        let (stream, _) = primary.listener.accept().unwrap();
        stream.shutdown(std::net::Shutdown::Both).unwrap();
        drop(stream);
        assert!(writer.join().unwrap().is_err());
        assert!(endpoint.socket.exists());
        assert!(try_lock(&endpoint.lock).unwrap().is_none());
        primary.listener.set_nonblocking(true).unwrap();
        assert_eq!(
            primary.listener.accept().err().unwrap().kind(),
            io::ErrorKind::WouldBlock
        );
    }

    #[test]
    fn socket_io_has_a_deadline_and_rejects_incomplete_requests() {
        let (stream, _peer) = UnixStream::pair().unwrap();
        assert_eq!(
            wait_for(
                &stream,
                PollFlags::POLLIN,
                Instant::now() + Duration::from_millis(20)
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::TimedOut
        );
        let (stream, mut peer) = UnixStream::pair().unwrap();
        peer.write_all(b"incomplete").unwrap();
        drop(peer);
        assert_eq!(
            read_request(stream).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }

    // Spawn the test executable, not Nimrod/Tauri: no native UI, user endpoint,
    // preference/session state, Pi process or model request is touched.
    #[test]
    fn process_fixture() {
        let Some(dir) = std::env::var_os("NIMROD_INSTANCE_TEST_DIR") else {
            return;
        };
        let dir = PathBuf::from(dir);
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        while !dir.join("go").exists() {
            assert!(Instant::now() < deadline);
            thread::sleep(Duration::from_millis(5));
        }
        match claim(&endpoint(&dir), &payload(), STARTUP_TIMEOUT).unwrap() {
            None => println!("INSTANCE_FORWARDED"),
            Some(primary) => {
                if std::env::var_os("NIMROD_INSTANCE_TEST_HOLD").is_some() {
                    std::fs::write(dir.join("ready"), "fixture").unwrap();
                    loop {
                        thread::park();
                    } // Parent kills/reaps only this fixture child.
                }
                primary.listener.set_nonblocking(true).unwrap();
                let mut received = 0;
                while received < 7 {
                    assert!(Instant::now() < deadline, "missing forwarded launch");
                    match primary.listener.accept() {
                        Ok((stream, _)) => {
                            assert_eq!(read_request(stream).unwrap().encode().unwrap(), payload());
                            received += 1;
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("{error}"),
                    }
                }
                println!("INSTANCE_PRIMARY received={received}");
            }
        }
    }

    #[test]
    fn killed_owner_releases_lock_and_next_launch_recovers_stale_socket() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("go"), "fixture").unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "single_instance::tests::process_fixture",
                "--nocapture",
            ])
            .env("NIMROD_INSTANCE_TEST_DIR", dir.path())
            .env("NIMROD_INSTANCE_TEST_HOLD", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        while !dir.path().join("ready").exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        let ready = dir.path().join("ready").exists();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(ready, "fixture owner did not become ready");
        let endpoint = endpoint(dir.path());
        assert!(endpoint.socket.exists(), "killed process did not run Drop");
        let primary = claim(&endpoint, &payload(), STARTUP_TIMEOUT)
            .unwrap()
            .unwrap();
        assert!(
            claim(&endpoint, &payload(), STARTUP_TIMEOUT)
                .unwrap()
                .is_none()
        );
        drop(primary);
        assert!(!endpoint.socket.exists());
    }

    #[test]
    fn overlapping_cold_processes_elect_one_primary_and_forward_every_launch() {
        let dir = tempfile::tempdir().unwrap();
        let executable = std::env::current_exe().unwrap();
        let children: Vec<_> = (0..8)
            .map(|_| {
                Command::new(&executable)
                    .args([
                        "--exact",
                        "single_instance::tests::process_fixture",
                        "--nocapture",
                    ])
                    .env("NIMROD_INSTANCE_TEST_DIR", dir.path())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .unwrap()
            })
            .collect();
        std::fs::write(dir.path().join("go"), "fixture").unwrap();
        let outputs: Vec<_> = children
            .into_iter()
            .map(|child| child.wait_with_output().unwrap())
            .collect();
        let mut primaries = 0;
        let mut forwards = 0;
        for output in outputs {
            let text = String::from_utf8(output.stdout).unwrap();
            assert!(
                output.status.success(),
                "{text}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            primaries += usize::from(text.contains("INSTANCE_PRIMARY received=7"));
            forwards += usize::from(text.contains("INSTANCE_FORWARDED"));
        }
        assert_eq!((primaries, forwards), (1, 7));
        assert!(endpoint(dir.path()).lock.exists());
        assert!(!endpoint(dir.path()).socket.exists());
    }
}
