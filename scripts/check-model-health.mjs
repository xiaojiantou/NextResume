import nextEnv from '@next/env';
import { FALLBACK_MODEL_ID, findModel, resolveConfiguredModel } from '../lib/models.ts';
import { deploymentProbeLevel, probeModel } from '../lib/modelHealth.ts';

nextEnv.loadEnvConfig(process.cwd());
if (process.env.VERCEL_ENV === 'production') {
  const missing = ['CRON_SECRET', 'MAILERSEND_API_KEY', 'EMAIL_FROM_EMAIL'].filter(key => !process.env[key]);
  if (missing.length) throw new Error(`Model monitoring configuration missing: ${missing.join(', ')}`);
}
const primary = resolveConfiguredModel(process.env.NOVITA_MODEL);
if (findModel(primary).provider !== 'novita') {
  throw new Error('NOVITA_MODEL must select a Novita model for the deployment health gate.');
}
if (!process.env.NOVITA_API_KEY) throw new Error('NOVITA_API_KEY is required for the deployment health gate.');
const base = process.env.NOVITA_BASE_URL || 'https://api.novita.ai/v3/openai';
const results = await Promise.all([...new Set([primary, FALLBACK_MODEL_ID])].map(
  id => probeModel(process.env.NOVITA_API_KEY, base, id),
));
for (const result of results) {
  const level = deploymentProbeLevel(result, primary);
  console.log(`${level} ${result.id}${result.note ? `: ${result.note}` : ''}${level === 'WARN' ? ' — standby rate-limited; primary must pass to deploy' : ''}`);
}
if (results.some(result => deploymentProbeLevel(result, primary) === 'FAIL')) process.exitCode = 1;
