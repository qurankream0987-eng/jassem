import { z } from "zod";
import { ReviewedExternalConnectorConfigSchema } from "@contracts/external-connector";
import type { ConnectorCredentialProvider } from "./connector-credentials";
import { ReviewedHttpConnector } from "./reviewed-http-connector";
import type { RuntimeConnectorRegistry } from "./runtime-connector-registry";

const ConfiguredConnectorsSchema = z.array(ReviewedExternalConnectorConfigSchema).max(100);

/** Loads approved declarative definitions. The serialized configuration contains references, never secret values. */
export function registerConfiguredExternalConnectors(
  serialized: string | undefined,
  registry: RuntimeConnectorRegistry,
  credentials: ConnectorCredentialProvider,
): number {
  if (!serialized?.trim()) return 0;
  const definitions = ConfiguredConnectorsSchema.parse(JSON.parse(serialized));
  for (const definition of definitions) {
    registry.register(new ReviewedHttpConnector(definition, credentials));
  }
  return definitions.length;
}
