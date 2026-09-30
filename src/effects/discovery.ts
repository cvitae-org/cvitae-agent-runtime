import {configuredIntegrationProviders,type IntegrationProviders} from './integration-providers.js';
import {createIntegrationDiscovery} from './integration-discovery.js';
export const createDiscoverySource=(options:{url?:string;token?:string;fetch?:typeof globalThis.fetch;providers?:IntegrationProviders}={})=>createIntegrationDiscovery(options.providers??configuredIntegrationProviders(),options);
