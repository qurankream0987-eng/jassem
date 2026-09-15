import { CredentialReferenceSchema, type CredentialReference } from "@contracts/external-connector";

export interface ConnectorCredentialProvider {
  resolve(reference: CredentialReference): Promise<string>;
}

/** Resolves references at invocation time. Manifests never contain the secret itself. */
export class EnvironmentConnectorCredentialProvider implements ConnectorCredentialProvider {
  async resolve(reference: CredentialReference): Promise<string> {
    const parsed = CredentialReferenceSchema.parse(reference);
    const variableName = parsed.slice("env:".length);
    const value = process.env[variableName];
    if (!value) throw new Error(`Connector credential ${parsed} is unavailable`);
    return value;
  }
}

export class MemoryConnectorCredentialProvider implements ConnectorCredentialProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}

  async resolve(reference: CredentialReference): Promise<string> {
    const parsed = CredentialReferenceSchema.parse(reference);
    const value = this.values[parsed];
    if (!value) throw new Error(`Connector credential ${parsed} is unavailable`);
    return value;
  }
}
