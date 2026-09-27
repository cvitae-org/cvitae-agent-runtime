import {homedir} from 'node:os';
import {join} from 'node:path';
export const extensionOrigin='chrome-extension://iooajkmijeldoikbjnkcpakgjckieejl/';
export const hostName='com.cvitae.browser_companion';
export const defaultBridgeDirectory=()=>process.env.CVITAE_BROWSER_DIRECTORY ?? join(homedir(),'.cvitae','browser-companion');
