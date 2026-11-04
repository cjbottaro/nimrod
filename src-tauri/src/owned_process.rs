//! Shared owned Unix process-group termination, not harness lifecycle or protocol.
#[cfg(unix)]
use nix::{
    errno::Errno,
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use std::time::Duration;
use tokio::{process::Child, sync::oneshot, time::timeout};

pub(crate) async fn terminate(
    child: &mut Child,
    group: u32,
    confirmation: Option<oneshot::Receiver<()>>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let group = Pid::from_raw(group as i32);
        if child.id().is_none() {
            // A reaped leader no longer anchors this numeric group ID. Observe
            // disappearance only; never signal a potentially recycled group.
            return observe_group_exit(group).await;
        }
        // A concrete host may provide its graceful-stop acknowledgement. Keep
        // the leader unreaped until the final signal so its PID cannot recycle.
        let graceful = if let Some(confirmation) = confirmation {
            matches!(
                timeout(Duration::from_secs(5), confirmation).await,
                Ok(Ok(()))
            )
        } else {
            false
        };
        if !graceful {
            match killpg(group, Signal::SIGTERM) {
                Ok(()) | Err(Errno::ESRCH) => {}
                Err(error) => {
                    reap_after_signal_failure(child, group, Signal::SIGTERM, error)?;
                    return observe_group_exit(group).await;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        match killpg(group, Signal::SIGKILL) {
            Ok(()) | Err(Errno::ESRCH) => {}
            Err(error) => {
                reap_after_signal_failure(child, group, Signal::SIGKILL, error)?;
                return observe_group_exit(group).await;
            }
        }
        timeout(Duration::from_secs(3), child.wait())
            .await
            .map_err(|_| "Owned agent did not exit")?
            .map_err(|error| error.to_string())?;
        observe_group_exit(group).await
    }
    #[cfg(not(unix))]
    {
        let _ = (group, confirmation);
        child.start_kill().map_err(|error| error.to_string())?;
        child.wait().await.map_err(|error| error.to_string())?;
        Ok(())
    }
}

/// Darwin skips zombies when signaling a process group, so an exited but
/// unreaped leader can yield EPERM. EPERM itself proves nothing: only the owned
/// Child's observed exit permits reaping, followed by observation-only cleanup.
#[cfg(unix)]
fn reap_after_signal_failure(
    child: &mut Child,
    group: Pid,
    signal: Signal,
    error: Errno,
) -> Result<(), String> {
    let failure = format!(
        "Could not send {signal:?} to owned process group {}: {error}; reservation retained",
        group.as_raw()
    );
    if error != Errno::EPERM {
        return Err(failure);
    }
    match child.try_wait() {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(failure),
        Err(observation) => Err(format!(
            "{failure}; could not observe owned leader exit: {observation}"
        )),
    }
}

/// A zero signal only observes. Live members, permission errors, or a reused
/// numeric group keep the reservation; only ESRCH confirms group disappearance.
#[cfg(unix)]
async fn observe_group_exit(group: Pid) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let observation = match killpg(group, None) {
            Err(Errno::ESRCH) => return Ok(()),
            Ok(()) => "group is still present",
            Err(Errno::EPERM) => "group observation was denied (EPERM)",
            Err(error) => {
                return Err(format!(
                    "Could not observe exit of owned process group {}: {error}; reservation retained",
                    group.as_raw()
                ));
            }
        };
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "Owned agent process group {} exit is unconfirmed: {observation}; reservation retained without re-signaling a potentially reused group ID",
                group.as_raw()
            ));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{mem::MaybeUninit, process::Stdio};
    use tokio::process::Command;

    // Observe an exact fixture child without reaping it. Its unreaped PID remains
    // the group ownership anchor, just as in the actual native supervisor.
    fn wait_without_reaping(child: &Child) {
        let mut info = MaybeUninit::<nix::libc::siginfo_t>::zeroed();
        // SAFETY: the PID is from this owned Child and info is writable; WNOWAIT
        // observes only and leaves reaping/ownership with the native stop code.
        let result = unsafe {
            nix::libc::waitid(
                nix::libc::P_PID,
                child.id().unwrap() as _,
                info.as_mut_ptr(),
                nix::libc::WEXITED | nix::libc::WNOWAIT,
            )
        };
        assert_eq!(result, 0, "{}", std::io::Error::last_os_error());
        assert!(child.id().is_some());
    }

    #[tokio::test]
    async fn graceful_exit_before_group_signal_can_be_reaped_and_closed() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let group = child.id().unwrap();
        wait_without_reaping(&child);
        terminate(&mut child, group, None).await.unwrap();
        assert!(child.id().is_none());
        // Repeated native stop is observation-only once the leader is reaped.
        terminate(&mut child, group, None).await.unwrap();
    }

    #[tokio::test]
    async fn permission_failure_for_a_live_owned_leader_is_not_success() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exec sleep 60"])
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let group = Pid::from_raw(child.id().unwrap() as i32);
        let error = reap_after_signal_failure(&mut child, group, Signal::SIGTERM, Errno::EPERM)
            .unwrap_err();
        assert!(error.contains("SIGTERM") && error.contains("EPERM"));
        assert!(child.id().is_some());
        // Exact captured fixture child only, never a process scan/group reuse.
        child.start_kill().unwrap();
        child.wait().await.unwrap();
        observe_group_exit(group).await.unwrap();
    }

    #[tokio::test]
    async fn reaping_an_exited_leader_does_not_discard_a_remaining_owned_member() {
        let mut leader = Command::new("/bin/sh")
            .args(["-c", "read ignored; exit 0"])
            .stdin(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let group = Pid::from_raw(leader.id().unwrap() as i32);
        let mut member = Command::new("/bin/sh")
            .args(["-c", "exec sleep 60"])
            .process_group(group.as_raw())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        drop(leader.stdin.take());
        wait_without_reaping(&leader);
        // Inject the signal failure, not a permission grant or a false exit.
        reap_after_signal_failure(&mut leader, group, Signal::SIGTERM, Errno::EPERM).unwrap();
        assert!(leader.id().is_none());
        let error = terminate(&mut leader, group.as_raw() as u32, None)
            .await
            .unwrap_err();
        assert!(error.contains("reservation retained"));
        assert!(
            member.try_wait().unwrap().is_none(),
            "reaped groups must not be re-signaled"
        );
        member.start_kill().unwrap();
        member.wait().await.unwrap();
        terminate(&mut leader, group.as_raw() as u32, None)
            .await
            .unwrap();
    }
}
