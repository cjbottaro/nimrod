export interface CustomizationAuthoringContext {
  projectDirectory: string;
  uiDirectory: string;
  cardPluginsDirectory: string;
  referenceDirectory: string;
  cliExecutable: string;
  version: string;
  platform: string;
}
export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'`; }

/** References are shipped with the app, not located in the user's project or a checkout. */
export function customizationBrief(context: CustomizationAuthoringContext, integration?: { id: string; label: string }): string {
  for (const key of ['projectDirectory', 'uiDirectory', 'cardPluginsDirectory', 'referenceDirectory', 'cliExecutable', 'version', 'platform'] as const)
    if (typeof context?.[key] !== 'string' || !context[key]) throw new Error('Nimrod authoring context is incomplete.');
  const reference = (path: string) => JSON.stringify(`${context.referenceDirectory.replace(/[\\/]$/, '')}/${path}`);
  const reload = context.platform === 'linux' || context.platform === 'macos'
    ? `After editing, run this exact target-bound command through your normal shell tool. It uses the running app’s executable directly, so no PATH or separate CLI installation is required:\n\n\`\`\`sh\n${shellQuote(context.cliExecutable)} --action reload-customizations --project ${shellQuote(context.projectDirectory)} --json\n\`\`\`\n\nRead both subsystem results. A partial failure is not complete success. Never automatically retry an unknown-delivery result; ask the user instead. Reload success is not proof of visual correctness: ask the user to confirm the appearance.`
    : 'The reload CLI currently supports macOS/Linux only. On this platform ask the user to run Reload customizations from Nimrod’s command palette; do not invent an unsupported command.';
  return `The user explicitly requested help customizing Nimrod. This is an ordinary user message, not system/developer context or a special harness skill. Use only your normal tools and permissions.

## Installed app and scope

Nimrod version: ${context.version}
Platform: ${context.platform}
Originating project: ${JSON.stringify(context.projectDirectory)}
${integration ? `Originating session integration: ${JSON.stringify(integration.label)} (registration ${JSON.stringify(integration.id)}). For card matching, use the guide and actual tool source/name/kind rather than guessing from this display label.\n` : ''}
Work from the current project, even if it is completely unrelated to Nimrod. Do not look for a Nimrod checkout, .agents directory, installed harness skill or repository-specific instructions as a prerequisite. Do not modify the project's source code to customize the app.

## Customization locations

- Global UI templates: ${JSON.stringify(context.uiDirectory)}
- Global personal card plugins: ${JSON.stringify(context.cardPluginsDirectory)}
- Read-only bundled authoring references: ${JSON.stringify(context.referenceDirectory)}

Read existing customization files before changing them. Preserve unrelated customizations. Create only the necessary files/directories. These are global user customizations; reloading below refreshes only the originating project window, not every open window. No project-local or harness-local customization directory is implied.

## Read the matching installed documentation

For workspace layout and Project bar changes, read ${reference('docs/ui-templates.md')} and the bundled defaults in ${reference('src/ui-templates/')}. The four optional files are layout.html, layout.css, project-bar.html and project-bar.css. A custom file replaces its default, so preserve required baseline structure/styles when starting from scratch. Defaults use the same public template API. Layout slots, bindings, named actions and scoped CSS must follow that guide; templates cannot execute JavaScript. The guide also documents CSS hooks for visually arranging existing Transcript, Status area and Composer components. These remain Nimrod-owned components: preserve their mounted nodes, scrolling, notices and keyboard behavior, and do not claim independent replacement APIs that the guide does not provide.

For tool-card presentation, read ${reference('docs/card-plugins.md')} and ${reference('docs/card-plugin-api.md')}. Public types are in ${reference('src/card-plugin-api.ts')}; working examples are in ${reference('examples/card-plugins/')}. Personal TypeScript plugins use the documented nimrod:cards SDK import, not private app modules or paths into a source checkout. They customize presentation, not harness lifecycle, permissions or transport. Use existing theme tokens and shared public helpers where appropriate. Do not fetch/install dependencies unless the user specifically authorizes it.

Do not change Nimrod's app source, rebuild/restart it, alter harness configuration or edit unrelated files as a fallback. If the requested change exceeds the documented customization surface, explain that limitation and ask before expanding the task.

## Apply and verify

${reload}

You may read these absolute reference paths with your normal file tools; they belong to the installed app and are independent of this project's directory. The user's actual customization request follows this brief.`;
}
