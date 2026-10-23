import * as vscode from 'vscode';
import { startEmbeddedServer } from '@cucumber/language-server/wasm';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import { VscodeFiles } from './VscodeFiles';
import { LOG } from './log';

let client: LanguageClient | undefined;

export async function activateCucumberLanguageServer(context: vscode.ExtensionContext): Promise<void> {
  try {
    const serverOptions: ServerOptions = async () =>
      startEmbeddedServer(
        __dirname,
        () => new VscodeFiles(vscode.workspace.fs),
        () => undefined
      );

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: 'file', language: 'cucumber' },
        { scheme: 'file', language: 'behave' },
        { scheme: 'file', language: 'feature' },
        { scheme: 'file', language: 'gherkin' },
        { scheme: 'file', language: 'python' },
        { scheme: 'file', language: 'csharp' },
        { scheme: 'file', language: 'java' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'php' },
        { scheme: 'file', language: 'ruby' },
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'rust' }
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{feature,py,js,ts,java,cs,php,rb,rs}')
      }
    };

    client = new LanguageClient(
      'Cucumber',
      'Cucumber Language Server',
      serverOptions,
      clientOptions
    );

    context.subscriptions.push(client);
    await client.start();
    LOG.info('Official Cucumber Language Server started successfully.');
  } catch (err) {
    LOG.error('Failed to start Cucumber Language Server:', err);
  }
}

export async function deactivateCucumberLanguageServer(): Promise<void> {
  if (client) {
    await client.stop();
    client = undefined;
  }
}
