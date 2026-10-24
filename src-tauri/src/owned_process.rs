//! Shared owned Unix process-group termination, not harness lifecycle or protocol.
use std::time::Duration;
use tokio::{process::Child, sync::oneshot, time::timeout};
pub(crate) async fn terminate(
    child: &mut Child,
    group: u32,
    confirmation: Option<oneshot::Receiver<()>>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use nix::{
            errno::Errno,
            sys::signal::{Signal, killpg},
            unistd::Pid,
        };
        let group = Pid::from_raw(group as i32);
        if child.id().is_none() {
            return match killpg(group, None) {
                Err(Errno::ESRCH) => Ok(()),
                Ok(()) => Err("Owned agent was reaped; group exit is unconfirmed. Reservation retained without re-signaling a potentially reused group ID".into()),
                Err(error) => Err(format!("Could not observe owned group exit: {error}; reservation retained")),
            };
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
                Err(error) => return Err(error.to_string()),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        killpg(group, Signal::SIGKILL)
            .or_else(|error| {
                if error == Errno::ESRCH {
                    Ok(())
                } else {
                    Err(error)
                }
            })
            .map_err(|error| error.to_string())?;
        timeout(Duration::from_secs(3), child.wait())
            .await
            .map_err(|_| "Owned agent did not exit")?
            .map_err(|error| error.to_string())?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            match killpg(group, None) {
                Err(Errno::ESRCH) => return Ok(()),
                Ok(()) => {}
                Err(error) => return Err(error.to_string()),
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(
                    "Owned agent process group has not exited; reservation retained".into(),
                );
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (group, confirmation);
        child.start_kill().map_err(|error| error.to_string())?;
        child.wait().await.map_err(|error| error.to_string())?;
        Ok(())
    }
}
