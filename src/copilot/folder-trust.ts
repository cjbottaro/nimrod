import { QuestionInteraction, type QuestionUi } from '../question-interaction';

const trust = 'Trust for this and future sessions';
const untrusted = 'Continue without trust';
/** Copilot's persistent folder grant, not tool approval or a Nimrod trust store. */
export class CopilotFolderTrust {
  private readonly interaction: QuestionInteraction;
  constructor(private project: string, ui: QuestionUi) { this.interaction = new QuestionInteraction(ui); }
  async request(signal: AbortSignal): Promise<boolean | undefined> {
    const choice = await this.interaction.request({
      header: 'Trust this folder for Copilot?',
      question: `${this.project}\n\nTrust allows Copilot to load this folder’s configuration and enabled plugins, which may execute code. Copilot stores the grant for future sessions, including its CLI. This does not approve every tool request.`,
      choices: [
        { label: trust, detail: 'Save folder trust in Copilot and reload its configuration and plugins' },
        { label: untrusted, detail: 'Connect without granting trust; folder-controlled plugins may remain unavailable' },
      ],
      freeform: false,
    }, signal);
    return choice?.answer === trust ? true : choice?.answer === untrusted ? false : undefined;
  }
  setActive(active: boolean): void { this.interaction.setActive(active); }
  dispose(): void { this.interaction.dispose(); }
}
