# Install Nimrod

The release pipeline targets **macOS 13 (Ventura) or newer**, with separate Apple Silicon and Intel downloads. Linux packaging is not part of this pipeline; Windows is not a current release target. The pipeline is implemented, but signed release, fresh-machine installation and Homebrew acceptance still need an actual release run.

## Homebrew

Once the first stable release has been published and the tap populated:

```sh
brew install --cask cjbottaro/tap/nimrod
```

This installs Nimrod.app and the `nimrod` terminal launcher. It does not install or configure Pi, authenticate providers, or modify shell configuration.

To update, quit Nimrod first, then:

```sh
brew update
brew upgrade --cask cjbottaro/tap/nimrod
```

If you already installed the development launcher's `~/.local/bin/nimrod` symlink, check `which -a nimrod`: your PATH may still select the checkout build. Remove or relocate that old symlink explicitly if you want the Homebrew launcher instead. Installation does not overwrite an unrelated command.

## Direct download

1. Open [GitHub Releases](https://github.com/cjbottaro/nimrod/releases).
2. Download `Nimrod-VERSION-macos-arm64.dmg` for Apple Silicon or `Nimrod-VERSION-macos-x64.dmg` for Intel.
3. Open the DMG and drag **Nimrod.app** to Applications.
4. Open Nimrod normally. Official release builds are Developer ID signed and notarized; local development builds remain ad-hoc signed.

To update, quit Nimrod and replace the app with the newer download. There is no in-app updater. Do not manage the same copy with both Homebrew and manual replacement.

The release includes `SHA256SUMS`. From the directory containing both DMGs and that file, `shasum -a 256 -c SHA256SUMS` verifies the downloads.

The direct download also contains a launcher at `/Applications/Nimrod.app/Contents/Resources/bin/nimrod`. Run it directly or create your own symlink in a directory on PATH. Homebrew creates the link automatically.

## Runtime setup

Install Node.js and Pi separately, configure Pi's provider authentication, and confirm Pi works in your terminal. Nimrod uses that runtime and its configuration/extensions; it does not bundle Pi or your credentials. Release notes should identify the Pi version used for native compatibility testing.

Open a project in Nimrod, then choose **New session**. If discovery fails, select explicit Pi and Node executable paths in **Settings → Runtime**. You do not need Rust, mise, Xcode or the Nimrod source checkout to use a packaged release.

`nimrod .` opens or focuses a project without starting a session. See [Projects](projects.md#terminal-launches).

## Prereleases and uninstalling

GitHub prereleases (for example `v0.2.0-alpha.1`) are direct downloads only; the Homebrew cask follows stable releases.

`brew uninstall --cask cjbottaro/tap/nimrod` removes the app and its Homebrew launcher. There is no automatic data purge: preferences, Nimrod state/drafts and Pi-owned session history are not removed by the cask. Manual app removal likewise does not delete those files.
