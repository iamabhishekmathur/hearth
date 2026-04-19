import { providerRegistry } from '../llm/provider-registry.js';
import { complianceChatInterceptor, complianceEmbedInterceptor } from './provider-wrapper.js';
import { logger } from '../lib/logger.js';

/**
 * Bootstrap compliance interceptors on the provider registry.
 * Called once at startup, after loadProviders().
 */
export function bootstrapCompliance(): void {
  providerRegistry.setChatInterceptor(complianceChatInterceptor);
  providerRegistry.setEmbedInterceptor(complianceEmbedInterceptor);
  logger.info('Compliance interceptors registered on provider registry');
}
