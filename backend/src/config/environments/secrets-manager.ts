/**
 * Optional AWS Secrets Manager integration. Only activates when
 * AWS_SECRETS_MANAGER_ENABLED=true, so local/dev/test never need AWS credentials.
 * The @aws-sdk/client-secrets-manager package is imported dynamically so it stays
 * an optional dependency for environments that don't use it.
 */
export async function loadSecretsManagerOverrides(secretId: string): Promise<Record<string, string>> {
  try {
    const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!result.SecretString) return {};
    const parsed = JSON.parse(result.SecretString) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  } catch (error) {
    console.error(`[config] Failed to load secrets from AWS Secrets Manager (secretId=${secretId}):`, error);
    throw error;
  }
}
